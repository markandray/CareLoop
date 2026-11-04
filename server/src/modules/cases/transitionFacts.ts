import {
  AppointmentStatus,
  CaseEventType,
  CaseState,
  ContactOutcome,
  ConsentScope,
  EvidenceKind,
  ExplanationStatus,
  ReferralStatus,
  type Prisma,
} from '@prisma/client';
import type {
  EvaluateTransitionInput,
  TransitionFacts,
} from '../../core/stateMachine/evaluateTransition';
import type { TransitionActor } from '../../core/stateMachine/evaluateTransition';
import { workflowConfig } from '../../config/workflowConfig';
import { hashExplanationInput } from '../explanation/provider';
import { ReviewDraftFieldsSchema } from '@careloop/shared';

type Transaction = Prisma.TransactionClient;
type CaseRecord = Prisma.ScreeningCaseGetPayload<object>;
type EvidenceInput = Record<string, unknown>;

export interface TransitionFactContext {
  now: Date;
  evidence: EvidenceInput;
}

export interface LoadedTransitionFacts {
  facts: TransitionFacts;
  currentReferral: {
    id: string;
    fromProviderId: string;
    toProviderId: string;
    status: ReferralStatus;
    rejectionReason: string | null;
  } | null;
  currentAppointment: {
    id: string;
    referralId: string;
    scheduledAt: Date;
    status: AppointmentStatus;
  } | null;
}

/** Loads database-backed evaluator facts; the evaluator itself remains pure. */
export async function loadFacts(
  tx: Transaction,
  caseRecord: CaseRecord,
  key: EvaluateTransitionInput['transitionKey'],
  actor: TransitionActor,
  context: TransitionFactContext,
): Promise<LoadedTransitionFacts> {
  const referrals = await tx.referral.findMany({
    where: { caseId: caseRecord.id, status: { not: ReferralStatus.SUPERSEDED } },
    include: { appointments: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const currentReferral = referrals[0] ?? null;
  const currentAppointment = currentReferral?.appointments[0] ?? null;
  const targetProviderId =
    typeof context.evidence.toProviderId === 'string'
      ? context.evidence.toProviderId
      : currentReferral?.toProviderId;

  const milestoneWhere: Prisma.ContactAttemptWhereInput = {
    caseId: caseRecord.id,
    milestoneState: caseRecord.state,
    outcome: { in: [ContactOutcome.NO_ANSWER, ContactOutcome.FAILED] },
    ...(caseRecord.state === CaseState.REFERRAL_PENDING && currentReferral
      ? { referralId: currentReferral.id, appointmentId: null }
      : caseRecord.state === CaseState.APPOINTMENT_SCHEDULED && currentAppointment
        ? { referralId: null, appointmentId: currentAppointment.id }
        : { referralId: null, appointmentId: null }),
  };

  const [
    assignedDoctor,
    approvedExplanationRows,
    reviewedNotificationEvent,
    confirmatoryEvidence,
    confirmatoryEvent,
    declineEvidence,
    declineEvent,
    escalationEvidence,
    escalationEvent,
    closureProposal,
    failedContactAttemptsForMilestone,
    attendedAppointment,
    consent,
  ] = await Promise.all([
    caseRecord.ownerUserId
      ? tx.user.findFirst({
          where: {
            id: caseRecord.ownerUserId,
            role: 'DOCTOR',
            providerId: caseRecord.originProviderId,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
    (() => {
      const ids = context.evidence.approvedExplanationIds;
      const inputHash = currentDraftHash(caseRecord);
      return inputHash && Array.isArray(ids) && ids.every((id) => typeof id === 'string')
      ? tx.explanationDraft.findMany({
            where: {
              caseId: caseRecord.id,
              id: { in: ids as string[] },
              status: ExplanationStatus.APPROVED,
              inputHash,
            },
            select: { id: true, language: true },
          })
        : Promise.resolve([] as Array<{ id: string; language: 'EN' | 'AR' | 'OTHER' }>);
    })(),
    tx.caseEvent.findFirst({
      where: {
        caseId: caseRecord.id,
        type: CaseEventType.NOTIFICATION_SENT,
        payload: { path: ['templateKey'], equals: 'result_reviewed' },
      },
      select: { id: true },
    }),
    tx.evidence.findFirst({
      where: { caseId: caseRecord.id, kind: EvidenceKind.CONFIRMATORY_RESULT },
      select: { id: true },
    }),
    tx.caseEvent.findFirst({
      where: { caseId: caseRecord.id, type: CaseEventType.CONFIRMATORY_RESULT_RECORDED },
      select: { id: true },
    }),
    tx.evidence.findFirst({
      where: { caseId: caseRecord.id, kind: EvidenceKind.PATIENT_DECLINE },
      select: { id: true },
    }),
    tx.caseEvent.findFirst({
      where: { caseId: caseRecord.id, type: CaseEventType.CARE_DECLINED_BY_PATIENT },
      select: { id: true },
    }),
    tx.evidence.findFirst({
      where: { caseId: caseRecord.id, kind: EvidenceKind.ESCALATION_RECORD },
      select: { id: true },
    }),
    tx.caseEvent.findFirst({
      where: { caseId: caseRecord.id, type: CaseEventType.ESCALATION_RAISED },
      select: { id: true },
    }),
    typeof context.evidence.closureProposalId === 'string'
      ? tx.evidence.findFirst({
          where: {
            id: context.evidence.closureProposalId,
            caseId: caseRecord.id,
            kind: EvidenceKind.CLOSURE_PROPOSAL,
          },
          select: { id: true },
        })
      : tx.evidence.findFirst({
          where: { caseId: caseRecord.id, kind: EvidenceKind.CLOSURE_PROPOSAL },
          select: { id: true },
        }),
    tx.contactAttempt.count({ where: milestoneWhere }),
    currentReferral
      ? tx.appointment.findFirst({
          where: {
            referralId: currentReferral.id,
            status: AppointmentStatus.ATTENDED,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
    targetProviderId
      ? tx.consent.findFirst({
          where: {
            patientId: caseRecord.patientId,
            providerId: targetProviderId,
            scope: ConsentScope.CROSS_PROVIDER_REFERRAL,
            grantedAt: { lte: context.now },
            OR: [{ revokedAt: null }, { revokedAt: { gt: context.now } }],
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const reviewRoute = caseRecord.reviewRoute;
  const reviewDraftExists = currentDraftFields(caseRecord) !== null;
  const allowedRescheduleStatuses: readonly string[] = workflowConfig.reschedulableAppointmentStatuses;
  const facts: TransitionFacts = {
    caseAssignedToDoctor: Boolean(assignedDoctor),
    reviewDraftExists,
    reviewRoute:
      reviewRoute === 'CONFIRMATION' || reviewRoute === 'REFERRAL'
        ? reviewRoute
        : null,
    approvedExplanationExists:
      approvedExplanationRows.length === 2 &&
      new Set(approvedExplanationRows.map((row) => row.language)).size === 2 &&
      approvedExplanationRows.some((row) => row.language === 'EN') &&
      approvedExplanationRows.some((row) => row.language === 'AR'),
    resultReviewedDispatched: Boolean(reviewedNotificationEvent),
    confirmatoryResultExists: Boolean(confirmatoryEvidence || confirmatoryEvent),
    currentReferralExists:
      Boolean(currentReferral) &&
      (key !== 'ACCEPT_REFERRAL' || currentReferral?.status === ReferralStatus.PENDING),
    currentReferralAccepted: currentReferral?.status === ReferralStatus.ACCEPTED,
    currentReferralReassignable: currentReferral?.status === ReferralStatus.REJECTED,
    currentAppointmentExists: Boolean(currentAppointment),
    currentAppointmentReschedulable: Boolean(
      currentAppointment && allowedRescheduleStatuses.includes(currentAppointment.status),
    ),
    attendedAppointmentExists: Boolean(attendedAppointment),
    patientDeclineRecorded: Boolean(declineEvidence || declineEvent),
    closureProposalExists: Boolean(closureProposal),
    escalationEventExists: Boolean(escalationEvidence || escalationEvent),
    failedContactAttemptsForMilestone,
    receivingProviderConsentActive: Boolean(consent),
    caseOverdue: caseRecord.dueAt !== null && caseRecord.dueAt < context.now,
    currentReferral: currentReferral
      ? {
          fromProviderId: currentReferral.fromProviderId,
          toProviderId: currentReferral.toProviderId,
        }
      : null,
  };

  // Referral destinations are explicit in the current request contract. The actor
  // remains part of the loader context for provider-specific fact policies.
  void actor;
  return {
    facts,
    currentReferral: currentReferral
      ? {
          id: currentReferral.id,
          fromProviderId: currentReferral.fromProviderId,
          toProviderId: currentReferral.toProviderId,
          status: currentReferral.status,
          rejectionReason: currentReferral.rejectionReason,
        }
      : null,
    currentAppointment: currentAppointment
      ? {
          id: currentAppointment.id,
          referralId: currentAppointment.referralId,
          scheduledAt: currentAppointment.scheduledAt,
          status: currentAppointment.status,
        }
      : null,
  };
}

function currentDraftFields(row: CaseRecord) {
  const parsed = ReviewDraftFieldsSchema.safeParse({
    resultCategoryCode: row.reviewDraftResultCategoryCode,
    nextStepCode: row.reviewDraftNextStepCode,
    urgencyLabel: row.reviewDraftUrgencyLabel,
    route: row.reviewRoute,
    ...(row.reviewDraftDoctorNote !== null ? { doctorNote: row.reviewDraftDoctorNote } : {}),
  });
  return parsed.success ? parsed.data : null;
}

function currentDraftHash(row: CaseRecord): string | null {
  const fields = currentDraftFields(row);
  return fields ? hashExplanationInput(fields) : null;
}
