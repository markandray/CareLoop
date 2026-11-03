import { z } from 'zod';

// These persisted enums are kept in the same vocabulary and order as Prisma.
export const RoleSchema = z.enum(['PATIENT', 'DOCTOR', 'COORDINATOR', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const ActorTypeSchema = z.enum(['USER', 'SYSTEM']);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const CaseStateSchema = z.enum([
  'NEW',
  'CLINICIAN_REVIEWED',
  'CONFIRMATION_PENDING',
  'REFERRAL_PENDING',
  'REFERRAL_ACCEPTED',
  'APPOINTMENT_SCHEDULED',
  'CARE_STARTED',
  'CLOSED',
]);
export type CaseState = z.infer<typeof CaseStateSchema>;

export const FollowUpStatusSchema = z.enum(['OPEN', 'COMPLETED', 'CANCELLED']);
export type FollowUpStatus = z.infer<typeof FollowUpStatusSchema>;

export const UrgencySchema = z.enum(['ROUTINE', 'URGENT']);
export type Urgency = z.infer<typeof UrgencySchema>;

export const ClosureReasonSchema = z.enum([
  'COMPLETED_CARE',
  'NOT_CONFIRMED',
  'PATIENT_DECLINED',
  'UNREACHABLE_AFTER_ATTEMPTS',
  'TRANSFERRED_OUT',
]);
export type ClosureReason = z.infer<typeof ClosureReasonSchema>;

export const EscalationLevelSchema = z.enum([
  'LEVEL_0',
  'LEVEL_1',
  'LEVEL_2',
  'LEVEL_3',
]);
export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;

export const ReferralStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'SUPERSEDED',
]);
export type ReferralStatus = z.infer<typeof ReferralStatusSchema>;

export const AppointmentStatusSchema = z.enum([
  'SCHEDULED',
  'ATTENDED',
  'MISSED',
  'RESCHEDULED',
]);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const ConsultKindSchema = z.enum([
  'PATIENT_TO_CLINICIAN',
  'CLINICIAN_TO_CLINICIAN',
]);
export type ConsultKind = z.infer<typeof ConsultKindSchema>;

export const ConsultStatusSchema = z.enum(['OPEN', 'ANSWERED']);
export type ConsultStatus = z.infer<typeof ConsultStatusSchema>;

export const ExplanationStatusSchema = z.enum(['DRAFT', 'APPROVED']);
export type ExplanationStatus = z.infer<typeof ExplanationStatusSchema>;

export const ExplanationSourceSchema = z.enum(['TEMPLATE', 'LLM']);
export type ExplanationSource = z.infer<typeof ExplanationSourceSchema>;

export const LanguageSchema = z.enum(['EN', 'AR', 'OTHER']);
export type Language = z.infer<typeof LanguageSchema>;

export const ProviderTypeSchema = z.enum([
  'SCREENING_CENTRE',
  'HOSPITAL',
  'CLINIC',
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const ContactChannelSchema = z.enum(['PHONE', 'SMS', 'EMAIL', 'PORTAL']);
export type ContactChannel = z.infer<typeof ContactChannelSchema>;

export const ContactOutcomeSchema = z.enum(['REACHED', 'NO_ANSWER', 'FAILED']);
export type ContactOutcome = z.infer<typeof ContactOutcomeSchema>;

export const NotificationStatusSchema = z.enum(['QUEUED', 'SENT']);
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

export const ConsentScopeSchema = z.enum(['CROSS_PROVIDER_REFERRAL']);
export type ConsentScope = z.infer<typeof ConsentScopeSchema>;

export const DelayReasonSchema = z.enum([
  'PATIENT_UNREACHABLE',
  'PROVIDER_DELAY',
  'NO_SLOT_AVAILABLE',
  'APPOINTMENT_RESCHEDULED',
  'PATIENT_DECLINED',
  'DOCUMENTATION_PENDING',
  'TRANSPORT_OR_LOGISTICS',
  'OTHER',
]);
export type DelayReason = z.infer<typeof DelayReasonSchema>;

export const NotificationTemplateKeySchema = z.enum([
  'result_reviewed',
  'consent_needed',
  'awaiting_confirmation',
  'referral_started',
  'referral_accepted',
  'referral_reassigned',
  'appointment_scheduled',
  'appointment_rescheduled',
  'care_started',
  'care_closed',
  'followup_due',
  'unreachable_retry',
  'consult_pending',
]);
export type NotificationTemplateKey = z.infer<
  typeof NotificationTemplateKeySchema
>;

export const CaseEventTypeSchema = z.enum([
  'CASE_CREATED',
  'CASE_REVIEWED',
  'CONFIRMATION_REQUESTED',
  'REFERRAL_CREATED',
  'CASE_CLOSED',
  'REFERRAL_ACCEPTED',
  'REFERRAL_REASSIGNED',
  'APPOINTMENT_SCHEDULED',
  'CARE_STARTED',
  'APPOINTMENT_RESCHEDULED',
  'OWNER_ASSIGNED',
  'NOTIFICATION_QUEUED',
  'NOTIFICATION_SENT',
  'NOTIFICATION_ACKNOWLEDGED',
  'UNDERSTANDING_CONFIRMED',
  'CARE_DECLINED_BY_PATIENT',
  'EXPLANATION_GENERATED',
  'EXPLANATION_APPROVED',
  'CONFIRMATORY_RESULT_RECORDED',
  'APPOINTMENT_ATTENDED',
  'APPOINTMENT_MISSED',
  'CONTACT_ATTEMPT_LOGGED',
  'REFERRAL_REJECTED',
  'CONSULT_REQUESTED',
  'CONSULT_ANSWERED',
  'ESCALATION_RAISED',
  'ESCALATION_CLEARED',
  'CONSENT_GRANTED',
  'CONSENT_REVOKED',
  'DELAY_REASON_RECORDED',
  'CLOSURE_PROPOSED',
]);
export type CaseEventType = z.infer<typeof CaseEventTypeSchema>;

export const EvidenceKindSchema = z.enum([
  'SCREENING_INTAKE',
  'APPROVED_CLINICAL_PLAN',
  'APPROVED_EXPLANATION',
  'CONFIRMATION_TASK_CREATED',
  'NOTIFICATION_DISPATCHED',
  'REFERRAL_CREATED',
  'CONSENT_VERIFIED',
  'PATIENT_DECLINE',
  'CONFIRMATORY_RESULT',
  'REFERRAL_ACCEPTANCE',
  'REFERRAL_REJECTION',
  'REFERRAL_REASSIGNMENT',
  'APPOINTMENT_SCHEDULED',
  'APPOINTMENT_ATTENDED',
  'APPOINTMENT_MISSED',
  'DELAY_REASON',
  'CONTACT_ATTEMPTS',
  'ESCALATION_RECORD',
  'UNREACHABLE_STATUS',
  'EXTERNAL_TRANSFER',
  'CARE_PLAN',
  'CARE_COMPLETION',
  'CLINICIAN_SIGN_OFF',
  'CLOSURE_PROPOSAL',
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

// API-only keys: one key for each row in docs/02-Product-Requirements.md §1.1.
export const TransitionKeySchema = z.enum([
  'CREATE_CASE',
  'REVIEW_CASE',
  'REQUEST_CONFIRMATION',
  'CREATE_REFERRAL_FROM_REVIEW',
  'CLOSE_AFTER_REVIEW_PATIENT_DECLINED',
  'CREATE_REFERRAL_AFTER_CONFIRMATION',
  'CLOSE_NOT_CONFIRMED',
  'CLOSE_CONFIRMATION_PATIENT_DECLINED',
  'CLOSE_CONFIRMATION_UNREACHABLE',
  'ACCEPT_REFERRAL',
  'REASSIGN_REFERRAL',
  'CLOSE_REFERRAL_PATIENT_DECLINED',
  'CLOSE_REFERRAL_UNREACHABLE',
  'CLOSE_REFERRAL_TRANSFERRED_OUT',
  'SCHEDULE_APPOINTMENT',
  'CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED',
  'CLOSE_ACCEPTED_REFERRAL_UNREACHABLE',
  'CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT',
  'START_CARE',
  'RESCHEDULE_APPOINTMENT',
  'CLOSE_SCHEDULED_PATIENT_DECLINED',
  'CLOSE_SCHEDULED_UNREACHABLE',
  'CLOSE_SCHEDULED_TRANSFERRED_OUT',
  'CLOSE_COMPLETED_CARE',
  'CLOSE_CARE_TRANSFERRED_OUT',
]);
export type TransitionKey = z.infer<typeof TransitionKeySchema>;

export const PrismaEnumSchemas = {
  Role: RoleSchema,
  ActorType: ActorTypeSchema,
  CaseState: CaseStateSchema,
  FollowUpStatus: FollowUpStatusSchema,
  Urgency: UrgencySchema,
  ClosureReason: ClosureReasonSchema,
  EscalationLevel: EscalationLevelSchema,
  ReferralStatus: ReferralStatusSchema,
  AppointmentStatus: AppointmentStatusSchema,
  ConsultKind: ConsultKindSchema,
  ConsultStatus: ConsultStatusSchema,
  ExplanationStatus: ExplanationStatusSchema,
  ExplanationSource: ExplanationSourceSchema,
  Language: LanguageSchema,
  ProviderType: ProviderTypeSchema,
  ContactChannel: ContactChannelSchema,
  ContactOutcome: ContactOutcomeSchema,
  NotificationStatus: NotificationStatusSchema,
  ConsentScope: ConsentScopeSchema,
  DelayReason: DelayReasonSchema,
  NotificationTemplateKey: NotificationTemplateKeySchema,
  CaseEventType: CaseEventTypeSchema,
  EvidenceKind: EvidenceKindSchema,
} as const;
