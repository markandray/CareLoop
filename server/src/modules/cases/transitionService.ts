import {
  ActorType,
  AppointmentStatus,
  CaseEventType,
  CaseState,
  type DelayReason,
  EvidenceKind,
  Prisma,
  ReferralStatus,
  type PrismaClient,
  type Role,
} from '@prisma/client';
import {
  CaseTransitionResponseSchema,
  type CaseTransitionResponse,
  type TransitionKey,
  type TransitionRequest,
} from '@careloop/shared';
import { record } from '../../core/audit';
import type { Clock } from '../../core/clock';
import { appendEvent } from '../../core/eventLog';
import { withTransaction } from '../../core/withTransaction';
import { AppError } from '../../middleware/error/errorHandler';
import { evaluateTransition } from '../../core/stateMachine/evaluateTransition';
import { transitionTable } from '../../core/stateMachine/transitionTable';
import {
  caseDetailInclude,
  projectCaseForActor,
  projectReferralPacket,
  projectStaffCaseEvent,
} from './caseProjection';
import { caseVisibility, type CaseActor } from './caseVisibility';
import { loadFacts } from './transitionFacts';
import { queueNotification } from '../notifications/notificationService';
import { nextSteps, resultCategories } from '../explanation/catalog';
import { loadAttentionSnapshots, summarizeAttention } from '../attention/attentionService';

export interface TransitionServiceDependencies {
  prisma: PrismaClient;
  clock: Clock;
  /** Optional test seam; production writes audit records with the core writer. */
  auditWriter?: typeof record;
  /** Optional test seam for verifying a notification write rolls the transition back. */
  notificationWriter?: typeof queueNotification;
}

type CaseRecord = Prisma.ScreeningCaseGetPayload<object>;
type TransitionRow = {
  transitionKey: TransitionKey;
  expectedState: CaseState;
  evidence: unknown;
  note?: string;
  delayReason?: DelayReason;
};

/** Serializes, validates, and atomically applies one state-machine transition. */
export async function executeTransition(
  deps: TransitionServiceDependencies,
  actor: CaseActor,
  caseId: string,
  request: TransitionRequest,
): Promise<CaseTransitionResponse> {
  const transition = request as TransitionRow;
  return withTransaction(deps.prisma, async (tx) => {
    const now = deps.clock.now();
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ScreeningCase" WHERE "id" = ${caseId} FOR UPDATE
    `;
    if (locked.length === 0) throw AppError.notFound('Case not found.');

    const caseRecord = await tx.screeningCase.findFirst({
      where: { AND: [{ id: caseId }, caseVisibility(actor, now)] },
    });
    if (!caseRecord) throw AppError.notFound('Case not found.');

    const loaded = await loadFacts(tx, caseRecord, transition.transitionKey, {
      userId: actor.userId,
      role: actor.role,
      providerId: actor.providerId,
    }, { now, evidence: asEvidenceRecord(transition.evidence) });

    const evaluation = evaluateTransition({
      transitionKey: transition.transitionKey,
      expectedState: transition.expectedState,
      actor: {
        userId: actor.userId,
        role: actor.role,
        providerId: actor.providerId,
      },
      case: {
        state: caseRecord.state,
        originProviderId: caseRecord.originProviderId,
        sendingProviderId: loaded.currentReferral?.fromProviderId,
        receivingProviderId: loaded.currentReferral?.toProviderId,
        ownerUserId: caseRecord.ownerUserId,
        intakeUrgency: caseRecord.intakeUrgency,
        urgencyLabel:
          transition.transitionKey === 'REVIEW_CASE'
            ? caseRecord.reviewDraftUrgencyLabel
            : caseRecord.urgencyLabel,
      },
      facts: loaded.facts,
      evidence: transition.evidence,
      delayReason: transition.delayReason,
      now,
    });
    if (!evaluation.ok) throw transitionError(evaluation);

    const evidence = asEvidenceRecord(transition.evidence);
    const relatedIds = await applyOwnedRows(
      tx,
      caseRecord,
      transition.transitionKey,
      evidence,
      loaded.currentReferral,
      loaded.currentAppointment,
      transition.delayReason,
      now,
    );

    const definition = transitionTable[transition.transitionKey];
    const closureReason = definition.closureReason ?? null;
    const updateData: Prisma.ScreeningCaseUncheckedUpdateInput = {
      state: evaluation.newState,
      ...ownerColumns(evaluation.owner),
      dueAt: evaluation.dueAt,
      updatedAt: now,
      ...(evaluation.newState === CaseState.CLOSED
        ? { closureReason, closedAt: now }
        : {}),
      ...(transition.transitionKey === 'REVIEW_CASE'
        ? {
            resultSummaryApproved: caseRecord.reviewDraftResultCategoryCode
              ? resultCategories[caseRecord.reviewDraftResultCategoryCode as keyof typeof resultCategories]?.EN ?? null
              : null,
            recommendedNextStep: caseRecord.reviewDraftNextStepCode
              ? nextSteps[caseRecord.reviewDraftNextStepCode as keyof typeof nextSteps]?.EN ?? null
              : null,
            urgencyLabel: caseRecord.reviewDraftUrgencyLabel,
          }
        : {}),
      ...(transition.transitionKey === 'REASSIGN_REFERRAL'
        ? { reassignmentCount: { increment: 1 } }
        : {}),
    };
    await tx.screeningCase.update({ where: { id: caseId }, data: updateData });

    await storeTransitionEvidence(
      tx,
      caseRecord.id,
      transition.transitionKey,
      evidence,
      relatedIds,
      actor.userId,
      now,
    );
    for (const derived of evaluation.derivedEvidence) {
      await tx.evidence.create({
        data: {
          caseId,
          kind: derived.kind,
          recordedBy: derived.recordedBy,
          details: {
            clinicianSignOff: derived.clinicianSignOff,
            ...derived.details,
          },
          createdAt: now,
        },
      });
    }

    const event = await appendEvent(
      tx,
      {
        caseId,
        type: evaluation.eventType,
        actorType: ActorType.USER,
        actorId: actor.userId,
        fromState: caseRecord.state,
        toState: evaluation.newState,
        payload: {
          transitionKey: transition.transitionKey,
          evidence: transition.evidence as Prisma.InputJsonObject,
          note: transition.note ?? null,
          ...relatedIds,
        },
      },
      deps.clock,
    );

    if (transition.delayReason) {
      const target = delayEntity(
        transition.transitionKey,
        loaded.currentReferral?.id,
        loaded.currentAppointment?.id,
        relatedIds,
      );
      await appendEvent(
        tx,
        {
          caseId,
          type: CaseEventType.DELAY_REASON_RECORDED,
          actorType: ActorType.USER,
          actorId: actor.userId,
          fromState: caseRecord.state,
          toState: caseRecord.state,
          payload: {
            transitionKey: transition.transitionKey,
            reason: transition.delayReason,
            overdueDurationMs: Math.max(
              0,
              caseRecord.dueAt ? now.getTime() - caseRecord.dueAt.getTime() : 0,
            ),
            entityType: target.entityType,
            entityId: target.entityId,
          },
        },
        deps.clock,
      );
    }

    if (evaluation.notificationTemplate) {
      await (deps.notificationWriter ?? queueNotification)(tx, deps.clock, {
        caseId,
        templateKey: evaluation.notificationTemplate,
        actor: { actorType: ActorType.USER, actorId: actor.userId },
      });
    }

    await (deps.auditWriter ?? record)(
      tx,
      {
        actorType: ActorType.USER,
        actorId: actor.userId,
        action: `CASE_TRANSITION_${transition.transitionKey}`,
        entityType: 'ScreeningCase',
        entityId: caseId,
      },
      deps.clock,
    );

    const updatedCase = await tx.screeningCase.findUniqueOrThrow({
      where: { id: caseId },
      include: caseDetailInclude,
    });
    const eventWithActor = await tx.caseEvent.findUniqueOrThrow({
      where: { id: event.id },
      include: { actor: true },
    });
    const attentionSnapshot = (await loadAttentionSnapshots(tx, [updatedCase], deps.clock.now())).get(updatedCase.id)!;
    let projectedCase;
    let projectedEvent = projectStaffCaseEvent(eventWithActor);
    if (
      (actor.role === 'DOCTOR' || actor.role === 'COORDINATOR') &&
      actor.providerId !== null && actor.providerId !== updatedCase.originProviderId
    ) {
      const referral = updatedCase.referrals.find(
        (item) => item.toProviderId === actor.providerId && item.status !== ReferralStatus.SUPERSEDED,
      );
      if (!referral) throw AppError.notFound('Case not found.');
      projectedCase = projectReferralPacket(updatedCase, referral);
      projectedEvent = { ...projectedEvent, payload: null };
    } else {
      projectedCase = projectCaseForActor(updatedCase, actor, summarizeAttention(attentionSnapshot, deps.clock.now()));
    }
    return CaseTransitionResponseSchema.parse({ case: projectedCase, event: projectedEvent });
  });
}

async function applyOwnedRows(
  tx: Prisma.TransactionClient,
  caseRecord: CaseRecord,
  key: TransitionKey,
  evidence: Record<string, unknown>,
  currentReferral: Awaited<ReturnType<typeof loadFacts>>['currentReferral'],
  currentAppointment: Awaited<ReturnType<typeof loadFacts>>['currentAppointment'],
  delayReason: DelayReason | undefined,
  now: Date,
): Promise<Record<string, string>> {
  const relatedIds: Record<string, string> = {};
  if (key === 'CREATE_REFERRAL_FROM_REVIEW' || key === 'CREATE_REFERRAL_AFTER_CONFIRMATION') {
    const toProviderId = requiredString(evidence.toProviderId);
    const provider = await tx.provider.findUnique({
      where: { id: toProviderId },
      select: { id: true },
    });
    if (!provider) throw AppError.notFound('Receiving provider not found.');
    const referral = await tx.referral.create({
      data: {
        caseId: caseRecord.id,
        fromProviderId: caseRecord.originProviderId,
        toProviderId,
        reason: requiredString(evidence.referralReason),
        status: ReferralStatus.PENDING,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    relatedIds.referralId = referral.id;
  } else if (key === 'REASSIGN_REFERRAL') {
    if (!currentReferral) throw AppError.notFound('Current referral not found.');
    await tx.referral.update({
      where: { id: currentReferral.id },
      data: {
        status: ReferralStatus.SUPERSEDED,
        rejectionReason:
          currentReferral.rejectionReason ??
          (typeof evidence.rejectionReason === 'string' ? evidence.rejectionReason : null),
        updatedAt: now,
      },
    });
    const toProviderId = requiredString(evidence.toProviderId);
    const provider = await tx.provider.findUnique({
      where: { id: toProviderId },
      select: { id: true },
    });
    if (!provider) throw AppError.notFound('Receiving provider not found.');
    const referral = await tx.referral.create({
      data: {
        caseId: caseRecord.id,
        fromProviderId: currentReferral.fromProviderId,
        toProviderId,
        reason: requiredString(evidence.referralReason),
        status: ReferralStatus.PENDING,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    relatedIds.previousReferralId = currentReferral.id;
    relatedIds.referralId = referral.id;
  } else if (key === 'ACCEPT_REFERRAL') {
    if (!currentReferral || currentReferral.status !== ReferralStatus.PENDING) {
      throw AppError.conflict('The current referral is no longer pending.');
    }
    await tx.referral.update({
      where: { id: currentReferral.id },
      data: {
        status: ReferralStatus.ACCEPTED,
        respondedAt: now,
        updatedAt: now,
      },
    });
    relatedIds.referralId = currentReferral.id;
  } else if (key === 'SCHEDULE_APPOINTMENT' || key === 'RESCHEDULE_APPOINTMENT') {
    if (!currentReferral) throw AppError.notFound('Current referral not found.');
    if (key === 'RESCHEDULE_APPOINTMENT' && currentAppointment) {
      if (currentAppointment.status === AppointmentStatus.SCHEDULED) {
        await tx.appointment.update({
          where: { id: currentAppointment.id },
          data: {
            status: AppointmentStatus.RESCHEDULED,
            delayReason: delayReason ?? null,
            updatedAt: now,
          },
        });
      }
      relatedIds.previousAppointmentId = currentAppointment.id;
    }
    const appointment = await tx.appointment.create({
      data: {
        referralId: currentReferral.id,
        scheduledAt: new Date(requiredString(evidence.scheduledAt)),
        status: AppointmentStatus.SCHEDULED,
        location: requiredString(evidence.location),
        delayReason: key === 'RESCHEDULE_APPOINTMENT' ? (delayReason ?? null) : null,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    relatedIds.appointmentId = appointment.id;
  }
  return relatedIds;
}

async function storeTransitionEvidence(
  tx: Prisma.TransactionClient,
  caseId: string,
  key: TransitionKey,
  evidence: Record<string, unknown>,
  relatedIds: Record<string, string>,
  actorId: string,
  now: Date,
): Promise<void> {
  const kinds = evidenceKinds(key, evidence);
  for (const kind of kinds) {
    await tx.evidence.create({
      data: {
        caseId,
        kind,
        recordedBy: actorId,
        details: {
          transitionKey: key,
          evidence: evidence as Prisma.InputJsonObject,
          ...relatedIds,
        },
        createdAt: now,
      },
    });
  }
}

function evidenceKinds(
  key: TransitionKey,
  evidence: Record<string, unknown>,
): EvidenceKind[] {
  if (key === 'REVIEW_CASE') return [EvidenceKind.APPROVED_CLINICAL_PLAN, EvidenceKind.APPROVED_EXPLANATION];
  if (key === 'REQUEST_CONFIRMATION') return [EvidenceKind.CONFIRMATION_TASK_CREATED];
  if (key === 'CREATE_REFERRAL_FROM_REVIEW' || key === 'CREATE_REFERRAL_AFTER_CONFIRMATION') return [EvidenceKind.REFERRAL_CREATED];
  if (key === 'ACCEPT_REFERRAL') return [EvidenceKind.REFERRAL_ACCEPTANCE];
  if (key === 'REASSIGN_REFERRAL') return [EvidenceKind.REFERRAL_REASSIGNMENT];
  if (key === 'SCHEDULE_APPOINTMENT' || key === 'RESCHEDULE_APPOINTMENT') return [EvidenceKind.APPOINTMENT_SCHEDULED];
  if (key === 'START_CARE') return [EvidenceKind.CARE_PLAN];
  if (key === 'CLOSE_COMPLETED_CARE') return [EvidenceKind.CARE_COMPLETION];
  if (key === 'CLOSE_NOT_CONFIRMED') return [EvidenceKind.CONFIRMATORY_RESULT];
  if (key.startsWith('CLOSE_') && evidence.closureReason === 'PATIENT_DECLINED') return [EvidenceKind.PATIENT_DECLINE];
  if (key.startsWith('CLOSE_') && evidence.closureReason === 'UNREACHABLE_AFTER_ATTEMPTS') return [EvidenceKind.UNREACHABLE_STATUS];
  if (key.startsWith('CLOSE_') && evidence.closureReason === 'TRANSFERRED_OUT') return [EvidenceKind.EXTERNAL_TRANSFER];
  return [];
}

function ownerColumns(owner: {
  kind: 'USER' | 'QUEUE' | 'UNASSIGNED';
  userId?: string;
  role?: Role;
  providerId?: string;
}): Pick<
  Prisma.ScreeningCaseUncheckedUpdateInput,
  'ownerUserId' | 'ownerQueueRole' | 'ownerQueueProviderId'
> {
  if (owner.kind === 'USER') {
    return {
      ownerUserId: owner.userId,
      ownerQueueRole: null,
      ownerQueueProviderId: null,
    };
  }
  if (owner.kind === 'QUEUE') {
    return {
      ownerUserId: null,
      ownerQueueRole: owner.role,
      ownerQueueProviderId: owner.providerId,
    };
  }
  return { ownerUserId: null, ownerQueueRole: null, ownerQueueProviderId: null };
}

function transitionError(
  result: Extract<ReturnType<typeof evaluateTransition>, { ok: false }>,
): AppError {
  const status =
    result.code === 'FORBIDDEN' || result.code === 'CONSENT_REQUIRED'
      ? 403
      : result.code === 'CONFLICT' || result.code === 'INVALID_TRANSITION'
        ? 409
        : result.code === 'EVIDENCE_MISSING' || result.code === 'DELAY_REASON_REQUIRED'
          ? 422
          : 400;
  return new AppError(status, result.code, 'Case transition was rejected.', result.details);
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw AppError.validation('Required transition field is missing.');
  return value;
}

function asEvidenceRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function delayEntity(
  key: TransitionKey,
  currentReferralId: string | undefined,
  currentAppointmentId: string | undefined,
  relatedIds: Record<string, string>,
): { entityType: string; entityId: string | null } {
  if (key === 'REASSIGN_REFERRAL') {
    return { entityType: 'Referral', entityId: currentReferralId ?? relatedIds.referralId ?? null };
  }
  if (key === 'RESCHEDULE_APPOINTMENT') {
    return { entityType: 'Appointment', entityId: currentAppointmentId ?? relatedIds.appointmentId ?? null };
  }
  return { entityType: 'ScreeningCase', entityId: relatedIds.caseId ?? null };
}
