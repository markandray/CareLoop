import { z } from 'zod';
import {
  CaseStateSchema,
  DelayReasonSchema,
  RoleSchema,
  TransitionKeySchema,
  UrgencySchema,
} from './enums';
import { UtcTimestampSchema, UuidSchema } from './primitives';

const DocumentedClosureFields = {
  documentedReason: z.string().trim().min(1).max(2000),
  closureProposalId: UuidSchema.optional(),
};
const TransferFields = {
  externalProviderName: z.string().trim().min(1).max(200),
  facilityContact: z.string().trim().min(1).max(500),
  handoverSummary: z.string().trim().min(1).max(4000),
};
const UnreachableClosureFields = {
  closureReason: z.literal('UNREACHABLE_AFTER_ATTEMPTS'),
  ...DocumentedClosureFields,
};

export const TransitionEvidenceSchemas = {
  CREATE_CASE: z
    .object({
      patientId: UuidSchema,
      originProviderId: UuidSchema,
      pathway: z.string().trim().min(1).max(160),
      screeningType: z.string().trim().min(1).max(160),
      resultCategory: z.string().trim().min(1).max(160),
      preliminarySummary: z.string().trim().min(1).max(4000),
      recommendedAction: z.string().trim().min(1).max(2000),
      intakeUrgency: UrgencySchema,
      assignedDoctorId: UuidSchema.optional(),
    })
    .strict(),
  REVIEW_CASE: z
    .object({
      approvedExplanationIds: z.array(UuidSchema).length(2),
    })
    .strict()
    .refine(
      ({ approvedExplanationIds }) =>
        approvedExplanationIds[0] !== approvedExplanationIds[1],
      'The approved English and Arabic explanations must be distinct drafts.',
    ),
  REQUEST_CONFIRMATION: z.object({}).strict(),
  CREATE_REFERRAL_FROM_REVIEW: z
    .object({
      toProviderId: UuidSchema,
      referralReason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  CLOSE_AFTER_REVIEW_PATIENT_DECLINED: z
    .object({
      closureReason: z.literal('PATIENT_DECLINED'),
      ...DocumentedClosureFields,
    })
    .strict(),
  CREATE_REFERRAL_AFTER_CONFIRMATION: z
    .object({
      toProviderId: UuidSchema,
      referralReason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  CLOSE_NOT_CONFIRMED: z
    .object({
      closureReason: z.literal('NOT_CONFIRMED'),
      ...DocumentedClosureFields,
    })
    .strict(),
  CLOSE_CONFIRMATION_PATIENT_DECLINED: z
    .object({
      closureReason: z.literal('PATIENT_DECLINED'),
      ...DocumentedClosureFields,
    })
    .strict(),
  CLOSE_CONFIRMATION_UNREACHABLE: z
    .object({ ...UnreachableClosureFields })
    .strict(),
  ACCEPT_REFERRAL: z.object({ referralId: UuidSchema }).strict(),
  REASSIGN_REFERRAL: z
    .object({
      toProviderId: UuidSchema,
      referralReason: z.string().trim().min(1).max(2000),
      rejectionReason: z.string().trim().min(1).max(2000).optional(),
    })
    .strict(),
  CLOSE_REFERRAL_PATIENT_DECLINED: z
    .object({
      closureReason: z.literal('PATIENT_DECLINED'),
      ...DocumentedClosureFields,
    })
    .strict(),
  CLOSE_REFERRAL_UNREACHABLE: z
    .object({ ...UnreachableClosureFields })
    .strict(),
  CLOSE_REFERRAL_TRANSFERRED_OUT: z
    .object({
      closureReason: z.literal('TRANSFERRED_OUT'),
      ...DocumentedClosureFields,
      ...TransferFields,
    })
    .strict(),
  SCHEDULE_APPOINTMENT: z
    .object({
      scheduledAt: UtcTimestampSchema,
      location: z.string().trim().min(1).max(500),
    })
    .strict(),
  CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED: z
    .object({
      closureReason: z.literal('PATIENT_DECLINED'),
      ...DocumentedClosureFields,
    })
    .strict(),
  CLOSE_ACCEPTED_REFERRAL_UNREACHABLE: z
    .object({ ...UnreachableClosureFields })
    .strict(),
  CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT: z
    .object({
      closureReason: z.literal('TRANSFERRED_OUT'),
      ...DocumentedClosureFields,
      ...TransferFields,
    })
    .strict(),
  START_CARE: z
    .object({
      carePlan: z.string().trim().min(1).max(4000),
      followUpAt: UtcTimestampSchema.optional(),
    })
    .strict(),
  RESCHEDULE_APPOINTMENT: z
    .object({
      scheduledAt: UtcTimestampSchema,
      location: z.string().trim().min(1).max(500),
    })
    .strict(),
  CLOSE_SCHEDULED_PATIENT_DECLINED: z
    .object({
      closureReason: z.literal('PATIENT_DECLINED'),
      ...DocumentedClosureFields,
    })
    .strict(),
  CLOSE_SCHEDULED_UNREACHABLE: z
    .object({ ...UnreachableClosureFields })
    .strict(),
  CLOSE_SCHEDULED_TRANSFERRED_OUT: z
    .object({
      closureReason: z.literal('TRANSFERRED_OUT'),
      ...DocumentedClosureFields,
      ...TransferFields,
    })
    .strict(),
  CLOSE_COMPLETED_CARE: z
    .object({
      closureReason: z.literal('COMPLETED_CARE'),
      ...DocumentedClosureFields,
      careCompletionSummary: z.string().trim().min(1).max(4000),
      postTreatmentFindings: z.string().trim().min(1).max(4000).optional(),
      surveillancePlan: z.string().trim().min(1).max(4000).optional(),
    })
    .strict(),
  CLOSE_CARE_TRANSFERRED_OUT: z
    .object({
      closureReason: z.literal('TRANSFERRED_OUT'),
      ...DocumentedClosureFields,
      ...TransferFields,
    })
    .strict(),
} as const;

export type TransitionEvidenceByKey = {
  [K in keyof typeof TransitionEvidenceSchemas]: z.infer<
    (typeof TransitionEvidenceSchemas)[K]
  >;
};

const optionalRequestFields = {
  expectedState: CaseStateSchema,
  note: z.string().trim().max(2000).optional(),
  delayReason: DelayReasonSchema.optional(),
};

const requestOption = <
  K extends Exclude<keyof typeof TransitionEvidenceSchemas, 'CREATE_CASE'>,
>(
  key: K,
) =>
  z
    .object({
      transitionKey: z.literal(key),
      evidence: TransitionEvidenceSchemas[key],
      ...optionalRequestFields,
    })
    .strict();

export const CreateCaseRequestSchema = z
  .object({
    transitionKey: z.literal('CREATE_CASE'),
    evidence: TransitionEvidenceSchemas.CREATE_CASE,
  })
  .strict();
export type CreateCaseRequest = z.infer<typeof CreateCaseRequestSchema>;

export const TransitionRequestSchema = z.discriminatedUnion('transitionKey', [
  requestOption('REVIEW_CASE'),
  requestOption('REQUEST_CONFIRMATION'),
  requestOption('CREATE_REFERRAL_FROM_REVIEW'),
  requestOption('CLOSE_AFTER_REVIEW_PATIENT_DECLINED'),
  requestOption('CREATE_REFERRAL_AFTER_CONFIRMATION'),
  requestOption('CLOSE_NOT_CONFIRMED'),
  requestOption('CLOSE_CONFIRMATION_PATIENT_DECLINED'),
  requestOption('CLOSE_CONFIRMATION_UNREACHABLE'),
  requestOption('ACCEPT_REFERRAL'),
  requestOption('REASSIGN_REFERRAL'),
  requestOption('CLOSE_REFERRAL_PATIENT_DECLINED'),
  requestOption('CLOSE_REFERRAL_UNREACHABLE'),
  requestOption('CLOSE_REFERRAL_TRANSFERRED_OUT'),
  requestOption('SCHEDULE_APPOINTMENT'),
  requestOption('CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED'),
  requestOption('CLOSE_ACCEPTED_REFERRAL_UNREACHABLE'),
  requestOption('CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT'),
  requestOption('START_CARE'),
  z
    .object({
      transitionKey: z.literal('RESCHEDULE_APPOINTMENT'),
      evidence: TransitionEvidenceSchemas.RESCHEDULE_APPOINTMENT,
      ...optionalRequestFields,
      delayReason: DelayReasonSchema,
    })
    .strict(),
  requestOption('CLOSE_SCHEDULED_PATIENT_DECLINED'),
  requestOption('CLOSE_SCHEDULED_UNREACHABLE'),
  requestOption('CLOSE_SCHEDULED_TRANSFERRED_OUT'),
  requestOption('CLOSE_COMPLETED_CARE'),
  requestOption('CLOSE_CARE_TRANSFERRED_OUT'),
]);
export type TransitionRequest = z.infer<typeof TransitionRequestSchema>;

const evidenceOption = <K extends keyof typeof TransitionEvidenceSchemas>(
  key: K,
) =>
  z
    .object({
      transitionKey: z.literal(key),
      evidence: TransitionEvidenceSchemas[key],
    })
    .strict();

export const TransitionEvidenceSchema = z.discriminatedUnion('transitionKey', [
  evidenceOption('CREATE_CASE'),
  evidenceOption('REVIEW_CASE'),
  evidenceOption('REQUEST_CONFIRMATION'),
  evidenceOption('CREATE_REFERRAL_FROM_REVIEW'),
  evidenceOption('CLOSE_AFTER_REVIEW_PATIENT_DECLINED'),
  evidenceOption('CREATE_REFERRAL_AFTER_CONFIRMATION'),
  evidenceOption('CLOSE_NOT_CONFIRMED'),
  evidenceOption('CLOSE_CONFIRMATION_PATIENT_DECLINED'),
  evidenceOption('CLOSE_CONFIRMATION_UNREACHABLE'),
  evidenceOption('ACCEPT_REFERRAL'),
  evidenceOption('REASSIGN_REFERRAL'),
  evidenceOption('CLOSE_REFERRAL_PATIENT_DECLINED'),
  evidenceOption('CLOSE_REFERRAL_UNREACHABLE'),
  evidenceOption('CLOSE_REFERRAL_TRANSFERRED_OUT'),
  evidenceOption('SCHEDULE_APPOINTMENT'),
  evidenceOption('CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED'),
  evidenceOption('CLOSE_ACCEPTED_REFERRAL_UNREACHABLE'),
  evidenceOption('CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT'),
  evidenceOption('START_CARE'),
  evidenceOption('RESCHEDULE_APPOINTMENT'),
  evidenceOption('CLOSE_SCHEDULED_PATIENT_DECLINED'),
  evidenceOption('CLOSE_SCHEDULED_UNREACHABLE'),
  evidenceOption('CLOSE_SCHEDULED_TRANSFERRED_OUT'),
  evidenceOption('CLOSE_COMPLETED_CARE'),
  evidenceOption('CLOSE_CARE_TRANSFERRED_OUT'),
]);
export type TransitionEvidence = z.infer<typeof TransitionEvidenceSchema>;

export interface TransitionMatrixEntry {
  key: z.infer<typeof TransitionKeySchema>;
  from: z.infer<typeof CaseStateSchema> | 'none';
  to: z.infer<typeof CaseStateSchema>;
  allowedRoles: ReadonlyArray<z.infer<typeof RoleSchema>>;
  evidenceFields: ReadonlyArray<string>;
}

export const transitionMatrix = [
  {
    key: 'CREATE_CASE',
    from: 'none',
    to: 'NEW',
    allowedRoles: ['DOCTOR', 'ADMIN'],
    evidenceFields: [
      'patientId',
      'originProviderId',
      'pathway',
      'screeningType',
      'resultCategory',
      'preliminarySummary',
      'recommendedAction',
      'intakeUrgency',
    ],
  },
  {
    key: 'REVIEW_CASE',
    from: 'NEW',
    to: 'CLINICIAN_REVIEWED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: ['approvedExplanationIds'],
  },
  {
    key: 'REQUEST_CONFIRMATION',
    from: 'CLINICIAN_REVIEWED',
    to: 'CONFIRMATION_PENDING',
    allowedRoles: ['COORDINATOR'],
    evidenceFields: [],
  },
  {
    key: 'CREATE_REFERRAL_FROM_REVIEW',
    from: 'CLINICIAN_REVIEWED',
    to: 'REFERRAL_PENDING',
    allowedRoles: ['COORDINATOR'],
    evidenceFields: ['toProviderId', 'referralReason'],
  },
  {
    key: 'CLOSE_AFTER_REVIEW_PATIENT_DECLINED',
    from: 'CLINICIAN_REVIEWED',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=PATIENT_DECLINED',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'CREATE_REFERRAL_AFTER_CONFIRMATION',
    from: 'CONFIRMATION_PENDING',
    to: 'REFERRAL_PENDING',
    allowedRoles: ['DOCTOR'],
    evidenceFields: ['toProviderId', 'referralReason'],
  },
  {
    key: 'CLOSE_NOT_CONFIRMED',
    from: 'CONFIRMATION_PENDING',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=NOT_CONFIRMED',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'CLOSE_CONFIRMATION_PATIENT_DECLINED',
    from: 'CONFIRMATION_PENDING',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=PATIENT_DECLINED',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'CLOSE_CONFIRMATION_UNREACHABLE',
    from: 'CONFIRMATION_PENDING',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=UNREACHABLE_AFTER_ATTEMPTS',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'ACCEPT_REFERRAL',
    from: 'REFERRAL_PENDING',
    to: 'REFERRAL_ACCEPTED',
    allowedRoles: ['DOCTOR', 'COORDINATOR'],
    evidenceFields: ['referralId'],
  },
  {
    key: 'REASSIGN_REFERRAL',
    from: 'REFERRAL_PENDING',
    to: 'REFERRAL_PENDING',
    allowedRoles: ['COORDINATOR'],
    evidenceFields: ['toProviderId', 'referralReason', 'rejectionReason?'],
  },
  {
    key: 'CLOSE_REFERRAL_PATIENT_DECLINED',
    from: 'REFERRAL_PENDING',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=PATIENT_DECLINED',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'CLOSE_REFERRAL_UNREACHABLE',
    from: 'REFERRAL_PENDING',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=UNREACHABLE_AFTER_ATTEMPTS',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'CLOSE_REFERRAL_TRANSFERRED_OUT',
    from: 'REFERRAL_PENDING',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=TRANSFERRED_OUT',
      'documentedReason',
      'closureProposalId?',
      ...Object.keys(TransferFields),
    ],
  },
  {
    key: 'SCHEDULE_APPOINTMENT',
    from: 'REFERRAL_ACCEPTED',
    to: 'APPOINTMENT_SCHEDULED',
    allowedRoles: ['COORDINATOR'],
    evidenceFields: ['scheduledAt', 'location'],
  },
  {
    key: 'CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED',
    from: 'REFERRAL_ACCEPTED',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=PATIENT_DECLINED',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'CLOSE_ACCEPTED_REFERRAL_UNREACHABLE',
    from: 'REFERRAL_ACCEPTED',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=UNREACHABLE_AFTER_ATTEMPTS',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT',
    from: 'REFERRAL_ACCEPTED',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=TRANSFERRED_OUT',
      'documentedReason',
      'closureProposalId?',
      ...Object.keys(TransferFields),
    ],
  },
  {
    key: 'START_CARE',
    from: 'APPOINTMENT_SCHEDULED',
    to: 'CARE_STARTED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: ['carePlan', 'followUpAt'],
  },
  {
    key: 'RESCHEDULE_APPOINTMENT',
    from: 'APPOINTMENT_SCHEDULED',
    to: 'APPOINTMENT_SCHEDULED',
    allowedRoles: ['COORDINATOR'],
    evidenceFields: ['scheduledAt', 'location', 'delayReason'],
  },
  {
    key: 'CLOSE_SCHEDULED_PATIENT_DECLINED',
    from: 'APPOINTMENT_SCHEDULED',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=PATIENT_DECLINED',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'CLOSE_SCHEDULED_UNREACHABLE',
    from: 'APPOINTMENT_SCHEDULED',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=UNREACHABLE_AFTER_ATTEMPTS',
      'documentedReason',
      'closureProposalId?',
    ],
  },
  {
    key: 'CLOSE_SCHEDULED_TRANSFERRED_OUT',
    from: 'APPOINTMENT_SCHEDULED',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=TRANSFERRED_OUT',
      'documentedReason',
      'closureProposalId?',
      ...Object.keys(TransferFields),
    ],
  },
  {
    key: 'CLOSE_COMPLETED_CARE',
    from: 'CARE_STARTED',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=COMPLETED_CARE',
      'documentedReason',
      'closureProposalId?',
      'careCompletionSummary',
      'postTreatmentFindings?',
      'surveillancePlan?',
    ],
  },
  {
    key: 'CLOSE_CARE_TRANSFERRED_OUT',
    from: 'CARE_STARTED',
    to: 'CLOSED',
    allowedRoles: ['DOCTOR'],
    evidenceFields: [
      'closureReason=TRANSFERRED_OUT',
      'documentedReason',
      'closureProposalId?',
      ...Object.keys(TransferFields),
    ],
  },
] as const satisfies ReadonlyArray<TransitionMatrixEntry>;

export type TransitionMatrixRow = (typeof transitionMatrix)[number];
