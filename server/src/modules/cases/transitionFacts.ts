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
    approvedExplanationCount,
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
    tx.explanationDraft.count({
      where: { caseId: caseRecord.id, status: ExplanationStatus.APPROVED },
    }),
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
    tx.appointment.findFirst({
      where: {
        referral: { caseId: caseRecord.id },
        status: AppointmentStatus.ATTENDED,
      },
      select: { id: true },
    }),
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
  const reviewDraftExists = Boolean(
    caseRecord.reviewDraftSummary &&
      caseRecord.reviewDraftNextStep &&
      caseRecord.reviewDraftUrgencyLabel &&
      reviewRoute,
  );
  const facts: TransitionFacts = {
    caseAssignedToDoctor: Boolean(assignedDoctor),
    reviewDraftExists,
    reviewRoute:
      reviewRoute === 'CONFIRMATION' || reviewRoute === 'REFERRAL'
        ? reviewRoute
        : null,
    approvedExplanationExists: approvedExplanationCount > 0,
    resultReviewedDispatched: Boolean(reviewedNotificationEvent),
    confirmatoryResultExists: Boolean(confirmatoryEvidence || confirmatoryEvent),
    currentReferralExists: Boolean(currentReferral),
    currentReferralAccepted: currentReferral?.status === ReferralStatus.ACCEPTED,
    currentReferralReassignable: currentReferral?.status === ReferralStatus.REJECTED,
    currentAppointmentExists: Boolean(currentAppointment),
    appointmentMissedOrRescheduleRequested:
      currentAppointment?.status === AppointmentStatus.MISSED,
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

  // Keep the actor in the signature so fact policy can expand without callers changing shape.
  void actor;
  void key;
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
