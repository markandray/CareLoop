import {
  ActorType,
  CaseEventType,
  CaseState,
  EvidenceKind,
  Prisma,
  type PrismaClient,
  type Role,
} from '@prisma/client';
import {
  CaseCursorPageSchema,
  CaseEventPatientCursorPageSchema,
  CaseEventStaffCursorPageSchema,
  CaseListQuerySchema,
  CursorQuerySchema,
  type CaseListQuery,
  type CaseEventPatientCursorPage,
  type CaseCursorPage,
  type CaseEventStaffCursorPage,
  type TransitionEvidenceByKey,
} from '@careloop/shared';
import { AppError } from '../../middleware/error/errorHandler';
import type { Clock } from '../../core/clock';
import { appendEvent } from '../../core/eventLog';
import { record } from '../../core/audit';
import { withTransaction } from '../../core/withTransaction';
import { evaluateTransition } from '../../core/stateMachine/evaluateTransition';
import {
  caseDetailInclude,
  caseListInclude,
  projectCaseForActor,
  projectCaseListItem,
  projectPatientCaseEvent,
  projectStaffCaseEvent,
  type CaseDetailProjection,
} from './caseProjection';
import { caseVisibility, type CaseActor } from './caseVisibility';

export interface CaseServiceDependencies {
  prisma: PrismaClient;
  clock: Clock;
  /** Optional writer seam for transaction failure tests; production uses the core writer. */
  auditWriter?: typeof record;
}

export type CreateCaseEvidence = TransitionEvidenceByKey['CREATE_CASE'];

type CursorPageQuery = { cursor?: string; limit: number };
type CursorPosition = { createdAt: Date; id: string };
type Cursorable = { id: string; createdAt: Date };

export async function createCase(
  dependencies: CaseServiceDependencies,
  actor: CaseActor,
  evidence: CreateCaseEvidence,
): Promise<CaseDetailProjection> {
  return withTransaction(dependencies.prisma, async (tx) => {
    const now = dependencies.clock.now();
    const decision = evaluateTransition({
      transitionKey: 'CREATE_CASE',
      expectedState: null,
      actor: {
        userId: actor.userId,
        role: actor.role,
        providerId: actor.providerId,
      },
      case: {
        state: null,
        originProviderId: evidence.originProviderId,
        intakeUrgency: evidence.intakeUrgency,
      },
      facts: {},
      evidence,
      now,
    });
    if (!decision.ok) throw transitionError(decision);

    const [patient, provider] = await Promise.all([
      tx.patient.findUnique({ where: { id: evidence.patientId }, select: { id: true } }),
      tx.provider.findUnique({ where: { id: evidence.originProviderId }, select: { id: true } }),
    ]);
    if (!patient) throw AppError.notFound('Patient profile not found.');
    if (!provider) throw AppError.notFound('Origin provider not found.');

    if (evidence.assignedDoctorId) {
      const assignedDoctor = await tx.user.findFirst({
        where: {
          id: evidence.assignedDoctorId,
          role: 'DOCTOR',
          providerId: evidence.originProviderId,
        },
        select: { id: true },
      });
      if (!assignedDoctor) {
        throw AppError.forbidden(
          'The assigned case owner must be a doctor at the originating provider.',
        );
      }
    }

    const created = await tx.screeningCase.create({
      data: {
        patientId: evidence.patientId,
        originProviderId: evidence.originProviderId,
        createdById: actor.userId,
        pathway: evidence.pathway,
        screeningType: evidence.screeningType,
        resultCategory: evidence.resultCategory,
        // Intake summary and action remain intake evidence until clinician review.
        resultSummaryApproved: null,
        recommendedNextStep: null,
        intakeUrgency: evidence.intakeUrgency,
        state: decision.newState,
        ...ownerColumns(decision.owner),
        dueAt: decision.dueAt,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });

    await tx.evidence.create({
      data: {
        caseId: created.id,
        kind: EvidenceKind.SCREENING_INTAKE,
        recordedBy: actor.userId,
        details: { ...evidence },
        createdAt: dependencies.clock.now(),
      },
    });
    await appendEvent(
      tx,
      {
        caseId: created.id,
        type: CaseEventType.CASE_CREATED,
        actorType: ActorType.USER,
        actorId: actor.userId,
        fromState: null,
        toState: CaseState.NEW,
        payload: {
          originProviderId: evidence.originProviderId,
          pathway: evidence.pathway,
          screeningType: evidence.screeningType,
        },
      },
      dependencies.clock,
    );
    await writeAudit(dependencies)(
      tx,
      {
        actorType: ActorType.USER,
        actorId: actor.userId,
        action: 'CASE_CREATED',
        entityType: 'ScreeningCase',
        entityId: created.id,
      },
      dependencies.clock,
    );

    const row = await tx.screeningCase.findUniqueOrThrow({
      where: { id: created.id },
      include: caseDetailInclude,
    });
    return projectCaseForActor(row, actor);
  });
}

export async function listCases(
  dependencies: CaseServiceDependencies,
  actor: CaseActor,
  query: CaseListQuery,
): Promise<CaseCursorPage> {
  const parsed = CaseListQuerySchema.parse(query);
  const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : undefined;
  const now = dependencies.clock.now();
  const clauses: Prisma.ScreeningCaseWhereInput[] = [caseVisibility(actor)];
  if (parsed.state) clauses.push({ state: parsed.state });
  if (parsed.ownerUserId) clauses.push({ ownerUserId: parsed.ownerUserId });
  if (parsed.updatedSince) clauses.push({ updatedAt: { gte: new Date(parsed.updatedSince) } });
  if (parsed.attentionOnly) {
    // Until the attention module lands, list the data-layer conditions available here.
    clauses.push({
      OR: [
        { ownerUserId: null, ownerQueueRole: null, ownerQueueProviderId: null },
        { dueAt: { lt: now } },
      ],
    });
  }
  if (cursor) clauses.push(caseCursorWhere(cursor, 'desc'));
  const where: Prisma.ScreeningCaseWhereInput = { AND: clauses };

  return withTransaction(dependencies.prisma, async (tx) => {
    const rows = await tx.screeningCase.findMany({
      where,
      include: caseListInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: parsed.limit + 1,
    });
    await writeAudit(dependencies)(
      tx,
      {
        actorType: ActorType.USER,
        actorId: actor.userId,
        action: 'CASE_LIST_READ',
        entityType: 'ScreeningCase',
        entityId: actor.userId,
      },
      dependencies.clock,
    );
    const page = pageRows(rows, parsed.limit);
    return CaseCursorPageSchema.parse({
      items: page.items.map(projectCaseListItem),
      nextCursor: page.nextCursor,
      updatedAt: dependencies.clock.now().toISOString(),
    });
  });
}

export async function getCase(
  dependencies: CaseServiceDependencies,
  actor: CaseActor,
  id: string,
): Promise<CaseDetailProjection> {
  return withTransaction(dependencies.prisma, async (tx) => {
    const row = await tx.screeningCase.findFirst({
      where: { AND: [{ id }, caseVisibility(actor)] },
      include: caseDetailInclude,
    });
    if (!row) throw AppError.notFound('Case not found.');
    await writeAudit(dependencies)(
      tx,
      {
        actorType: ActorType.USER,
        actorId: actor.userId,
        action: 'CASE_READ',
        entityType: 'ScreeningCase',
        entityId: row.id,
      },
      dependencies.clock,
    );
    return projectCaseForActor(row, actor);
  });
}

export async function listCaseEvents(
  dependencies: CaseServiceDependencies,
  actor: CaseActor,
  id: string,
  query: CursorPageQuery,
): Promise<CaseEventPatientCursorPage | CaseEventStaffCursorPage> {
  const parsed = CursorQuerySchema.parse(query);
  const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : undefined;
  return withTransaction(dependencies.prisma, async (tx) => {
    const parent = await tx.screeningCase.findFirst({
      where: { AND: [{ id }, caseVisibility(actor)] },
      select: { id: true, state: true, closureReason: true },
    });
    if (!parent) throw AppError.notFound('Case not found.');

    const clauses: Prisma.CaseEventWhereInput[] = [{ caseId: parent.id }];
    if (cursor) clauses.push(eventCursorWhere(cursor, 'asc'));
    const events = await tx.caseEvent.findMany({
      where: { AND: clauses },
      include: { actor: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: parsed.limit + 1,
    });
    await writeAudit(dependencies)(
      tx,
      {
        actorType: ActorType.USER,
        actorId: actor.userId,
        action: 'CASE_READ',
        entityType: 'ScreeningCase',
        entityId: parent.id,
      },
      dependencies.clock,
    );
    const page = pageRows(events, parsed.limit);
    const updatedAt = dependencies.clock.now().toISOString();
    if (actor.role === 'PATIENT') {
      return CaseEventPatientCursorPageSchema.parse({
        items: page.items.map((event) =>
          projectPatientCaseEvent(event, parent.state, parent.closureReason),
        ),
        nextCursor: page.nextCursor,
        updatedAt,
      });
    }
    return CaseEventStaffCursorPageSchema.parse({
      items: page.items.map(projectStaffCaseEvent),
      nextCursor: page.nextCursor,
      updatedAt,
    });
  });
}

function ownerColumns(owner: {
  kind: 'USER' | 'QUEUE' | 'UNASSIGNED';
  userId?: string;
  role?: Role;
  providerId?: string;
}): Pick<
  Prisma.ScreeningCaseUncheckedCreateInput,
  'ownerUserId' | 'ownerQueueRole' | 'ownerQueueProviderId'
> {
  if (owner.kind === 'USER' && owner.userId) {
    return {
      ownerUserId: owner.userId,
      ownerQueueRole: null,
      ownerQueueProviderId: null,
    };
  }
  if (owner.kind === 'QUEUE' && owner.role && owner.providerId) {
    return {
      ownerUserId: null,
      ownerQueueRole: owner.role,
      ownerQueueProviderId: owner.providerId,
    };
  }
  return {
    ownerUserId: null,
    ownerQueueRole: null,
    ownerQueueProviderId: null,
  };
}

function transitionError(
  result: Extract<ReturnType<typeof evaluateTransition>, { ok: false }>,
): AppError {
  const status =
    result.code === 'FORBIDDEN' || result.code === 'CONSENT_REQUIRED'
      ? 403
      : result.code === 'CONFLICT'
        ? 409
        : result.code === 'INVALID_TRANSITION' || result.code === 'EVIDENCE_MISSING'
          ? 422
          : 400;
  return new AppError(status, result.code, 'Case creation was rejected.', result.details);
}

function writeAudit(dependencies: CaseServiceDependencies): typeof record {
  return dependencies.auditWriter ?? record;
}

function pageRows<T extends Cursorable>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

function encodeCursor(row: Cursorable): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string): CursorPosition {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('createdAt' in decoded) ||
      !('id' in decoded) ||
      typeof decoded.createdAt !== 'string' ||
      typeof decoded.id !== 'string' ||
      decoded.id.length === 0
    ) {
      throw new Error('Malformed cursor payload.');
    }
    const createdAt = new Date(decoded.createdAt);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== decoded.createdAt
    ) {
      throw new Error('Malformed cursor timestamp.');
    }
    return { createdAt, id: decoded.id };
  } catch {
    throw AppError.validation('Invalid pagination cursor.');
  }
}

function caseCursorWhere(
  cursor: CursorPosition,
  direction: 'asc' | 'desc',
): Prisma.ScreeningCaseWhereInput {
  const dateFilter = direction === 'desc'
    ? { lt: cursor.createdAt }
    : { gt: cursor.createdAt };
  const idFilter = direction === 'desc'
    ? { lt: cursor.id }
    : { gt: cursor.id };
  return {
    OR: [
      { createdAt: dateFilter },
      { createdAt: cursor.createdAt, id: idFilter },
    ],
  };
}

function eventCursorWhere(
  cursor: CursorPosition,
  direction: 'asc' | 'desc',
): Prisma.CaseEventWhereInput {
  const dateFilter = direction === 'desc'
    ? { lt: cursor.createdAt }
    : { gt: cursor.createdAt };
  const idFilter = direction === 'desc'
    ? { lt: cursor.id }
    : { gt: cursor.id };
  return {
    OR: [
      { createdAt: dateFilter },
      { createdAt: cursor.createdAt, id: idFilter },
    ],
  };
}

