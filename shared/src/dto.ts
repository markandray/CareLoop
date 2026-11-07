import { z } from 'zod';
import {
  ActorTypeSchema,
  AppointmentStatusSchema,
  CaseEventTypeSchema,
  CaseStateSchema,
  ClosureReasonSchema,
  ConsentScopeSchema,
  ConsultKindSchema,
  ConsultStatusSchema,
  ContactChannelSchema,
  ContactOutcomeSchema,
  DelayReasonSchema,
  EscalationLevelSchema,
  EvidenceKindSchema,
  ExplanationSourceSchema,
  ExplanationStatusSchema,
  FollowUpStatusSchema,
  LanguageSchema,
  NotificationStatusSchema,
  NotificationTemplateKeySchema,
  ProviderTypeSchema,
  ReferralStatusSchema,
  RoleSchema,
  UrgencySchema,
} from './enums';
import {
  CaseIdSchema,
  CursorQuerySchema,
  DateOnlySchema,
  makeCursorPageSchema,
  NoteSchema,
  UtcTimestampSchema,
  UuidSchema,
} from './primitives';

const StrictObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict();

export const PatientSearchQuerySchema = StrictObject({
  query: z.string().trim().min(2).max(120),
  cursor: CursorQuerySchema.shape.cursor,
  limit: z.coerce.number().int().min(1).max(20).default(20),
});
export type PatientSearchQuery = z.infer<typeof PatientSearchQuerySchema>;

export const UpdatePatientProfileRequestSchema = StrictObject({
  preferredLanguage: LanguageSchema.optional(),
  preferredChannel: ContactChannelSchema.optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  'At least one profile field is required.',
);
export type UpdatePatientProfileRequest = z.infer<
  typeof UpdatePatientProfileRequestSchema
>;

export const LoginRequestSchema = StrictObject({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserSessionSchema = StrictObject({
  id: UuidSchema,
  email: z.string().email(),
  name: z.string(),
  role: RoleSchema,
  providerId: UuidSchema.nullable(),
  language: LanguageSchema,
});
export type UserSession = z.infer<typeof UserSessionSchema>;

export const PatientProfileSchema = StrictObject({
  id: UuidSchema,
  userId: UuidSchema,
  syntheticMrn: z.string(),
  dateOfBirth: DateOnlySchema,
  preferredLanguage: LanguageSchema,
  preferredChannel: ContactChannelSchema,
  updatedAt: UtcTimestampSchema,
});
export type PatientProfile = z.infer<typeof PatientProfileSchema>;

export const PatientSummarySchema = StrictObject({
  id: UuidSchema,
  name: z.string(),
  syntheticMrn: z.string(),
  dateOfBirth: DateOnlySchema,
  preferredLanguage: LanguageSchema,
  preferredChannel: ContactChannelSchema,
});
export type PatientSummary = z.infer<typeof PatientSummarySchema>;

export const PatientSearchResultSchema = StrictObject({
  id: UuidSchema,
  displayName: z.string(),
  syntheticMrn: z.string(),
  preferredLanguage: LanguageSchema,
});
export type PatientSearchResult = z.infer<typeof PatientSearchResultSchema>;
export const PatientSearchPageSchema = makeCursorPageSchema(PatientSearchResultSchema);
export type PatientSearchPage = z.infer<typeof PatientSearchPageSchema>;

export const CaseOwnerSchema = z.discriminatedUnion('kind', [
  StrictObject({
    kind: z.literal('USER'),
    userId: UuidSchema,
    name: z.string(),
  }),
  StrictObject({
    kind: z.literal('QUEUE'),
    role: RoleSchema,
    providerId: UuidSchema,
  }),
  StrictObject({ kind: z.literal('UNASSIGNED') }),
]);
export type CaseOwner = z.infer<typeof CaseOwnerSchema>;

export const ProviderSummarySchema = StrictObject({
  id: UuidSchema,
  name: z.string(),
  type: ProviderTypeSchema,
});
export type ProviderSummary = z.infer<typeof ProviderSummarySchema>;

export const ProviderStaffDtoSchema = StrictObject({
  id: UuidSchema,
  name: z.string(),
  role: RoleSchema,
});
export type ProviderStaffDto = z.infer<typeof ProviderStaffDtoSchema>;

export const ReviewDraftDtoSchema = StrictObject({
  resultCategoryCode: z.string(),
  nextStepCode: z.string(),
  urgencyLabel: UrgencySchema,
  route: z.enum(['CONFIRMATION', 'REFERRAL']),
  doctorNote: z.string().nullable(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: UtcTimestampSchema,
});
export type ReviewDraftDto = z.infer<typeof ReviewDraftDtoSchema>;

export const ReviewDraftFieldsSchema = StrictObject({
  resultCategoryCode: z.enum([
    'ROUTINE_FINDING', 'FOLLOW_UP_NEEDED', 'UNCLEAR_RESULT', 'CONFIRMATION_NEEDED', 'REVIEW_NEEDED',
  ]),
  nextStepCode: z.enum([
    'CONFIRMATORY_TEST', 'SPECIALIST_REFERRAL', 'FOLLOW_UP_CLINICIAN', 'REPEAT_SCREENING', 'CARE_TEAM_CONTACT', 'NO_ACTION_NOW',
  ]),
  urgencyLabel: UrgencySchema,
  route: z.enum(['CONFIRMATION', 'REFERRAL']),
  doctorNote: z.string().trim().max(2000).optional(),
});
export type ReviewDraftFields = z.infer<typeof ReviewDraftFieldsSchema>;

export const ExplanationSectionsSchema = StrictObject({
  resultMeaning: z.string(),
  nextStep: z.string(),
  meaningAndDiagnosis: z.string(),
  contactClinic: z.string(),
  limitations: z.string(),
  doctorNote: z.string().nullable(),
});
export type ExplanationSections = z.infer<typeof ExplanationSectionsSchema>;

export const ExplanationOutputSchema = StrictObject({
  language: LanguageSchema,
  sections: ExplanationSectionsSchema,
  disclaimer: z.string(),
  clinicallyReviewed: z.boolean(),
  notTranslatedNote: z.string().optional(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ExplanationOutput = z.infer<typeof ExplanationOutputSchema>;

export const DemoClockDtoSchema = StrictObject({
  now: UtcTimestampSchema,
  offsetMs: z.number().int(),
  isSimulated: z.boolean(),
});
export type DemoClockDto = z.infer<typeof DemoClockDtoSchema>;

export const CaseEventSummarySchema = StrictObject({
  id: UuidSchema,
  type: CaseEventTypeSchema,
  fromState: CaseStateSchema.nullable(),
  toState: CaseStateSchema.nullable(),
  actorType: ActorTypeSchema,
  actorId: UuidSchema.nullable(),
  actorName: z.string().nullable(),
  createdAt: UtcTimestampSchema,
});
export type CaseEventSummary = z.infer<typeof CaseEventSummarySchema>;

export const CaseEventDtoPatientSchema = StrictObject({
  id: UuidSchema,
  label: z.string(),
  timestamp: UtcTimestampSchema,
  patientStatus: z.string(),
});
export type CaseEventDtoPatient = z.infer<typeof CaseEventDtoPatientSchema>;

export const CaseEventDtoStaffSchema = CaseEventSummarySchema.extend({
  payload: z.record(z.unknown()).nullable(),
}).strict();
export type CaseEventDtoStaff = z.infer<typeof CaseEventDtoStaffSchema>;

export const ExplanationDtoSchema = StrictObject({
  id: UuidSchema,
  language: LanguageSchema,
  text: z.string(),
  source: ExplanationSourceSchema,
  status: ExplanationStatusSchema,
  approvedBy: UuidSchema.nullable(),
  approvedAt: UtcTimestampSchema.nullable(),
  updatedAt: UtcTimestampSchema,
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  current: z.boolean(),
  stale: z.boolean().optional(),
  reviewNotice: z.enum(['NONE', 'UNREVIEWED_TRANSLATION']),
  doctorNoteSection: z.object({ label: z.literal('Not translated'), text: z.string() }).strict().nullable(),
});
export type ExplanationDto = z.infer<typeof ExplanationDtoSchema>;

export const ReferralSummarySchema = StrictObject({
  id: UuidSchema,
  toProvider: ProviderSummarySchema,
  status: ReferralStatusSchema,
  reason: z.string().nullable(),
  respondedAt: UtcTimestampSchema.nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export type ReferralSummary = z.infer<typeof ReferralSummarySchema>;

export const AppointmentSummarySchema = StrictObject({
  id: UuidSchema,
  scheduledAt: UtcTimestampSchema,
  status: AppointmentStatusSchema,
  attendedAt: UtcTimestampSchema.nullable(),
  delayReason: DelayReasonSchema.nullable(),
  location: z.string().nullable(),
  updatedAt: UtcTimestampSchema,
});
export type AppointmentSummary = z.infer<typeof AppointmentSummarySchema>;

const CaseIdentityFields = {
  id: CaseIdSchema,
  state: CaseStateSchema,
  intakeUrgency: UrgencySchema,
  urgencyLabel: UrgencySchema.nullable(),
  dueAt: UtcTimestampSchema.nullable(),
  notifiedAt: UtcTimestampSchema.nullable(),
  acknowledgedAt: UtcTimestampSchema.nullable(),
  understandingConfirmedAt: UtcTimestampSchema.nullable(),
  escalationLevel: EscalationLevelSchema,
  escalatedAt: UtcTimestampSchema.nullable(),
  reassignmentCount: z.number().int().nonnegative(),
  closureReason: ClosureReasonSchema.nullable(),
  closedAt: UtcTimestampSchema.nullable(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
};

export const CaseDetailPatientSchema = StrictObject({
  ...CaseIdentityFields,
  pathway: z.string(),
  screeningType: z.string(),
  statusLabel: z.string(),
  statusDescription: z.string(),
  approvedExplanation: ExplanationDtoSchema.nullable(),
  recommendedNextStep: z.string().nullable(),
  referrals: z.array(ReferralSummarySchema),
  appointments: z.array(AppointmentSummarySchema),
  events: z.array(CaseEventDtoPatientSchema),
});
export type CaseDetailPatient = z.infer<typeof CaseDetailPatientSchema>;

export const CaseDetailDoctorSchema = StrictObject({
  ...CaseIdentityFields,
  pathway: z.string(),
  screeningType: z.string(),
  resultCategory: z.string(),
  resultSummaryApproved: z.string().nullable(),
  recommendedNextStep: z.string().nullable(),
  patient: PatientSummarySchema,
  originProvider: ProviderSummarySchema,
  owner: CaseOwnerSchema,
  attention: z.object({ level: z.enum(['LOW', 'MEDIUM', 'HIGH']), score: z.number().int().nonnegative() }).strict(),
  referrals: z.array(ReferralSummarySchema),
  appointments: z.array(AppointmentSummarySchema),
  explanations: z.array(ExplanationDtoSchema),
  events: z.array(CaseEventDtoStaffSchema),
});
export type CaseDetailDoctor = z.infer<typeof CaseDetailDoctorSchema>;

export const CaseDetailCoordinatorSchema = StrictObject({
  ...CaseIdentityFields,
  pathway: z.string(),
  screeningType: z.string(),
  // Intentionally excludes resultCategory and resultSummaryApproved.
  approvedExplanation: ExplanationDtoSchema.nullable(),
  recommendedNextStep: z.string().nullable(),
  patient: PatientSummarySchema,
  originProvider: ProviderSummarySchema,
  owner: CaseOwnerSchema,
  attention: z.object({ level: z.enum(['LOW', 'MEDIUM', 'HIGH']), score: z.number().int().nonnegative() }).strict(),
  referrals: z.array(ReferralSummarySchema),
  appointments: z.array(AppointmentSummarySchema),
  events: z.array(CaseEventDtoStaffSchema),
});
export type CaseDetailCoordinator = z.infer<typeof CaseDetailCoordinatorSchema>;

export const CaseDetailAdminSchema = StrictObject({
  ...CaseIdentityFields,
  pathway: z.string(),
  screeningType: z.string(),
  resultCategory: z.string(),
  resultSummaryApproved: z.string().nullable(),
  recommendedNextStep: z.string().nullable(),
  patient: PatientSummarySchema,
  originProvider: ProviderSummarySchema,
  owner: CaseOwnerSchema,
  attention: z.object({ level: z.enum(['LOW', 'MEDIUM', 'HIGH']), score: z.number().int().nonnegative() }).strict(),
  referrals: z.array(ReferralSummarySchema),
  appointments: z.array(AppointmentSummarySchema),
  explanations: z.array(ExplanationDtoSchema),
  events: z.array(CaseEventDtoStaffSchema),
});
export type CaseDetailAdmin = z.infer<typeof CaseDetailAdminSchema>;

export const ReferralPacketSchema = StrictObject({
  referralId: UuidSchema,
  caseId: CaseIdSchema,
  patient: PatientSummarySchema,
  referralReason: z.string(),
  approvedExplanation: ExplanationDtoSchema,
  recommendedNextStep: z.string().nullable(),
  urgencyLabel: UrgencySchema,
  receivingProvider: ProviderSummarySchema,
  status: ReferralStatusSchema,
  respondedAt: UtcTimestampSchema.nullable(),
  appointments: z.array(AppointmentSummarySchema),
  updatedAt: UtcTimestampSchema,
});
export type ReferralPacket = z.infer<typeof ReferralPacketSchema>;

export const CaseListItemSchema = StrictObject({
  id: CaseIdSchema,
  state: CaseStateSchema,
  urgencyLabel: UrgencySchema.nullable(),
  owner: CaseOwnerSchema,
  dueAt: UtcTimestampSchema.nullable(),
  escalationLevel: EscalationLevelSchema,
  escalatedAt: UtcTimestampSchema.nullable(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  attention: z.object({ level: z.enum(['LOW', 'MEDIUM', 'HIGH']), score: z.number().int().nonnegative() }).strict().optional(),
});
export type CaseListItem = z.infer<typeof CaseListItemSchema>;

export const CaseListQuerySchema = CursorQuerySchema.extend({
  state: CaseStateSchema.optional(),
  ownerUserId: UuidSchema.optional(),
  attentionOnly: z.coerce.boolean().optional(),
  updatedSince: UtcTimestampSchema.optional(),
}).strict();
export type CaseListQuery = z.infer<typeof CaseListQuerySchema>;

export const CaseEventPatientListItemSchema = CaseEventDtoPatientSchema;
export const CaseEventStaffListItemSchema = CaseEventDtoStaffSchema;
export type CaseEventPatientListItem = z.infer<
  typeof CaseEventPatientListItemSchema
>;
export type CaseEventStaffListItem = z.infer<
  typeof CaseEventStaffListItemSchema
>;
export const EvidenceDtoSchema = StrictObject({
  id: UuidSchema,
  kind: EvidenceKindSchema,
  recordedBy: UuidSchema,
  details: z.record(z.unknown()),
  createdAt: UtcTimestampSchema,
});
export type EvidenceDto = z.infer<typeof EvidenceDtoSchema>;

export const CoordinatorEvidenceKindSchema = z.enum([
  'CONTACT_ATTEMPTS',
  'APPOINTMENT_SCHEDULED',
  'APPOINTMENT_ATTENDED',
  'APPOINTMENT_MISSED',
  'DELAY_REASON',
  'ESCALATION_RECORD',
  'CLOSURE_PROPOSAL',
]);
export const CoordinatorEvidenceDtoSchema = EvidenceDtoSchema.extend({
  kind: CoordinatorEvidenceKindSchema,
}).strict();
export type CoordinatorEvidenceDto = z.infer<
  typeof CoordinatorEvidenceDtoSchema
>;

export const ReferralDtoSchema = StrictObject({
  id: UuidSchema,
  caseId: CaseIdSchema,
  fromProviderId: UuidSchema,
  toProviderId: UuidSchema,
  status: ReferralStatusSchema,
  reason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  respondedAt: UtcTimestampSchema.nullable(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export type ReferralDto = z.infer<typeof ReferralDtoSchema>;

export const AppointmentDtoSchema = StrictObject({
  id: UuidSchema,
  referralId: UuidSchema,
  scheduledAt: UtcTimestampSchema,
  status: AppointmentStatusSchema,
  attendedAt: UtcTimestampSchema.nullable(),
  location: z.string().nullable(),
  delayReason: DelayReasonSchema.nullable(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export type AppointmentDto = z.infer<typeof AppointmentDtoSchema>;

export const ContactAttemptDtoSchema = StrictObject({
  id: UuidSchema,
  caseId: CaseIdSchema,
  byUserId: UuidSchema,
  milestoneState: CaseStateSchema,
  referralId: UuidSchema.nullable(),
  appointmentId: UuidSchema.nullable(),
  channel: ContactChannelSchema,
  outcome: ContactOutcomeSchema,
  delayReason: DelayReasonSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: UtcTimestampSchema,
});
export type ContactAttemptDto = z.infer<typeof ContactAttemptDtoSchema>;

export const NotificationDtoSchema = StrictObject({
  id: UuidSchema,
  caseId: CaseIdSchema,
  channel: ContactChannelSchema,
  language: LanguageSchema,
  templateKey: NotificationTemplateKeySchema,
  text: z.string(),
  reviewNotice: z.enum(['NONE', 'UNREVIEWED_TRANSLATION']),
  status: NotificationStatusSchema,
  createdAt: UtcTimestampSchema,
  sentAt: UtcTimestampSchema.nullable(),
  acknowledgedAt: UtcTimestampSchema.nullable(),
});
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

export const AcknowledgeNotificationResponseSchema = StrictObject({
  acknowledgedAt: UtcTimestampSchema,
  event: CaseEventDtoPatientSchema,
});
export type AcknowledgeNotificationResponse = z.infer<typeof AcknowledgeNotificationResponseSchema>;

export const ConsultDtoSchema = StrictObject({
  id: UuidSchema,
  caseId: CaseIdSchema,
  requesterId: UuidSchema,
  targetUserId: UuidSchema,
  kind: ConsultKindSchema,
  question: z.string(),
  response: z.string().nullable(),
  status: ConsultStatusSchema,
  createdAt: UtcTimestampSchema,
  answeredAt: UtcTimestampSchema.nullable(),
  updatedAt: UtcTimestampSchema,
});
export type ConsultDto = z.infer<typeof ConsultDtoSchema>;

export const FollowUpDtoSchema = StrictObject({
  id: UuidSchema,
  caseId: CaseIdSchema,
  action: z.string(),
  dueAt: UtcTimestampSchema,
  status: FollowUpStatusSchema,
  ownerId: UuidSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export type FollowUpDto = z.infer<typeof FollowUpDtoSchema>;

export const ConsentDtoSchema = StrictObject({
  id: UuidSchema,
  patientId: UuidSchema,
  providerId: UuidSchema,
  scope: ConsentScopeSchema,
  grantedAt: UtcTimestampSchema,
  revokedAt: UtcTimestampSchema.nullable(),
});
export type ConsentDto = z.infer<typeof ConsentDtoSchema>;

export const LoginResponseSchema = StrictObject({ user: UserSessionSchema });
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export const AuthMeResponseSchema = StrictObject({ user: UserSessionSchema });
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const CaseTransitionResponseSchema = StrictObject({
  case: z.union([
    CaseDetailPatientSchema,
    CaseDetailDoctorSchema,
    CaseDetailCoordinatorSchema,
    CaseDetailAdminSchema,
    ReferralPacketSchema,
  ]),
  event: CaseEventDtoStaffSchema,
});
export type CaseTransitionResponse = z.infer<
  typeof CaseTransitionResponseSchema
>;

export const AssignOwnerRequestSchema = StrictObject({ userId: UuidSchema });
export type AssignOwnerRequest = z.infer<typeof AssignOwnerRequestSchema>;

export const RejectReferralRequestSchema = StrictObject({
  rejectionReason: NoteSchema,
  note: z.string().trim().max(2000).optional(),
});
export type RejectReferralRequest = z.infer<typeof RejectReferralRequestSchema>;

export const ContactAttemptRequestSchema = StrictObject({
  channel: ContactChannelSchema,
  outcome: ContactOutcomeSchema,
  delayReason: DelayReasonSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type ContactAttemptRequest = z.infer<typeof ContactAttemptRequestSchema>;

export const RecordAttendanceRequestSchema = z.discriminatedUnion('status', [
  StrictObject({ status: z.literal('ATTENDED') }),
  StrictObject({
    status: z.literal('MISSED'),
    delayReason: DelayReasonSchema,
    note: z.string().trim().max(2000).optional(),
  }),
]);
export type RecordAttendanceRequest = z.infer<
  typeof RecordAttendanceRequestSchema
>;

export const DispatchNotificationRequestSchema = StrictObject({
  channel: ContactChannelSchema.default('PORTAL'),
});
export type DispatchNotificationRequest = z.infer<
  typeof DispatchNotificationRequestSchema
>;

export const AcknowledgeNotificationRequestSchema = StrictObject({});
export type AcknowledgeNotificationRequest = z.infer<
  typeof AcknowledgeNotificationRequestSchema
>;

export const ConfirmUnderstandingRequestSchema = StrictObject({
  explanationId: UuidSchema,
});
export type ConfirmUnderstandingRequest = z.infer<
  typeof ConfirmUnderstandingRequestSchema
>;

export const ConsentRequestNotificationRequestSchema = StrictObject({
  providerId: UuidSchema,
});
export type ConsentRequestNotificationRequest = z.infer<
  typeof ConsentRequestNotificationRequestSchema
>;

export const ConfirmatoryResultRequestSchema = StrictObject({
  resultCategory: z.string().trim().min(1).max(160),
  findings: z.string().trim().min(1).max(4000),
  recordedAt: UtcTimestampSchema.optional(),
});
export type ConfirmatoryResultRequest = z.infer<
  typeof ConfirmatoryResultRequestSchema
>;

export const ReviewDraftRequestSchema = ReviewDraftFieldsSchema;
export type ReviewDraftRequest = z.infer<typeof ReviewDraftRequestSchema>;

export const GenerateExplanationsRequestSchema = StrictObject({});
export type GenerateExplanationsRequest = z.infer<
  typeof GenerateExplanationsRequestSchema
>;
export const GenerateExplanationsResponseSchema = StrictObject({
  explanations: z.array(ExplanationDtoSchema).length(2),
});
export type GenerateExplanationsResponse = z.infer<
  typeof GenerateExplanationsResponseSchema
>;

export const DeclineCareRequestSchema = StrictObject({
  reason: NoteSchema,
});
export type DeclineCareRequest = z.infer<typeof DeclineCareRequestSchema>;

export const CreateConsultRequestSchema = StrictObject({
  kind: ConsultKindSchema,
  targetUserId: UuidSchema,
  question: z.string().trim().min(1).max(4000),
});
export type CreateConsultRequest = z.infer<typeof CreateConsultRequestSchema>;

export const AnswerConsultRequestSchema = StrictObject({
  response: z.string().trim().min(1).max(4000),
});
export type AnswerConsultRequest = z.infer<typeof AnswerConsultRequestSchema>;

export const GrantConsentRequestSchema = StrictObject({
  providerId: UuidSchema,
  scope: ConsentScopeSchema,
});
export type GrantConsentRequest = z.infer<typeof GrantConsentRequestSchema>;

export const ApproveExplanationRequestSchema = StrictObject({
  note: z.string().trim().max(2000).optional(),
});
export type ApproveExplanationRequest = z.infer<
  typeof ApproveExplanationRequestSchema
>;

export const ClosureProposalRequestSchema = StrictObject({
  closureReason: ClosureReasonSchema,
  rationale: NoteSchema,
  evidenceIds: z.array(UuidSchema).min(1),
});
export type ClosureProposalRequest = z.infer<
  typeof ClosureProposalRequestSchema
>;

export const ResolveEscalationRequestSchema = StrictObject({
  actionPlan: z.string().trim().min(10).max(500),
  delayReason: DelayReasonSchema.optional(),
});
export type ResolveEscalationRequest = z.infer<
  typeof ResolveEscalationRequestSchema
>;

export const AdvanceDemoClockRequestSchema = StrictObject({
  amount: z.number().positive().max(365),
  unit: z.enum(['MINUTES', 'HOURS', 'DAYS']),
});
export type AdvanceDemoClockRequest = z.infer<
  typeof AdvanceDemoClockRequestSchema
>;

export const ResetDemoRequestSchema = StrictObject({
  seed: z.number().int().optional(),
});
export type ResetDemoRequest = z.infer<typeof ResetDemoRequestSchema>;

export const CreateFollowUpRequestSchema = StrictObject({
  action: z.string().trim().min(1).max(1000),
  dueAt: UtcTimestampSchema,
  ownerId: UuidSchema,
});
export type CreateFollowUpRequest = z.infer<typeof CreateFollowUpRequestSchema>;

export const UpdateFollowUpRequestSchema = StrictObject({
  status: FollowUpStatusSchema,
});
export type UpdateFollowUpRequest = z.infer<typeof UpdateFollowUpRequestSchema>;

export const AdminConfigUpdateRequestSchema = StrictObject({
  value: z.unknown(),
  reason: NoteSchema,
});

export const AttentionLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const AttentionReasonSchema = StrictObject({
  code: z.string(),
  text: z.string(),
  points: z.number().int().nonnegative(),
});
export const AttentionResponseSchema = StrictObject({
  caseId: CaseIdSchema,
  attentionLevel: AttentionLevelSchema,
  score: z.number().int().nonnegative(),
  reasons: z.array(AttentionReasonSchema),
  suggestedAction: z.string(),
  label: z.literal(
    'Operational workflow rule, not a clinical risk assessment.',
  ),
  overdueBy: z.number().int().nonnegative(),
  slaPeriods: z.number().int().nonnegative(),
  updatedAt: UtcTimestampSchema,
});
export type AttentionResponse = z.infer<typeof AttentionResponseSchema>;

export const AttentionListQuerySchema = CursorQuerySchema.extend({
  minLevel: AttentionLevelSchema.optional(),
  minEscalation: EscalationLevelSchema.exclude(['LEVEL_0']).optional(),
  providerId: UuidSchema.optional(),
}).strict();
export type AttentionListQuery = z.infer<typeof AttentionListQuerySchema>;
export const AttentionQueueItemSchema = StrictObject({
  caseId: CaseIdSchema,
  state: CaseStateSchema,
  dueAt: UtcTimestampSchema.nullable(),
  escalationLevel: EscalationLevelSchema,
  escalatedAt: UtcTimestampSchema.nullable(),
  ...AttentionResponseSchema.omit({ caseId: true, updatedAt: true }).shape,
});
export const AttentionQueuePageSchema = makeCursorPageSchema(AttentionQueueItemSchema);
export type AttentionQueuePage = z.infer<typeof AttentionQueuePageSchema>;

export const MetricCohortBasisSchema = z.enum([
  'CASES_CREATED_MORE_THAN_30_DAYS_AGO_OR_CLOSED',
  'CASES_ENTERED_REFERRAL_PENDING_MORE_THAN_30_DAYS_AGO_OR_CLOSED',
  'CLOSED_CASES_ONLY',
  'ELIGIBLE_SCHEDULED_APPOINTMENTS',
  'CASES_WITH_DISPATCHED_RESULT_REVIEWED',
  'STATE_ENTRIES',
  'DROPOFF_CASES',
]);
export const AnalyticsMetricSchema = StrictObject({
  value: z.number().nullable(),
  median: z.number().nullable(),
  p90: z.number().nullable(),
  n: z.number().int().nonnegative(),
  cohortBasis: MetricCohortBasisSchema,
  suppressed: z.boolean(),
});
export type AnalyticsMetric = z.infer<typeof AnalyticsMetricSchema>;

export const AnalyticsResponseSchema = StrictObject({
  metrics: z.record(AnalyticsMetricSchema),
  byLanguage: z.record(
    StrictObject({
      acknowledgementRate: AnalyticsMetricSchema,
      attendanceRate: AnalyticsMetricSchema,
      careInitiationRate: AnalyticsMetricSchema,
    }),
  ),
  updatedAt: UtcTimestampSchema,
});
export type AnalyticsResponse = z.infer<typeof AnalyticsResponseSchema>;

export const AnalyticsQuerySchema = StrictObject({
  from: UtcTimestampSchema.optional(),
  to: UtcTimestampSchema.optional(),
  language: LanguageSchema.optional(),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

export const SimulationRunRequestSchema = StrictObject({
  seed: z.number().int(),
  cohortSize: z.number().int().min(3000).max(5000),
});
export const SimulationRunResponseSchema = StrictObject({
  id: UuidSchema,
  seed: z.number().int(),
  cohortSize: z.number().int(),
  baseline: z.record(AnalyticsMetricSchema),
  careLoop: z.record(AnalyticsMetricSchema),
  byLanguage: z.record(z.record(AnalyticsMetricSchema)),
  assumptionsNotice: z.string(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export type SimulationRunResponse = z.infer<typeof SimulationRunResponseSchema>;

export const AuditLogDtoSchema = StrictObject({
  id: UuidSchema,
  actorType: ActorTypeSchema,
  actorId: UuidSchema.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  createdAt: UtcTimestampSchema,
});
export type AuditLogDto = z.infer<typeof AuditLogDtoSchema>;

export const CursorQueryForCasesSchema = CaseListQuerySchema;
export const CaseCursorPageSchema = makeCursorPageSchema(CaseListItemSchema);
export const CaseEventPatientCursorPageSchema = makeCursorPageSchema(
  CaseEventPatientListItemSchema,
);
export const CaseEventStaffCursorPageSchema = makeCursorPageSchema(
  CaseEventStaffListItemSchema,
);
export const ReferralCursorPageSchema = makeCursorPageSchema(ReferralDtoSchema);
export const AppointmentCursorPageSchema =
  makeCursorPageSchema(AppointmentDtoSchema);
export const ContactAttemptCursorPageSchema = makeCursorPageSchema(
  ContactAttemptDtoSchema,
);
export const NotificationCursorPageSchema = makeCursorPageSchema(
  NotificationDtoSchema,
);
export const ConsultCursorPageSchema = makeCursorPageSchema(ConsultDtoSchema);
export const AuditLogCursorPageSchema = makeCursorPageSchema(AuditLogDtoSchema);
export type CaseCursorPage = z.infer<typeof CaseCursorPageSchema>;
export type CaseEventPatientCursorPage = z.infer<
  typeof CaseEventPatientCursorPageSchema
>;
export type CaseEventStaffCursorPage = z.infer<
  typeof CaseEventStaffCursorPageSchema
>;
export type ReferralCursorPage = z.infer<typeof ReferralCursorPageSchema>;
export type AppointmentCursorPage = z.infer<typeof AppointmentCursorPageSchema>;
export type ContactAttemptCursorPage = z.infer<
  typeof ContactAttemptCursorPageSchema
>;
export type NotificationCursorPage = z.infer<
  typeof NotificationCursorPageSchema
>;
export type ConsultCursorPage = z.infer<typeof ConsultCursorPageSchema>;
export type AuditLogCursorPage = z.infer<typeof AuditLogCursorPageSchema>;
export const ProviderCursorPageSchema = makeCursorPageSchema(
  ProviderSummarySchema,
);
export const ProviderStaffCursorPageSchema = makeCursorPageSchema(
  ProviderStaffDtoSchema,
);
export const EvidenceCursorPageSchema = makeCursorPageSchema(EvidenceDtoSchema);
export const CoordinatorEvidenceCursorPageSchema = makeCursorPageSchema(
  CoordinatorEvidenceDtoSchema,
);
export type ProviderCursorPage = z.infer<typeof ProviderCursorPageSchema>;
export type ProviderStaffCursorPage = z.infer<
  typeof ProviderStaffCursorPageSchema
>;
export type EvidenceCursorPage = z.infer<typeof EvidenceCursorPageSchema>;
export type CoordinatorEvidenceCursorPage = z.infer<
  typeof CoordinatorEvidenceCursorPageSchema
>;
