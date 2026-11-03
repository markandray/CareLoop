import {
  Prisma,
  type CaseEventType,
  type CaseState,
  type ClosureReason,
  type Language,
  type Role,
} from '@prisma/client';
import {
  CaseDetailAdminSchema,
  CaseDetailCoordinatorSchema,
  CaseDetailDoctorSchema,
  CaseDetailPatientSchema,
  CaseEventDtoPatientSchema,
  CaseEventDtoStaffSchema,
  CaseListItemSchema,
  type CaseDetailAdmin,
  type CaseDetailCoordinator,
  type CaseDetailDoctor,
  type CaseDetailPatient,
  type CaseEventDtoPatient,
  type CaseEventDtoStaff,
  type CaseListItem,
} from '@careloop/shared';
import type { CaseActor } from './caseVisibility';

export const caseDetailInclude = {
  patient: { include: { user: true } },
  originProvider: true,
  ownerUser: true,
  ownerQueueProvider: true,
  referrals: {
    include: {
      toProvider: true,
      appointments: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
  explanations: { orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] },
  events: {
    include: { actor: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ScreeningCaseInclude;

export type CaseProjectionRecord = Prisma.ScreeningCaseGetPayload<{
  include: typeof caseDetailInclude;
}>;

export const caseListInclude = { ownerUser: true } satisfies Prisma.ScreeningCaseInclude;
export type CaseListProjectionRecord = Prisma.ScreeningCaseGetPayload<{
  include: typeof caseListInclude;
}>;

export type CaseDetailProjection =
  | CaseDetailPatient
  | CaseDetailDoctor
  | CaseDetailCoordinator
  | CaseDetailAdmin;

const stateCopy: Record<CaseState, { label: string; description: string }> = {
  NEW: {
    label: 'Under clinical review',
    description: 'Your screening result has been received and is being reviewed by a clinician.',
  },
  CLINICIAN_REVIEWED: {
    label: 'Next step planned',
    description: 'Your doctor has reviewed your result and recommended a follow-up plan.',
  },
  CONFIRMATION_PENDING: {
    label: 'Waiting for confirmation',
    description: 'Additional confirmatory testing has been requested to clarify your findings.',
  },
  REFERRAL_PENDING: {
    label: 'Referral in progress',
    description: 'A referral to a specialist clinic is being arranged.',
  },
  REFERRAL_ACCEPTED: {
    label: 'Referral accepted',
    description: 'The specialist clinic has accepted your referral and will book your visit.',
  },
  APPOINTMENT_SCHEDULED: {
    label: 'Appointment scheduled',
    description: 'Your follow-up appointment has been booked. Details and location are listed below.',
  },
  CARE_STARTED: {
    label: 'Care started',
    description: 'You have attended your appointment and your clinical care plan is underway.',
  },
  CLOSED: {
    label: 'Care closed',
    description: 'Your case has been closed.',
  },
};

const closureCopy: Record<ClosureReason, { label: string; description: string }> = {
  COMPLETED_CARE: {
    label: 'Care completed',
    description: 'Your recommended care pathway has been completed.',
  },
  PATIENT_DECLINED: {
    label: 'Care declined',
    description: 'You have indicated that you do not wish to proceed with further follow-up at this time.',
  },
  NOT_CONFIRMED: {
    label: 'Follow-up not required',
    description: 'Confirmatory tests showed that further follow-up is not required.',
  },
  UNREACHABLE_AFTER_ATTEMPTS: {
    label: 'Coordination paused',
    description: 'Our team was unable to reach you after multiple attempts. Please contact your clinic.',
  },
  TRANSFERRED_OUT: {
    label: 'Transferred to external care',
    description: 'Your care has been transferred to an external medical provider outside CareLoop.',
  },
};

const patientEventLabels: Record<CaseEventType, string> = {
  CASE_CREATED: 'Screening case received',
  CASE_REVIEWED: 'Doctor reviewed your screening result',
  CONFIRMATION_REQUESTED: 'Confirmatory testing requested',
  REFERRAL_CREATED: 'Referral started',
  CASE_CLOSED: 'Care case closed',
  REFERRAL_ACCEPTED: 'Referral accepted',
  REFERRAL_REASSIGNED: 'Referral updated',
  APPOINTMENT_SCHEDULED: 'Appointment scheduled',
  CARE_STARTED: 'Care started',
  APPOINTMENT_RESCHEDULED: 'Appointment rescheduled',
  OWNER_ASSIGNED: 'Care team assigned',
  NOTIFICATION_QUEUED: 'A care update is being prepared',
  NOTIFICATION_SENT: 'Care update sent',
  NOTIFICATION_ACKNOWLEDGED: 'Care update viewed',
  UNDERSTANDING_CONFIRMED: 'You confirmed you understand the explanation',
  CARE_DECLINED_BY_PATIENT: 'Care choice recorded',
  EXPLANATION_GENERATED: 'Patient explanation prepared',
  EXPLANATION_APPROVED: 'Patient explanation approved',
  CONFIRMATORY_RESULT_RECORDED: 'Confirmatory result recorded',
  APPOINTMENT_ATTENDED: 'Appointment attendance recorded',
  APPOINTMENT_MISSED: 'Appointment update recorded',
  CONTACT_ATTEMPT_LOGGED: 'Care team recorded a contact attempt',
  REFERRAL_REJECTED: 'Referral response recorded',
  CONSULT_REQUESTED: 'Question sent to the care team',
  CONSULT_ANSWERED: 'Care team answered a question',
  ESCALATION_RAISED: 'Care team follow-up updated',
  ESCALATION_CLEARED: 'Care team follow-up updated',
  CONSENT_GRANTED: 'Information-sharing consent granted',
  CONSENT_REVOKED: 'Information-sharing consent withdrawn',
  DELAY_REASON_RECORDED: 'Care coordination update recorded',
  CLOSURE_PROPOSED: 'Case closure review requested',
};

export function projectCaseForActor(
  row: CaseProjectionRecord,
  actor: CaseActor,
): CaseDetailProjection {
  const base = caseIdentity(row);
  const referrals = row.referrals.map((referral) => referralSummary(referral));
  const appointments = row.referrals.flatMap((referral) =>
    referral.appointments.map((appointment) => appointmentSummary(appointment)),
  );
  const approvedExplanations = row.explanations.filter(
    (explanation) => explanation.status === 'APPROVED',
  );

  switch (actor.role) {
    case 'PATIENT': {
      const language = row.patient.preferredLanguage;
      const approvedExplanation =
        latestExplanationFor(approvedExplanations, language) ??
        latestExplanationFor(approvedExplanations, 'EN') ??
        (approvedExplanations[0]
          ? explanationDto(approvedExplanations[0])
          : null);
      const patientCopy = currentPatientCopy(row);
      return CaseDetailPatientSchema.parse({
        ...base,
        pathway: row.pathway,
        screeningType: row.screeningType,
        statusLabel: patientCopy.label,
        statusDescription: patientCopy.description,
        approvedExplanation,
        recommendedNextStep: row.recommendedNextStep,
        referrals,
        appointments,
        events: row.events.map((event) =>
          projectPatientCaseEvent(event, row.state, row.closureReason),
        ),
      });
    }
    case 'DOCTOR':
      return CaseDetailDoctorSchema.parse({
        ...base,
        pathway: row.pathway,
        screeningType: row.screeningType,
        resultCategory: row.resultCategory,
        resultSummaryApproved: row.resultSummaryApproved,
        recommendedNextStep: row.recommendedNextStep,
        patient: patientSummary(row),
        originProvider: providerSummary(row.originProvider),
        owner: caseOwner(row),
        referrals,
        appointments,
        explanations: row.explanations.map(explanationDto),
        events: row.events.map(projectStaffCaseEvent),
      });
    case 'COORDINATOR': {
      const patientCopy = currentPatientCopy(row);
      const approvedExplanation =
        latestExplanationFor(approvedExplanations, row.patient.preferredLanguage) ??
        latestExplanationFor(approvedExplanations, 'EN') ??
        (approvedExplanations[0]
          ? explanationDto(approvedExplanations[0])
          : null);
      return CaseDetailCoordinatorSchema.parse({
        ...base,
        pathway: row.pathway,
        screeningType: row.screeningType,
        approvedExplanation,
        recommendedNextStep: row.recommendedNextStep,
        patient: patientSummary(row),
        originProvider: providerSummary(row.originProvider),
        owner: caseOwner(row),
        referrals,
        appointments,
        events: row.events.map(projectStaffCaseEvent),
      });
    }
    case 'ADMIN': {
      return CaseDetailAdminSchema.parse({
        ...base,
        pathway: row.pathway,
        screeningType: row.screeningType,
        resultCategory: row.resultCategory,
        resultSummaryApproved: row.resultSummaryApproved,
        recommendedNextStep: row.recommendedNextStep,
        patient: patientSummary(row),
        originProvider: providerSummary(row.originProvider),
        owner: caseOwner(row),
        referrals,
        appointments,
        explanations: row.explanations.map(explanationDto),
        events: row.events.map(projectStaffCaseEvent),
      });
    }
  }
}

export function projectCaseListItem(row: CaseListProjectionRecord): CaseListItem {
  return CaseListItemSchema.parse({
    id: row.id,
    state: row.state,
    urgencyLabel: row.urgencyLabel,
    owner: row.ownerUserId && row.ownerUser
      ? { kind: 'USER', userId: row.ownerUserId, name: row.ownerUser.name }
      : row.ownerQueueRole && row.ownerQueueProviderId
        ? { kind: 'QUEUE', role: row.ownerQueueRole, providerId: row.ownerQueueProviderId }
        : { kind: 'UNASSIGNED' },
    dueAt: iso(row.dueAt),
    escalationLevel: row.escalationLevel,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function projectPatientCaseEvent(
  event: CaseProjectionRecord['events'][number],
  currentState: CaseState,
  closureReason: ClosureReason | null,
): CaseEventDtoPatient {
  const eventState = event.toState ?? currentState;
  const patientCopy =
    eventState === 'CLOSED' && closureReason
      ? closureCopy[closureReason]
      : stateCopy[eventState];
  return CaseEventDtoPatientSchema.parse({
    id: event.id,
    label: patientEventLabels[event.type],
    timestamp: event.createdAt.toISOString(),
    patientStatus: patientCopy.label,
  });
}

export function projectStaffCaseEvent(
  event: CaseProjectionRecord['events'][number],
): CaseEventDtoStaff {
  return CaseEventDtoStaffSchema.parse({
    id: event.id,
    type: event.type,
    fromState: event.fromState,
    toState: event.toState,
    actorType: event.actorType,
    actorId: event.actorId,
    actorName: event.actor?.name ?? null,
    createdAt: event.createdAt.toISOString(),
    payload: jsonObject(event.payload),
  });
}

function caseIdentity(row: CaseProjectionRecord) {
  return {
    id: row.id,
    state: row.state,
    intakeUrgency: row.intakeUrgency,
    urgencyLabel: row.urgencyLabel,
    dueAt: iso(row.dueAt),
    notifiedAt: iso(row.notifiedAt),
    acknowledgedAt: iso(row.acknowledgedAt),
    understandingConfirmedAt: iso(row.understandingConfirmedAt),
    escalationLevel: row.escalationLevel,
    escalatedAt: iso(row.escalatedAt),
    reassignmentCount: row.reassignmentCount,
    closureReason: row.closureReason,
    closedAt: iso(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function patientSummary(row: CaseProjectionRecord) {
  return {
    id: row.patient.id,
    name: row.patient.user.name,
    syntheticMrn: row.patient.syntheticMrn,
    dateOfBirth: row.patient.dateOfBirth.toISOString().slice(0, 10),
    preferredLanguage: row.patient.preferredLanguage,
    preferredChannel: row.patient.preferredChannel,
  };
}

function providerSummary(provider: CaseProjectionRecord['originProvider']) {
  return { id: provider.id, name: provider.name, type: provider.type };
}

function caseOwner(row: CaseProjectionRecord) {
  if (row.ownerUserId && row.ownerUser) {
    return { kind: 'USER' as const, userId: row.ownerUserId, name: row.ownerUser.name };
  }
  if (row.ownerQueueRole && row.ownerQueueProviderId) {
    return {
      kind: 'QUEUE' as const,
      role: row.ownerQueueRole,
      providerId: row.ownerQueueProviderId,
    };
  }
  return { kind: 'UNASSIGNED' as const };
}

function referralSummary(referral: CaseProjectionRecord['referrals'][number]) {
  return {
    id: referral.id,
    toProvider: providerSummary(referral.toProvider),
    status: referral.status,
    respondedAt: iso(referral.respondedAt),
    rejectionReason: referral.rejectionReason,
    createdAt: referral.createdAt.toISOString(),
    updatedAt: referral.updatedAt.toISOString(),
  };
}

function appointmentSummary(
  appointment: CaseProjectionRecord['referrals'][number]['appointments'][number],
) {
  return {
    id: appointment.id,
    scheduledAt: appointment.scheduledAt.toISOString(),
    status: appointment.status,
    delayReason: appointment.delayReason,
    updatedAt: appointment.updatedAt.toISOString(),
  };
}

function explanationDto(
  explanation: CaseProjectionRecord['explanations'][number],
) {
  return {
    id: explanation.id,
    language: explanation.language,
    text: explanation.text,
    source: explanation.source,
    status: explanation.status,
    approvedBy: explanation.approvedBy,
    approvedAt: iso(explanation.approvedAt),
    updatedAt: explanation.updatedAt.toISOString(),
  };
}

function latestExplanationFor(
  explanations: CaseProjectionRecord['explanations'],
  language: Language,
) {
  const match = explanations.find((explanation) => explanation.language === language);
  return match ? explanationDto(match) : null;
}

function currentPatientCopy(row: CaseProjectionRecord) {
  if (row.state === 'CLOSED' && row.closureReason) {
    return closureCopy[row.closureReason];
  }
  if (
    row.state === 'APPOINTMENT_SCHEDULED' &&
    row.events.some((event) => event.type === 'APPOINTMENT_RESCHEDULED')
  ) {
    return {
      label: 'Appointment rescheduled',
      description: 'Your appointment time has been updated.',
    };
  }
  return stateCopy[row.state];
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value));
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
