import {
  TransitionEvidenceSchemas,
  transitionMatrix,
  type CaseEventType,
  type CaseState,
  type ClosureReason,
  type NotificationTemplateKey,
  type Role,
  type TransitionKey,
} from '@careloop/shared';
import type { z } from 'zod';
import type { SlaKey } from '../../config/workflowConfig';

export type ProviderRelationship =
  | 'ANY'
  | 'OWN_PROVIDER'
  | 'SENDING_PROVIDER'
  | 'RECEIVING_PROVIDER';

export type TransitionFactKey =
  | 'caseAssignedToDoctor'
  | 'approvedExplanationExists'
  | 'resultReviewedDispatched'
  | 'confirmatoryResultExists'
  | 'currentReferralExists'
  | 'currentReferralAccepted'
  | 'currentReferralReassignable'
  | 'currentAppointmentExists'
  | 'appointmentMissedOrRescheduleRequested'
  | 'attendedAppointmentExists'
  | 'patientDeclineRecorded'
  | 'closureProposalExists'
  | 'escalationEventExists'
  | 'failedContactAttemptsForMilestone'
  | 'receivingProviderConsentActive';

export type OwnerRule =
  | { kind: 'NONE' }
  | { kind: 'USER_FROM_EVIDENCE'; evidenceField: 'assignedDoctorId' }
  | {
      kind: 'QUEUE';
      role: Role;
      provider: 'ORIGIN' | 'SENDING' | 'RECEIVING' | 'TARGET';
    };

/** The base timestamp may be selected from the transition evidence for scheduled work. */
export interface DueAtRule {
  slaKey: SlaKey;
  base: 'NOW' | 'SCHEDULED_AT' | 'FOLLOW_UP_AT';
}

export interface TransitionDefinition {
  key: TransitionKey;
  from: CaseState | 'none';
  to: CaseState;
  allowedRoles: readonly Role[];
  providerRules: Partial<Record<Role, ProviderRelationship>>;
  requiredFacts: readonly TransitionFactKey[];
  evidenceSchema: z.ZodTypeAny;
  closureReason?: ClosureReason;
  ownerAfter: OwnerRule;
  dueAtRule: DueAtRule | null;
  notificationTemplate: NotificationTemplateKey | null;
  eventType: CaseEventType;
}

type TransitionPolicy = Omit<
  TransitionDefinition,
  'key' | 'from' | 'to' | 'allowedRoles' | 'evidenceSchema'
>;

const close = (
  closureReason: ClosureReason,
): Pick<TransitionPolicy, 'closureReason' | 'ownerAfter' | 'dueAtRule' | 'notificationTemplate' | 'eventType'> => ({
  closureReason,
  ownerAfter: { kind: 'NONE' },
  dueAtRule: null,
  notificationTemplate: 'care_closed',
  eventType: 'CASE_CLOSED',
});

const ownDoctor = { DOCTOR: 'OWN_PROVIDER' } as const;
const queue = (
  role: Role,
  provider: 'ORIGIN' | 'SENDING' | 'RECEIVING' | 'TARGET',
): OwnerRule => ({
  kind: 'QUEUE',
  role,
  provider,
});

const policies = {
  CREATE_CASE: {
    providerRules: { DOCTOR: 'OWN_PROVIDER', ADMIN: 'ANY' },
    requiredFacts: [],
    ownerAfter: { kind: 'USER_FROM_EVIDENCE', evidenceField: 'assignedDoctorId' },
    dueAtRule: { slaKey: 'reviewAfterNew', base: 'NOW' },
    notificationTemplate: null,
    eventType: 'CASE_CREATED',
  },
  REVIEW_CASE: {
    providerRules: ownDoctor,
    requiredFacts: ['caseAssignedToDoctor', 'approvedExplanationExists'],
    ownerAfter: queue('COORDINATOR', 'ORIGIN'),
    dueAtRule: { slaKey: 'notificationDispatch', base: 'NOW' },
    notificationTemplate: 'result_reviewed',
    eventType: 'CASE_REVIEWED',
  },
  REQUEST_CONFIRMATION: {
    providerRules: { COORDINATOR: 'OWN_PROVIDER' },
    requiredFacts: ['resultReviewedDispatched'],
    ownerAfter: queue('DOCTOR', 'ORIGIN'),
    dueAtRule: { slaKey: 'confirmatoryResult', base: 'NOW' },
    notificationTemplate: 'awaiting_confirmation',
    eventType: 'CONFIRMATION_REQUESTED',
  },
  CREATE_REFERRAL_FROM_REVIEW: {
    providerRules: { COORDINATOR: 'SENDING_PROVIDER' },
    requiredFacts: ['resultReviewedDispatched'],
    ownerAfter: queue('COORDINATOR', 'RECEIVING'),
    dueAtRule: { slaKey: 'referralAcceptance', base: 'NOW' },
    notificationTemplate: 'referral_started',
    eventType: 'REFERRAL_CREATED',
  },
  CLOSE_AFTER_REVIEW_PATIENT_DECLINED: {
    providerRules: ownDoctor,
    requiredFacts: ['patientDeclineRecorded'],
    ...close('PATIENT_DECLINED'),
  },
  CREATE_REFERRAL_AFTER_CONFIRMATION: {
    providerRules: ownDoctor,
    requiredFacts: ['confirmatoryResultExists'],
    ownerAfter: queue('COORDINATOR', 'RECEIVING'),
    dueAtRule: { slaKey: 'referralAcceptance', base: 'NOW' },
    notificationTemplate: 'referral_started',
    eventType: 'REFERRAL_CREATED',
  },
  CLOSE_NOT_CONFIRMED: {
    providerRules: ownDoctor,
    requiredFacts: ['confirmatoryResultExists'],
    ...close('NOT_CONFIRMED'),
  },
  CLOSE_CONFIRMATION_PATIENT_DECLINED: {
    providerRules: ownDoctor,
    requiredFacts: ['patientDeclineRecorded'],
    ...close('PATIENT_DECLINED'),
  },
  CLOSE_CONFIRMATION_UNREACHABLE: {
    providerRules: ownDoctor,
    requiredFacts: ['failedContactAttemptsForMilestone', 'escalationEventExists'],
    ...close('UNREACHABLE_AFTER_ATTEMPTS'),
  },
  ACCEPT_REFERRAL: {
    providerRules: { DOCTOR: 'RECEIVING_PROVIDER', COORDINATOR: 'RECEIVING_PROVIDER' },
    requiredFacts: ['currentReferralExists', 'receivingProviderConsentActive'],
    ownerAfter: queue('COORDINATOR', 'RECEIVING'),
    dueAtRule: { slaKey: 'appointmentScheduling', base: 'NOW' },
    notificationTemplate: 'referral_accepted',
    eventType: 'REFERRAL_ACCEPTED',
  },
  REASSIGN_REFERRAL: {
    providerRules: { COORDINATOR: 'SENDING_PROVIDER' },
    requiredFacts: ['currentReferralExists', 'currentReferralReassignable'],
    ownerAfter: queue('COORDINATOR', 'RECEIVING'),
    dueAtRule: { slaKey: 'referralAcceptance', base: 'NOW' },
    notificationTemplate: 'referral_reassigned',
    eventType: 'REFERRAL_REASSIGNED',
  },
  CLOSE_REFERRAL_PATIENT_DECLINED: {
    providerRules: ownDoctor,
    requiredFacts: ['patientDeclineRecorded'],
    ...close('PATIENT_DECLINED'),
  },
  CLOSE_REFERRAL_UNREACHABLE: {
    providerRules: ownDoctor,
    requiredFacts: ['failedContactAttemptsForMilestone', 'escalationEventExists'],
    ...close('UNREACHABLE_AFTER_ATTEMPTS'),
  },
  CLOSE_REFERRAL_TRANSFERRED_OUT: {
    providerRules: ownDoctor,
    requiredFacts: [],
    ...close('TRANSFERRED_OUT'),
  },
  SCHEDULE_APPOINTMENT: {
    providerRules: { COORDINATOR: 'RECEIVING_PROVIDER' },
    requiredFacts: ['currentReferralExists', 'currentReferralAccepted'],
    ownerAfter: queue('COORDINATOR', 'RECEIVING'),
    dueAtRule: { slaKey: 'appointmentAttendanceGrace', base: 'SCHEDULED_AT' },
    notificationTemplate: 'appointment_scheduled',
    eventType: 'APPOINTMENT_SCHEDULED',
  },
  CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED: {
    providerRules: ownDoctor,
    requiredFacts: ['patientDeclineRecorded'],
    ...close('PATIENT_DECLINED'),
  },
  CLOSE_ACCEPTED_REFERRAL_UNREACHABLE: {
    providerRules: ownDoctor,
    requiredFacts: ['failedContactAttemptsForMilestone', 'escalationEventExists'],
    ...close('UNREACHABLE_AFTER_ATTEMPTS'),
  },
  CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT: {
    providerRules: ownDoctor,
    requiredFacts: [],
    ...close('TRANSFERRED_OUT'),
  },
  START_CARE: {
    providerRules: { DOCTOR: 'RECEIVING_PROVIDER' },
    requiredFacts: ['attendedAppointmentExists'],
    ownerAfter: queue('DOCTOR', 'RECEIVING'),
    dueAtRule: { slaKey: 'defaultFollowUpInterval', base: 'FOLLOW_UP_AT' },
    notificationTemplate: 'care_started',
    eventType: 'CARE_STARTED',
  },
  RESCHEDULE_APPOINTMENT: {
    providerRules: { COORDINATOR: 'RECEIVING_PROVIDER' },
    requiredFacts: ['currentAppointmentExists', 'appointmentMissedOrRescheduleRequested'],
    ownerAfter: queue('COORDINATOR', 'RECEIVING'),
    dueAtRule: { slaKey: 'appointmentAttendanceGrace', base: 'SCHEDULED_AT' },
    notificationTemplate: 'appointment_rescheduled',
    eventType: 'APPOINTMENT_RESCHEDULED',
  },
  CLOSE_SCHEDULED_PATIENT_DECLINED: {
    providerRules: ownDoctor,
    requiredFacts: ['patientDeclineRecorded'],
    ...close('PATIENT_DECLINED'),
  },
  CLOSE_SCHEDULED_UNREACHABLE: {
    providerRules: ownDoctor,
    requiredFacts: ['failedContactAttemptsForMilestone', 'escalationEventExists'],
    ...close('UNREACHABLE_AFTER_ATTEMPTS'),
  },
  CLOSE_SCHEDULED_TRANSFERRED_OUT: {
    providerRules: ownDoctor,
    requiredFacts: [],
    ...close('TRANSFERRED_OUT'),
  },
  CLOSE_COMPLETED_CARE: {
    providerRules: { DOCTOR: 'RECEIVING_PROVIDER' },
    requiredFacts: ['attendedAppointmentExists'],
    ...close('COMPLETED_CARE'),
  },
  CLOSE_CARE_TRANSFERRED_OUT: {
    providerRules: ownDoctor,
    requiredFacts: [],
    ...close('TRANSFERRED_OUT'),
  },
} satisfies Record<TransitionKey, TransitionPolicy>;

/** One enriched entry per shared transition key; shared owns key/state/role/evidence vocabulary. */
export const transitionTable = Object.fromEntries(
  transitionMatrix.map((sharedRow) => {
    const policy = policies[sharedRow.key];
    return [
      sharedRow.key,
      {
        ...sharedRow,
        ...policy,
        key: sharedRow.key,
        from: sharedRow.from,
        to: sharedRow.to,
        allowedRoles: sharedRow.allowedRoles,
        evidenceSchema: TransitionEvidenceSchemas[sharedRow.key],
      },
    ];
  }),
) as unknown as Record<TransitionKey, TransitionDefinition>;

