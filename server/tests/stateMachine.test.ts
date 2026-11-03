import { describe, expect, it } from 'vitest';
import {
  CaseStateSchema,
  TransitionEvidenceSchemas,
  TransitionKeySchema,
  type CaseState,
  type ClosureReason,
  type Role,
  type TransitionKey,
} from '@careloop/shared';
import {
  evaluateTransition,
  transitionTable,
  type EvaluateTransitionInput,
  type TransitionCaseSnapshot,
  type TransitionFacts,
} from '../src/core/stateMachine';

const ORIGIN = '11111111-1111-4111-8111-111111111111';
const RECEIVING = '22222222-2222-4222-8222-222222222222';
const NEXT_PROVIDER = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const FIXED_NOW = new Date('2026-11-03T12:00:00.000Z');

const allFacts: TransitionFacts = {
  caseAssignedToDoctor: true,
  approvedExplanationExists: true,
  resultReviewedDispatched: true,
  confirmatoryResultExists: true,
  currentReferralExists: true,
  currentReferralAccepted: true,
  currentReferralReassignable: true,
  currentAppointmentExists: true,
  appointmentMissedOrRescheduleRequested: true,
  attendedAppointmentExists: true,
  patientDeclineRecorded: true,
  closureProposalExists: true,
  escalationEventExists: true,
  failedContactAttemptsForMilestone: 3,
  receivingProviderConsentActive: true,
  caseOverdue: false,
  currentReferral: { fromProviderId: ORIGIN, toProviderId: RECEIVING },
};

function validEvidence(key: TransitionKey): Record<string, unknown> {
  switch (key) {
    case 'CREATE_CASE':
      return {
        patientId: USER_ID,
        originProviderId: ORIGIN,
        pathway: 'Synthetic pathway',
        screeningType: 'Synthetic screening',
        resultCategory: 'Actionable finding',
        preliminarySummary: 'Synthetic summary',
        recommendedAction: 'Synthetic next step',
        intakeUrgency: 'ROUTINE',
        assignedDoctorId: USER_ID,
      };
    case 'REVIEW_CASE':
      return {
        approvedExplanationIds: [
          '55555555-5555-4555-8555-555555555555',
          '66666666-6666-4666-8666-666666666666',
        ],
      };
    case 'REQUEST_CONFIRMATION':
    case 'CLOSE_AFTER_REVIEW_PATIENT_DECLINED':
      return key === 'REQUEST_CONFIRMATION'
        ? {}
        : { closureReason: 'PATIENT_DECLINED', documentedReason: 'Patient declined.' };
    case 'CREATE_REFERRAL_FROM_REVIEW':
    case 'CREATE_REFERRAL_AFTER_CONFIRMATION':
      return { toProviderId: RECEIVING, referralReason: 'Referral reason.' };
    case 'CLOSE_NOT_CONFIRMED':
      return { closureReason: 'NOT_CONFIRMED', documentedReason: 'Result not confirmed.' };
    case 'CLOSE_CONFIRMATION_PATIENT_DECLINED':
    case 'CLOSE_REFERRAL_PATIENT_DECLINED':
    case 'CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED':
    case 'CLOSE_SCHEDULED_PATIENT_DECLINED':
      return { closureReason: 'PATIENT_DECLINED', documentedReason: 'Patient declined.' };
    case 'CLOSE_CONFIRMATION_UNREACHABLE':
    case 'CLOSE_REFERRAL_UNREACHABLE':
    case 'CLOSE_ACCEPTED_REFERRAL_UNREACHABLE':
    case 'CLOSE_SCHEDULED_UNREACHABLE':
      return {
        closureReason: 'UNREACHABLE_AFTER_ATTEMPTS',
        documentedReason: 'Could not reach patient.',
      };
    case 'ACCEPT_REFERRAL':
      return { referralId: USER_ID };
    case 'REASSIGN_REFERRAL':
      return { toProviderId: NEXT_PROVIDER, referralReason: 'Alternate provider.' };
    case 'CLOSE_REFERRAL_TRANSFERRED_OUT':
    case 'CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT':
    case 'CLOSE_SCHEDULED_TRANSFERRED_OUT':
    case 'CLOSE_CARE_TRANSFERRED_OUT':
      return transferEvidence();
    case 'SCHEDULE_APPOINTMENT':
    case 'RESCHEDULE_APPOINTMENT':
      return { scheduledAt: '2026-11-10T10:00:00.000Z', location: 'Synthetic clinic' };
    case 'START_CARE':
      return { carePlan: 'Synthetic care plan.', followUpAt: '2026-12-03T12:00:00.000Z' };
    case 'CLOSE_COMPLETED_CARE':
      return {
        closureReason: 'COMPLETED_CARE',
        documentedReason: 'Care completed.',
        careCompletionSummary: 'Synthetic completion summary.',
      };
  }
}

function transferEvidence(): Record<string, unknown> {
  return {
    closureReason: 'TRANSFERRED_OUT',
    documentedReason: 'Transferred to another provider.',
    externalProviderName: 'Synthetic external provider',
    facilityContact: 'Synthetic contact',
    handoverSummary: 'Synthetic handover.',
  };
}

function providerFor(role: Role, key: TransitionKey): string | null {
  const relationship = transitionTable[key].providerRules[role];
  switch (relationship) {
    case 'ANY':
      return null;
    case 'RECEIVING_PROVIDER':
      return key === 'REASSIGN_REFERRAL' ? ORIGIN : RECEIVING;
    case 'ORIGIN_OR_RECEIVING':
      return ORIGIN;
    case 'SENDING_PROVIDER':
    case 'OWN_PROVIDER':
      return ORIGIN;
    default:
      return null;
  }
}

function baseInput(key: TransitionKey): EvaluateTransitionInput {
  const definition = transitionTable[key];
  const role = definition.allowedRoles[0];
  const evidence = validEvidence(key);
  const caseSnapshot: TransitionCaseSnapshot = {
    state: definition.from === 'none' ? null : definition.from,
    originProviderId: ORIGIN,
    sendingProviderId: ORIGIN,
    receivingProviderId: RECEIVING,
    intakeUrgency: 'ROUTINE',
    urgencyLabel: 'ROUTINE',
  };
  return {
    transitionKey: key,
    expectedState: caseSnapshot.state,
    actor: { role, providerId: providerFor(role, key), userId: USER_ID },
    case: caseSnapshot,
    facts: { ...allFacts },
    evidence,
    delayReason:
      key === 'RESCHEDULE_APPOINTMENT' ? 'APPOINTMENT_RESCHEDULED' : undefined,
    now: FIXED_NOW,
  };
}

describe('state machine table and evaluator', () => {
  it('covers exactly the shared TransitionKey vocabulary', () => {
    expect(Object.keys(transitionTable).sort()).toEqual(
      [...TransitionKeySchema.options].sort(),
    );
    expect(Object.keys(transitionTable)).toHaveLength(25);
  });

  it.each(TransitionKeySchema.options)('%s has a valid happy path', (key) => {
    const result = evaluateTransition(baseInput(key));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState).toBe(transitionTable[key].to);
      expect(result.eventType).toBe(transitionTable[key].eventType);
      expect(result.notificationTemplate).toBe(
        transitionTable[key].notificationTemplate,
      );
      expect(result.dueAt === null || result.dueAt instanceof Date).toBe(true);
      expect(result.derivedEvidence.length).toBe(
        key.startsWith('CLOSE_') ? 1 : 0,
      );
    }
  });

  it.each(TransitionKeySchema.options)(
    '%s rejects a wrong from-state, role, and provider',
    (key) => {
      const input = baseInput(key);
      const otherState = CaseStateSchema.options.find(
        (state) => state !== input.case.state,
      )!;
      const wrongStateInput = {
        ...input,
        expectedState: otherState,
        case: { ...input.case, state: otherState },
      };
      expect(evaluateTransition(wrongStateInput)).toMatchObject({
        ok: false,
        code: 'INVALID_TRANSITION',
      });
      expect(
        evaluateTransition({
          ...input,
          actor: { ...input.actor, role: 'PATIENT' },
        }),
      ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      expect(
        evaluateTransition({
          ...input,
          actor: { ...input.actor, providerId: NEXT_PROVIDER },
        }),
      ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    },
  );

  it('matches every closureReason × CaseState pair to the product closure matrix', () => {
    const allowed: Record<ClosureReason, CaseState[]> = {
      COMPLETED_CARE: ['CARE_STARTED'],
      NOT_CONFIRMED: ['CONFIRMATION_PENDING'],
      PATIENT_DECLINED: [
        'CLINICIAN_REVIEWED',
        'CONFIRMATION_PENDING',
        'REFERRAL_PENDING',
        'REFERRAL_ACCEPTED',
        'APPOINTMENT_SCHEDULED',
      ],
      UNREACHABLE_AFTER_ATTEMPTS: [
        'CONFIRMATION_PENDING',
        'REFERRAL_PENDING',
        'REFERRAL_ACCEPTED',
        'APPOINTMENT_SCHEDULED',
      ],
      TRANSFERRED_OUT: [
        'REFERRAL_PENDING',
        'REFERRAL_ACCEPTED',
        'APPOINTMENT_SCHEDULED',
        'CARE_STARTED',
      ],
    };
    const keys: Record<ClosureReason, Partial<Record<CaseState, TransitionKey>>> = {
      COMPLETED_CARE: { CARE_STARTED: 'CLOSE_COMPLETED_CARE' },
      NOT_CONFIRMED: { CONFIRMATION_PENDING: 'CLOSE_NOT_CONFIRMED' },
      PATIENT_DECLINED: {
        CLINICIAN_REVIEWED: 'CLOSE_AFTER_REVIEW_PATIENT_DECLINED',
        CONFIRMATION_PENDING: 'CLOSE_CONFIRMATION_PATIENT_DECLINED',
        REFERRAL_PENDING: 'CLOSE_REFERRAL_PATIENT_DECLINED',
        REFERRAL_ACCEPTED: 'CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED',
        APPOINTMENT_SCHEDULED: 'CLOSE_SCHEDULED_PATIENT_DECLINED',
      },
      UNREACHABLE_AFTER_ATTEMPTS: {
        CONFIRMATION_PENDING: 'CLOSE_CONFIRMATION_UNREACHABLE',
        REFERRAL_PENDING: 'CLOSE_REFERRAL_UNREACHABLE',
        REFERRAL_ACCEPTED: 'CLOSE_ACCEPTED_REFERRAL_UNREACHABLE',
        APPOINTMENT_SCHEDULED: 'CLOSE_SCHEDULED_UNREACHABLE',
      },
      TRANSFERRED_OUT: {
        REFERRAL_PENDING: 'CLOSE_REFERRAL_TRANSFERRED_OUT',
        REFERRAL_ACCEPTED: 'CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT',
        APPOINTMENT_SCHEDULED: 'CLOSE_SCHEDULED_TRANSFERRED_OUT',
        CARE_STARTED: 'CLOSE_CARE_TRANSFERRED_OUT',
      },
    };

    for (const reason of Object.keys(allowed) as ClosureReason[]) {
      for (const state of CaseStateSchema.options) {
        const key = keys[reason][state];
        const expectedAllowed = allowed[reason].includes(state);
        expect(Boolean(key)).toBe(expectedAllowed);
        if (!key) continue;
        const input = baseInput(key);
        input.case = { ...input.case, state };
        input.expectedState = state;
        input.evidence = validEvidence(key);
        const result = evaluateTransition(input);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.newState).toBe('CLOSED');
      }
    }
  });

  it('returns EVIDENCE_MISSING when any declared boolean or count fact is absent', () => {
    for (const key of TransitionKeySchema.options) {
      for (const fact of transitionTable[key].requiredFacts) {
        const input = baseInput(key);
        if (fact === 'failedContactAttemptsForMilestone') {
          input.facts.failedContactAttemptsForMilestone = 2;
        } else {
          (input.facts as Record<string, unknown>)[fact] = false;
        }
        expect(evaluateTransition(input), `${key}: ${fact}`).toMatchObject({
          ok: false,
          code: 'EVIDENCE_MISSING',
        });
      }
    }
  });

  it('checks expectedState first and rejects terminal CLOSED cases', () => {
    const stale = baseInput('REVIEW_CASE');
    stale.expectedState = 'REFERRAL_PENDING';
    expect(evaluateTransition(stale)).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });

    const terminal = baseInput('REVIEW_CASE');
    terminal.case = { ...terminal.case, state: 'CLOSED' };
    terminal.expectedState = 'CLOSED';
    expect(evaluateTransition(terminal)).toMatchObject({
      ok: false,
      code: 'INVALID_TRANSITION',
    });
  });

  it('requires delay reasons for overdue reassignments and every reschedule', () => {
    const reassignment = baseInput('REASSIGN_REFERRAL');
    reassignment.facts.caseOverdue = true;
    expect(evaluateTransition(reassignment)).toMatchObject({
      ok: false,
      code: 'DELAY_REASON_REQUIRED',
    });
    reassignment.delayReason = 'PROVIDER_DELAY';
    expect(evaluateTransition(reassignment).ok).toBe(true);

    const reschedule = baseInput('RESCHEDULE_APPOINTMENT');
    reschedule.delayReason = undefined;
    expect(evaluateTransition(reschedule)).toMatchObject({
      ok: false,
      code: 'DELAY_REASON_REQUIRED',
    });
  });

  it('requires result_reviewed dispatch only on both CLINICIAN_REVIEWED exits', () => {
    for (const key of ['REQUEST_CONFIRMATION', 'CREATE_REFERRAL_FROM_REVIEW'] as const) {
      const input = baseInput(key);
      input.facts.resultReviewedDispatched = false;
      expect(evaluateTransition(input)).toMatchObject({
        ok: false,
        code: 'EVIDENCE_MISSING',
      });
    }
    const closure = baseInput('CLOSE_AFTER_REVIEW_PATIENT_DECLINED');
    closure.facts.resultReviewedDispatched = false;
    expect(evaluateTransition(closure).ok).toBe(true);
  });

  it('requires active consent only for cross-provider referrals', () => {
    const input = baseInput('CREATE_REFERRAL_AFTER_CONFIRMATION');
    input.facts.receivingProviderConsentActive = false;
    expect(evaluateTransition(input)).toMatchObject({
      ok: false,
      code: 'CONSENT_REQUIRED',
    });
    input.evidence = { ...validEvidence(input.transitionKey), toProviderId: ORIGIN };
    expect(evaluateTransition(input).ok).toBe(true);
  });

  it('requires the receiving provider (never the sender) to accept a referral', () => {
    const input = baseInput('ACCEPT_REFERRAL');
    input.actor.providerId = ORIGIN;
    expect(evaluateTransition(input)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
  });

  it('keeps the assigned doctor as owner after entering CONFIRMATION_PENDING, otherwise uses the origin doctor queue', () => {
    const input = baseInput('REQUEST_CONFIRMATION');
    const assigned = evaluateTransition(input);
    expect(assigned).toMatchObject({ ok: true, owner: { kind: 'QUEUE', role: 'DOCTOR', providerId: ORIGIN } });

    input.case.ownerUserId = USER_ID;
    expect(evaluateTransition(input)).toMatchObject({
      ok: true,
      owner: { kind: 'USER', userId: USER_ID },
    });
  });

  it('returns clinician sign-off evidence naming the authenticated closing doctor', () => {
    const input = baseInput('CLOSE_REFERRAL_PATIENT_DECLINED');
    const result = evaluateTransition(input);
    expect(result).toMatchObject({
      ok: true,
      derivedEvidence: [
        {
          kind: 'CLINICIAN_SIGN_OFF',
          recordedBy: USER_ID,
          clinicianSignOff: {
            clinicianId: USER_ID,
            signedAt: FIXED_NOW.toISOString(),
          },
        },
      ],
    });
  });

  it('defaults START_CARE follow-up to 30 days and validates an explicit date within 180 days', () => {
    const input = baseInput('START_CARE');
    const expectedDefault = new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    input.evidence = { carePlan: 'Synthetic care plan.' };
    expect(evaluateTransition(input)).toMatchObject({ ok: true, dueAt: expectedDefault });

    const withinLimit = new Date(FIXED_NOW.getTime() + 180 * 24 * 60 * 60 * 1000);
    input.evidence = {
      carePlan: 'Synthetic care plan.',
      followUpAt: withinLimit.toISOString(),
    };
    expect(evaluateTransition(input)).toMatchObject({ ok: true, dueAt: withinLimit });

    input.evidence = {
      carePlan: 'Synthetic care plan.',
      followUpAt: FIXED_NOW.toISOString(),
    };
    expect(evaluateTransition(input)).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });

    input.evidence = {
      carePlan: 'Synthetic care plan.',
      followUpAt: new Date(FIXED_NOW.getTime() + 181 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(evaluateTransition(input)).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('allows closure by originating or consented receiving doctors after referral, but scopes earlier closures to origin', () => {
    const postReferral = [
      'CLOSE_REFERRAL_PATIENT_DECLINED',
      'CLOSE_REFERRAL_UNREACHABLE',
      'CLOSE_REFERRAL_TRANSFERRED_OUT',
      'CLOSE_ACCEPTED_REFERRAL_PATIENT_DECLINED',
      'CLOSE_ACCEPTED_REFERRAL_UNREACHABLE',
      'CLOSE_ACCEPTED_REFERRAL_TRANSFERRED_OUT',
      'CLOSE_SCHEDULED_PATIENT_DECLINED',
      'CLOSE_SCHEDULED_UNREACHABLE',
      'CLOSE_SCHEDULED_TRANSFERRED_OUT',
    ] as const;
    for (const key of postReferral) {
      const input = baseInput(key);
      input.actor.providerId = RECEIVING;
      expect(evaluateTransition(input), key).toMatchObject({ ok: true });
      input.facts.receivingProviderConsentActive = false;
      expect(evaluateTransition(input), key).toMatchObject({ ok: false, code: 'CONSENT_REQUIRED' });
      input.actor.providerId = NEXT_PROVIDER;
      expect(evaluateTransition(input), key).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    }

    for (const key of ['CLOSE_AFTER_REVIEW_PATIENT_DECLINED', 'CLOSE_NOT_CONFIRMED', 'CLOSE_CONFIRMATION_PATIENT_DECLINED', 'CLOSE_CONFIRMATION_UNREACHABLE'] as const) {
      const input = baseInput(key);
      input.actor.providerId = RECEIVING;
      expect(evaluateTransition(input), key).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    }

    const careTransfer = baseInput('CLOSE_CARE_TRANSFERRED_OUT');
    careTransfer.actor.providerId = ORIGIN;
    expect(evaluateTransition(careTransfer)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    careTransfer.actor.providerId = RECEIVING;
    expect(evaluateTransition(careTransfer)).toMatchObject({ ok: true });
  });

  it('verifies an optional closure proposal when the caller references one', () => {
    const input = baseInput('CLOSE_REFERRAL_PATIENT_DECLINED');
    input.evidence = {
      ...validEvidence(input.transitionKey),
      closureProposalId: USER_ID,
    };
    input.facts.closureProposalExists = false;
    expect(evaluateTransition(input)).toMatchObject({
      ok: false,
      code: 'EVIDENCE_MISSING',
    });
    input.facts.closureProposalExists = true;
    expect(evaluateTransition(input).ok).toBe(true);
  });

  it('rejects malformed evidence using each transition shared schema', () => {
    for (const key of TransitionKeySchema.options) {
      expect(
        TransitionEvidenceSchemas[key].safeParse({ unexpected: true }).success,
        key,
      ).toBe(false);
    }
  });
});
