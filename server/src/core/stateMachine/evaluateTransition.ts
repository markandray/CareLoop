import {
  type CaseState,
  type CaseEventType,
  type ClosureReason,
  type DelayReason,
  type EvidenceKind,
  type NotificationTemplateKey,
  type Role,
  type TransitionKey,
  type Urgency,
} from '@careloop/shared';
import { dueAtFor, workflowConfig } from '../../config/workflowConfig';
import {
  transitionTable,
  type OwnerRule,
  type ProviderRelationship,
  type TransitionFactKey,
} from './transitionTable';

export interface TransitionCaseSnapshot {
  state: CaseState | null;
  originProviderId?: string | null;
  sendingProviderId?: string | null;
  receivingProviderId?: string | null;
  ownerUserId?: string | null;
  intakeUrgency?: Urgency;
  urgencyLabel?: Urgency | null;
}

export interface TransitionActor {
  role: Role;
  providerId: string | null;
  /** Authenticated user ID, used to attribute user actions and clinician sign-off. */
  userId: string;
}

export interface TransitionFacts {
  caseAssignedToDoctor?: boolean;
  approvedExplanationExists?: boolean;
  resultReviewedDispatched?: boolean;
  confirmatoryResultExists?: boolean;
  currentReferralExists?: boolean;
  currentReferralAccepted?: boolean;
  currentReferralReassignable?: boolean;
  currentAppointmentExists?: boolean;
  appointmentMissedOrRescheduleRequested?: boolean;
  attendedAppointmentExists?: boolean;
  patientDeclineRecorded?: boolean;
  closureProposalExists?: boolean;
  escalationEventExists?: boolean;
  failedContactAttemptsForMilestone?: number;
  receivingProviderConsentActive?: boolean;
  caseOverdue?: boolean;
  currentReferral?: {
    fromProviderId: string;
    toProviderId: string;
  } | null;
}

export interface EvaluateTransitionInput {
  transitionKey: TransitionKey;
  expectedState: CaseState | null;
  actor: TransitionActor;
  case: TransitionCaseSnapshot;
  facts: TransitionFacts;
  evidence: unknown;
  delayReason?: DelayReason;
  now: Date;
}

export type TransitionOwner =
  | { kind: 'USER'; userId: string }
  | { kind: 'QUEUE'; role: Role; providerId: string }
  | { kind: 'UNASSIGNED' };

export interface DerivedEvidence {
  kind: EvidenceKind;
  recordedBy: string;
  clinicianSignOff: {
    clinicianId: string;
    signedAt: string;
  };
  details: {
    closureReason: ClosureReason;
    signedAt: string;
  };
}

export type TransitionFailureCode =
  | 'INVALID_TRANSITION'
  | 'FORBIDDEN'
  | 'EVIDENCE_MISSING'
  | 'CONSENT_REQUIRED'
  | 'DELAY_REASON_REQUIRED'
  | 'CONFLICT'
  | 'VALIDATION_ERROR';

export type TransitionEvaluation =
  | {
      ok: true;
      newState: CaseState;
      owner: TransitionOwner;
      dueAt: Date | null;
      notificationTemplate: NotificationTemplateKey | null;
      eventType: CaseEventType;
      derivedEvidence: DerivedEvidence[];
    }
  | {
      ok: false;
      code: TransitionFailureCode;
      details?: Record<string, unknown>;
    };

const boolFactNames: ReadonlySet<TransitionFactKey> = new Set([
  'caseAssignedToDoctor',
  'approvedExplanationExists',
  'resultReviewedDispatched',
  'confirmatoryResultExists',
  'currentReferralExists',
  'currentReferralAccepted',
  'currentReferralReassignable',
  'currentAppointmentExists',
  'appointmentMissedOrRescheduleRequested',
  'attendedAppointmentExists',
  'patientDeclineRecorded',
  'closureProposalExists',
  'escalationEventExists',
  'receivingProviderConsentActive',
  'caseOverdue',
]);

/** Purely evaluates state, permissions, database-resolved facts, evidence, and SLA output. */
export function evaluateTransition(
  input: EvaluateTransitionInput,
): TransitionEvaluation {
  // Stale-state checking deliberately precedes all other validation and authorization.
  if (input.expectedState !== input.case.state) {
    return {
      ok: false,
      code: 'CONFLICT',
      details: {
        expected: input.expectedState,
        observed: input.case.state,
      },
    };
  }

  const definition = transitionTable[input.transitionKey];
  if (!definition) {
    return { ok: false, code: 'INVALID_TRANSITION' };
  }
  if (input.case.state === 'CLOSED') {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      details: { reason: 'CLOSED is terminal.' },
    };
  }
  if (definition.from !== (input.case.state ?? 'none')) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      details: { expectedFrom: definition.from, observedState: input.case.state },
    };
  }

  if (definition.key.startsWith('CLOSE_') && input.actor.role === 'COORDINATOR') {
    return { ok: false, code: 'FORBIDDEN', details: { reason: 'Doctor sign-off is required.' } };
  }
  if (!definition.allowedRoles.includes(input.actor.role)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      details: { allowedRoles: definition.allowedRoles },
    };
  }
  const providerFailure = validateProviderRelationship(
    definition.providerRules[input.actor.role],
    input,
  );
  if (providerFailure) return providerFailure;

  const parsedEvidence = definition.evidenceSchema.safeParse(input.evidence);
  if (!parsedEvidence.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      details: parsedEvidence.error.flatten(),
    };
  }
  const evidence = parsedEvidence.data as Record<string, unknown>;

  for (const factName of definition.requiredFacts) {
    if (factName === 'failedContactAttemptsForMilestone') {
      const observed = input.facts.failedContactAttemptsForMilestone ?? 0;
      const required = workflowConfig.thresholds.failedContactAttempts;
      if (observed < required) {
        return { ok: false, code: 'EVIDENCE_MISSING', details: { required, observed, fact: factName } };
      }
      continue;
    }
    if (boolFactNames.has(factName) && input.facts[factName] !== true) {
      return {
        ok: false,
        code: 'EVIDENCE_MISSING',
        details: { required: factName, observed: input.facts[factName] ?? false },
      };
    }
  }

  if (evidence.closureProposalId && input.facts.closureProposalExists !== true) {
    return {
      ok: false,
      code: 'EVIDENCE_MISSING',
      details: { required: 'closureProposalExists', observed: false },
    };
  }

  const receivingProviderId = targetProviderId(input, evidence);
  if (
    receivingProviderId &&
    input.case.originProviderId &&
    receivingProviderId !== input.case.originProviderId &&
    input.facts.receivingProviderConsentActive !== true
  ) {
    return { ok: false, code: 'CONSENT_REQUIRED' };
  }

  if (input.transitionKey === 'RESCHEDULE_APPOINTMENT' && !input.delayReason) {
    return { ok: false, code: 'DELAY_REASON_REQUIRED' };
  }
  if (
    input.transitionKey === 'REASSIGN_REFERRAL' &&
    input.facts.caseOverdue === undefined
  ) {
    return {
      ok: false,
      code: 'EVIDENCE_MISSING',
      details: { required: 'caseOverdue', observed: 'unknown' },
    };
  }
  if (input.transitionKey === 'REASSIGN_REFERRAL' && input.facts.caseOverdue && !input.delayReason) {
    return { ok: false, code: 'DELAY_REASON_REQUIRED' };
  }

  const owner = resolveOwner(definition.ownerAfter, input, evidence);
  if (!owner.ok) return owner;
  const dueAtResult = resolveDueAt(definition.dueAtRule, input, evidence);
  if (!dueAtResult.ok) return dueAtResult;

  const derivedEvidence: DerivedEvidence[] = [];
  if (definition.key.startsWith('CLOSE_') && definition.closureReason) {
    derivedEvidence.push({
      kind: 'CLINICIAN_SIGN_OFF',
      recordedBy: input.actor.userId,
      clinicianSignOff: {
        clinicianId: input.actor.userId,
        signedAt: input.now.toISOString(),
      },
      details: {
        closureReason: definition.closureReason,
        signedAt: input.now.toISOString(),
      },
    });
  }

  return {
    ok: true,
    newState: definition.to,
    owner: owner.owner,
    dueAt: dueAtResult.dueAt,
    notificationTemplate: definition.notificationTemplate,
    eventType: definition.eventType,
    derivedEvidence,
  };
}

function validateProviderRelationship(
  relationship: ProviderRelationship | undefined,
  input: EvaluateTransitionInput,
): TransitionEvaluation | null {
  if (!relationship || relationship === 'ANY') return null;
  const expectedProviderId =
    relationship === 'OWN_PROVIDER'
      ? input.case.originProviderId ??
        (typeof (input.evidence as { originProviderId?: unknown } | null)?.originProviderId === 'string'
          ? (input.evidence as { originProviderId: string }).originProviderId
          : undefined)
      : relationship === 'ORIGIN_OR_RECEIVING'
        ? input.actor.providerId === input.case.originProviderId
          ? input.case.originProviderId
          : input.facts.currentReferral?.toProviderId ?? input.case.receivingProviderId ?? undefined
      : relationship === 'SENDING_PROVIDER'
        ? input.facts.currentReferral?.fromProviderId ?? input.case.sendingProviderId ?? input.case.originProviderId
        : targetProviderId(input, (input.evidence ?? {}) as Record<string, unknown>) ??
          input.facts.currentReferral?.toProviderId ??
          input.case.receivingProviderId;

  if (!expectedProviderId || input.actor.providerId !== expectedProviderId) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      details: { requiredProviderRelationship: relationship, expectedProviderId: expectedProviderId ?? null },
    };
  }
  if (
    relationship === 'ORIGIN_OR_RECEIVING' &&
    expectedProviderId !== input.case.originProviderId &&
    input.facts.receivingProviderConsentActive !== true
  ) {
    return { ok: false, code: 'CONSENT_REQUIRED' };
  }
  return null;
}

function targetProviderId(
  input: EvaluateTransitionInput,
  evidence: Record<string, unknown>,
): string | undefined {
  if (typeof evidence.toProviderId === 'string') return evidence.toProviderId;
  return (
    input.facts.currentReferral?.toProviderId ??
    input.case.receivingProviderId ??
    undefined
  );
}

function resolveOwner(
  rule: OwnerRule,
  input: EvaluateTransitionInput,
  evidence: Record<string, unknown>,
): { ok: true; owner: TransitionOwner } | { ok: false; code: 'EVIDENCE_MISSING'; details: Record<string, unknown> } {
  if (rule.kind === 'NONE') return { ok: true, owner: { kind: 'UNASSIGNED' } };
  if (rule.kind === 'USER_FROM_EVIDENCE') {
    const userId = evidence[rule.evidenceField];
    return typeof userId === 'string'
      ? { ok: true, owner: { kind: 'USER', userId } }
      : { ok: true, owner: { kind: 'UNASSIGNED' } };
  }
  if (rule.kind === 'ASSIGNED_USER_OR_QUEUE' && input.case.ownerUserId) {
    return { ok: true, owner: { kind: 'USER', userId: input.case.ownerUserId } };
  }
  const providerId =
    rule.provider === 'ORIGIN'
      ? input.case.originProviderId
      : rule.provider === 'SENDING'
        ? input.facts.currentReferral?.fromProviderId ?? input.case.sendingProviderId ?? input.case.originProviderId
        : rule.provider === 'RECEIVING'
          ? targetProviderId(input, evidence)
          : typeof evidence.toProviderId === 'string'
            ? evidence.toProviderId
            : undefined;
  return providerId
    ? { ok: true, owner: { kind: 'QUEUE', role: rule.role, providerId } }
    : { ok: false, code: 'EVIDENCE_MISSING', details: { required: `${rule.provider.toLowerCase()}ProviderId` } };
}

function resolveDueAt(
  rule: { slaKey: keyof typeof workflowConfig.slaMs; base: 'NOW' | 'SCHEDULED_AT' | 'FOLLOW_UP_AT' } | null,
  input: EvaluateTransitionInput,
  evidence: Record<string, unknown>,
):
  | { ok: true; dueAt: Date | null }
  | {
      ok: false;
      code: 'EVIDENCE_MISSING' | 'VALIDATION_ERROR';
      details: Record<string, unknown>;
    } {
  if (!rule) return { ok: true, dueAt: null };
  if (rule.base === 'FOLLOW_UP_AT') {
    const followUpAt = evidence.followUpAt;
    if (typeof followUpAt !== 'string') {
      return {
        ok: true,
        dueAt: dueAtFor('defaultFollowUpInterval', 'ROUTINE', input.now),
      };
    }
    const dueAt = new Date(followUpAt);
    const maxDueAt = new Date(input.now.getTime() + 180 * 24 * 60 * 60 * 1000);
    if (dueAt <= input.now || dueAt > maxDueAt) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        details: {
          field: 'followUpAt',
          reason: 'Must be after now and no more than 180 days ahead.',
        },
      };
    }
    return { ok: true, dueAt };
  }
  const base = rule.base === 'SCHEDULED_AT' ? evidence.scheduledAt : input.now;
  if (!(base instanceof Date) && typeof base !== 'string') {
    return { ok: false, code: 'EVIDENCE_MISSING', details: { required: 'scheduledAt' } };
  }
  const urgency =
    input.case.urgencyLabel ??
    input.case.intakeUrgency ??
    (evidence.intakeUrgency as Urgency | undefined);
  if (!urgency) {
    return { ok: false, code: 'EVIDENCE_MISSING', details: { required: 'urgency' } };
  }
  return {
    ok: true,
    dueAt: dueAtFor(rule.slaKey, urgency, base instanceof Date ? base : new Date(base)),
  };
}
