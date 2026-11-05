import { ActorType, ContactOutcome, Prisma, type PrismaClient } from '@prisma/client';
import type { AttentionListQuery, AttentionResponse } from '@careloop/shared';
import { AttentionListQuerySchema, AttentionQueuePageSchema, AttentionResponseSchema } from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { record } from '../../core/audit';
import { withTransaction } from '../../core/withTransaction';
import { AppError } from '../../middleware/error/errorHandler';
import { caseVisibility, type CaseActor } from '../cases/caseVisibility';
import { computeAttention, type AttentionSnapshot } from './attentionEngine';
import { workflowConfig } from '../../config/workflowConfig';

type Db = Prisma.TransactionClient;
type CaseRow = Prisma.ScreeningCaseGetPayload<{ include: { ownerUser: true } }>;
type Cursor = { score: number; dueAt: string | null; id: string };
const levels = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
const escalationLevels = { LEVEL_0: 0, LEVEL_1: 1, LEVEL_2: 2, LEVEL_3: 3 } as const;

/** Loads all operational facts with a fixed set of grouped/bulk queries. */
export async function loadAttentionSnapshots(db: Db, rows: CaseRow[], now: Date): Promise<Map<string, AttentionSnapshot>> {
  const result = new Map<string, AttentionSnapshot>();
  if (!rows.length) return result;
  const caseIds = rows.map((row) => row.id);
  const [referrals, followUps, consults, contacts] = await Promise.all([
    db.referral.findMany({ where: { caseId: { in: caseIds }, status: { not: 'SUPERSEDED' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, caseId: true, status: true, createdAt: true, respondedAt: true } }),
    db.followUp.findMany({ where: { caseId: { in: caseIds }, status: 'OPEN' }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], select: { caseId: true, dueAt: true, status: true } }),
    db.consult.findMany({ where: { caseId: { in: caseIds }, status: 'OPEN' }, select: { caseId: true, createdAt: true } }),
    db.contactAttempt.findMany({ where: { caseId: { in: caseIds }, outcome: { in: [ContactOutcome.FAILED, ContactOutcome.NO_ANSWER] } }, select: { caseId: true, milestoneState: true, referralId: true, appointmentId: true } }),
  ]);
  const currentReferral = new Map<string, typeof referrals[number]>();
  for (const referral of referrals) if (!currentReferral.has(referral.caseId)) currentReferral.set(referral.caseId, referral);
  const referralIds = [...currentReferral.values()].map((item) => item.id);
  const appointments = referralIds.length ? await db.appointment.findMany({ where: { referralId: { in: referralIds } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, referralId: true, status: true, scheduledAt: true } }) : [];
  const appointmentByReferral = new Map<string, typeof appointments[number]>();
  for (const appointment of appointments) if (!appointmentByReferral.has(appointment.referralId)) appointmentByReferral.set(appointment.referralId, appointment);
  for (const row of rows) {
    const referral = currentReferral.get(row.id) ?? null;
    const appointment = referral ? appointmentByReferral.get(referral.id) ?? null : null;
    const failedContactAttempts = contacts.filter((attempt) => attempt.caseId === row.id && attempt.milestoneState === row.state &&
      (row.state === 'REFERRAL_PENDING' ? attempt.referralId === referral?.id && attempt.appointmentId === null :
        row.state === 'APPOINTMENT_SCHEDULED' ? attempt.appointmentId === appointment?.id && attempt.referralId === null : !attempt.referralId && !attempt.appointmentId)).length;
    const consultAges = consults.filter((consult) => consult.caseId === row.id).map((consult) => now.getTime() - consult.createdAt.getTime());
    const followUp = followUps.find((item) => item.caseId === row.id) ?? null;
    result.set(row.id, {
      state: row.state,
      urgency: row.urgencyLabel ?? row.intakeUrgency,
      ownerUserId: row.ownerUserId,
      ownerRole: row.ownerQueueRole,
      dueAt: row.dueAt,
      notifiedAt: row.notifiedAt,
      acknowledgedAt: row.acknowledgedAt,
      currentReferral: referral ? { status: referral.status, createdAt: referral.createdAt, respondedAt: referral.respondedAt } : null,
      currentAppointment: appointment ? { status: appointment.status, scheduledAt: appointment.scheduledAt } : null,
      failedContactAttempts,
      openConsultAgeMs: consultAges.length ? Math.max(...consultAges) : null,
      escalationLevel: row.escalationLevel,
      followUp: followUp ? { dueAt: followUp.dueAt, status: followUp.status } : null,
    });
  }
  return result;
}

export async function getAttention(deps: { prisma: PrismaClient; clock: Clock }, actor: CaseActor, caseId: string): Promise<AttentionResponse> {
  if (actor.role === 'PATIENT') throw AppError.forbidden('This action is not available to patients.');
  return withTransaction(deps.prisma, async (tx) => {
    const now = deps.clock.now();
    const row = await tx.screeningCase.findFirst({ where: { AND: [{ id: caseId, state: { not: 'CLOSED' } }, caseVisibility(actor, now)] }, include: { ownerUser: true } });
    if (!row) throw AppError.notFound('Case not found.');
    const snapshots = await loadAttentionSnapshots(tx, [row], now);
    const score = computeAttention(snapshots.get(row.id)!, now, workflowConfig);
    await record(tx, { actorType: ActorType.USER, actorId: actor.userId, action: 'ATTENTION_READ', entityType: 'ScreeningCase', entityId: row.id }, deps.clock);
    return AttentionResponseSchema.parse({ caseId: row.id, ...score, updatedAt: now.toISOString() });
  });
}

export async function listAttention(deps: { prisma: PrismaClient; clock: Clock }, actor: CaseActor, query: AttentionListQuery) {
  if (actor.role === 'PATIENT') throw AppError.forbidden('This action is not available to patients.');
  const parsed = AttentionListQuerySchema.parse(query);
  const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : null;
  return withTransaction(deps.prisma, async (tx) => {
    const now = deps.clock.now();
    const where: Prisma.ScreeningCaseWhereInput = { AND: [caseVisibility(actor, now), { state: { not: 'CLOSED' } }, ...(parsed.providerId ? [{ originProviderId: parsed.providerId }] : [])] };
    const rows = await tx.screeningCase.findMany({ where, include: { ownerUser: true } });
    const snapshots = await loadAttentionSnapshots(tx, rows, now);
    const items = rows.map((row) => ({ row, result: computeAttention(snapshots.get(row.id)!, now, workflowConfig) }))
      .filter(({ result }) => !parsed.minLevel || levels[result.attentionLevel] >= levels[parsed.minLevel])
      .filter(({ row }) => !parsed.minEscalation || escalationLevels[row.escalationLevel] >= escalationLevels[parsed.minEscalation])
      .sort((a, b) => b.result.score - a.result.score || compareNullableDate(a.row.dueAt, b.row.dueAt) || a.row.id.localeCompare(b.row.id));
    const afterCursor = cursor ? items.filter(({ row, result }) => comparePosition({ score: result.score, dueAt: row.dueAt?.toISOString() ?? null, id: row.id }, cursor) > 0) : items;
    const hasMore = afterCursor.length > parsed.limit;
    const selected = afterCursor.slice(0, parsed.limit);
    const last = selected.at(-1);
    await record(tx, { actorType: ActorType.USER, actorId: actor.userId, action: 'ATTENTION_LIST_READ', entityType: 'ScreeningCase', entityId: actor.userId }, deps.clock);
    return AttentionQueuePageSchema.parse({
      items: selected.map(({ row, result }) => ({ caseId: row.id, state: row.state, dueAt: row.dueAt?.toISOString() ?? null, escalationLevel: row.escalationLevel, escalatedAt: row.escalatedAt?.toISOString() ?? null, ...result })),
      nextCursor: hasMore && last ? encodeCursor({ score: last.result.score, dueAt: last.row.dueAt?.toISOString() ?? null, id: last.row.id }) : null,
      updatedAt: now.toISOString(),
    });
  });
}

export function summarizeAttention(snapshot: AttentionSnapshot, now: Date) {
  const result = computeAttention(snapshot, now, workflowConfig);
  return { level: result.attentionLevel, score: result.score };
}

function compareNullableDate(a: Date | null, b: Date | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.getTime() - b.getTime();
}
function comparePosition(a: Cursor, b: Cursor): number {
  return b.score - a.score || compareNullableString(a.dueAt, b.dueAt) || a.id.localeCompare(b.id);
}
function compareNullableString(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}
function encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
function decodeCursor(value: string): Cursor {
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    if (!Number.isInteger(cursor.score) || typeof cursor.id !== 'string' || !cursor.id || !(cursor.dueAt === null || typeof cursor.dueAt === 'string')) throw new Error('bad cursor');
    return cursor;
  } catch { throw AppError.validation('Invalid pagination cursor.'); }
}
