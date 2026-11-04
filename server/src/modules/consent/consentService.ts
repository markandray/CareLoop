import { ActorType, CaseEventType, CaseState, ConsentScope, type Prisma, type PrismaClient } from '@prisma/client';
import { ConsentDtoSchema, CursorQuerySchema, makeCursorPageSchema, type ConsentDto, type GrantConsentRequest } from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { record } from '../../core/audit';
import { appendEvent } from '../../core/eventLog';
import { withTransaction } from '../../core/withTransaction';
import { AppError } from '../../middleware/error/errorHandler';
import { raiseEscalation } from '../escalation/raiseEscalation';

export interface ConsentDependencies { prisma: PrismaClient; clock: Clock }

export async function listConsents(deps: ConsentDependencies, userId: string, query: unknown) {
  const parsed = CursorQuerySchema.parse(query);
  const position = parsed.cursor ? decodeCursor(parsed.cursor) : undefined;
  return withTransaction(deps.prisma, async (tx) => {
    const patient = await tx.patient.findUnique({ where: { userId }, select: { id: true } });
    if (!patient) throw AppError.notFound('Patient profile not found.');
    const rows = await tx.consent.findMany({
      where: { patientId: patient.id, ...(position ? { OR: [
        { grantedAt: { lt: position.grantedAt } },
        { grantedAt: position.grantedAt, id: { lt: position.id } },
      ] } : {}) },
      orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }], take: parsed.limit + 1,
    });
    await record(tx, { actorType: ActorType.USER, actorId: userId, action: 'CONSENT_LIST_READ', entityType: 'Consent', entityId: patient.id }, deps.clock);
    const hasMore = rows.length > parsed.limit;
    const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows;
    const items = pageRows.map(toDto);
    const last = pageRows.at(-1);
    const page = makeCursorPageSchema(ConsentDtoSchema).parse({
      items,
      nextCursor: hasMore && last ? encodeCursor(last.grantedAt, last.id) : null,
      updatedAt: deps.clock.now().toISOString(),
    });
    return page;
  });
}

export async function grantConsent(deps: ConsentDependencies, userId: string, input: GrantConsentRequest): Promise<ConsentDto> {
  return withTransaction(deps.prisma, async (tx) => {
    const now = deps.clock.now();
    const patient = await tx.patient.findUnique({ where: { userId }, select: { id: true } });
    if (!patient) throw AppError.notFound('Patient profile not found.');
    const provider = await tx.provider.findUnique({ where: { id: input.providerId }, select: { id: true } });
    if (!provider) throw AppError.notFound('Provider not found.');
    const active = await tx.consent.findFirst({ where: {
      patientId: patient.id, providerId: input.providerId, scope: input.scope,
      grantedAt: { lte: now }, OR: [{ revokedAt: null }, { revokedAt: { gt: now } }],
    }, select: { id: true } });
    if (active) throw AppError.conflict('An active consent already exists for this provider and scope.');
    const consent = await tx.consent.create({ data: {
      patientId: patient.id, providerId: input.providerId, scope: input.scope, grantedAt: now,
    } });
    await appendConsentCaseEvents(tx, patient.id, CaseEventType.CONSENT_GRANTED, userId, consent.id, now, deps.clock);
    await record(tx, { actorType: ActorType.USER, actorId: userId, action: 'CONSENT_GRANTED', entityType: 'Consent', entityId: consent.id }, deps.clock);
    return toDto(consent);
  });
}

export async function revokeConsent(deps: ConsentDependencies, userId: string, consentId: string): Promise<ConsentDto> {
  return withTransaction(deps.prisma, async (tx) => {
    const now = deps.clock.now();
    const patient = await tx.patient.findUnique({ where: { userId }, select: { id: true } });
    if (!patient) throw AppError.notFound('Patient profile not found.');
    const existing = await tx.consent.findUnique({ where: { id: consentId } });
    if (!existing || existing.patientId !== patient.id) throw AppError.notFound('Consent not found.');
    if (existing.revokedAt) throw AppError.conflict('Consent has already been revoked.');
    const consent = await tx.consent.update({ where: { id: consentId }, data: { revokedAt: now } });
    await appendConsentCaseEvents(tx, patient.id, CaseEventType.CONSENT_REVOKED, userId, consent.id, now, deps.clock);
    await record(tx, { actorType: ActorType.USER, actorId: userId, action: 'CONSENT_REVOKED', entityType: 'Consent', entityId: consent.id }, deps.clock);

    const affected = await tx.screeningCase.findMany({
      where: {
        patientId: patient.id,
        state: { in: [CaseState.REFERRAL_PENDING, CaseState.REFERRAL_ACCEPTED, CaseState.APPOINTMENT_SCHEDULED] },
      },
      select: {
        id: true,
        referrals: {
          where: { status: { not: 'SUPERSEDED' } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { toProviderId: true },
        },
      },
    });
    for (const item of affected) {
      if (item.referrals[0]?.toProviderId === existing.providerId) {
        await raiseEscalation(tx, {
          caseId: item.id,
          level: 'LEVEL_1',
          now,
          reason: 'Cross-provider sharing consent was withdrawn while a referral was active.',
        }, deps.clock);
      }
    }

    return toDto(consent);
  });
}

async function appendConsentCaseEvents(
  tx: Prisma.TransactionClient, patientId: string, type: CaseEventType, userId: string,
  consentId: string, now: Date, clock: Clock,
): Promise<void> {
  const cases = await tx.screeningCase.findMany({ where: { patientId, state: { not: CaseState.CLOSED } }, select: { id: true } });
  for (const item of cases) await appendEvent(tx, {
    caseId: item.id, type, actorType: ActorType.USER, actorId: userId,
    payload: { consentId, recordedAt: now.toISOString() },
  }, clock);
}

function toDto(row: { id: string; patientId: string; providerId: string; scope: ConsentScope; grantedAt: Date; revokedAt: Date | null }): ConsentDto {
  return ConsentDtoSchema.parse({ id: row.id, patientId: row.patientId, providerId: row.providerId, scope: row.scope, grantedAt: row.grantedAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null });
}

function encodeCursor(grantedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ grantedAt: grantedAt.toISOString(), id })).toString('base64url');
}

function decodeCursor(cursor: string): { grantedAt: Date; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { grantedAt?: unknown; id?: unknown };
    if (typeof decoded.grantedAt !== 'string' || typeof decoded.id !== 'string') throw new Error();
    const grantedAt = new Date(decoded.grantedAt);
    if (Number.isNaN(grantedAt.getTime())) throw new Error();
    return { grantedAt, id: decoded.id };
  } catch {
    throw AppError.validation('Invalid consent cursor.');
  }
}
