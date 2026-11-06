import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CaseEventDtoPatientSchema,
  CaseEventDtoStaffSchema,
  CaseListQuerySchema,
  CreateCaseRequestSchema,
  CoordinatorEvidenceDtoSchema,
  GenerateExplanationsRequestSchema,
  ProviderStaffDtoSchema,
  ReviewDraftRequestSchema,
  TransitionEvidenceSchemas,
  TransitionKeySchema,
  TransitionRequestSchema,
  UpdateFollowUpRequestSchema,
  transitionMatrix,
} from '../src';

const id = 'd9428888-122b-4c55-bb2c-39bb1c9dc522';
const secondId = '72579eac-0eb8-4418-9c15-063af453e525';
const timestamp = '2026-11-03T10:00:00Z';

describe('transition API contract', () => {
  it('maps every lifecycle key to exactly one matrix row', () => {
    const keys = TransitionKeySchema.options;
    const requirements = readFileSync(
      resolve(process.cwd(), 'docs/02-Product-Requirements.md'),
      'utf8',
    );
    const lifecycle = requirements
      .split('### 1.1 Lifecycle transition table')[1]
      .split('### 1.2')[0];
    const lifecycleRows = lifecycle
      .split('\n')
      .filter((line) => /^\| `/.test(line));
    expect(lifecycleRows).toHaveLength(keys.length);
    expect(transitionMatrix).toHaveLength(keys.length);
    expect(new Set(transitionMatrix.map((row) => row.key)).size).toBe(
      keys.length,
    );
    expect([...transitionMatrix.map((row) => row.key)].sort()).toEqual(
      [...keys].sort(),
    );
  });

  it('accepts a create-case request without a fictitious expected state', () => {
    expect(
      CreateCaseRequestSchema.safeParse({
        transitionKey: 'CREATE_CASE',
        evidence: {
          patientId: id,
          originProviderId: id,
          pathway: 'Screening',
          screeningType: 'Adult screening',
          resultCategory: 'Finding',
          preliminarySummary: 'Synthetic summary',
          recommendedAction: 'Review',
          intakeUrgency: 'ROUTINE',
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    {
      transitionKey: 'REVIEW_CASE',
      expectedState: 'NEW',
      evidence: { approvedExplanationIds: [id, secondId] },
    },
    {
      transitionKey: 'REQUEST_CONFIRMATION',
      expectedState: 'CLINICIAN_REVIEWED',
      evidence: {},
    },
    {
      transitionKey: 'CREATE_REFERRAL_FROM_REVIEW',
      expectedState: 'CLINICIAN_REVIEWED',
      evidence: { toProviderId: id, referralReason: 'Follow-up referral' },
    },
    {
      transitionKey: 'ACCEPT_REFERRAL',
      expectedState: 'REFERRAL_PENDING',
      evidence: { referralId: id },
    },
    {
      transitionKey: 'REASSIGN_REFERRAL',
      expectedState: 'REFERRAL_PENDING',
      evidence: {
        toProviderId: id,
        referralReason: 'Alternative receiving provider',
      },
    },
    {
      transitionKey: 'SCHEDULE_APPOINTMENT',
      expectedState: 'REFERRAL_ACCEPTED',
      evidence: { scheduledAt: timestamp, location: 'Clinic' },
    },
    {
      transitionKey: 'START_CARE',
      expectedState: 'APPOINTMENT_SCHEDULED',
      evidence: { carePlan: 'Care plan recorded', followUpAt: timestamp },
    },
    {
      transitionKey: 'RESCHEDULE_APPOINTMENT',
      expectedState: 'APPOINTMENT_SCHEDULED',
      evidence: { scheduledAt: timestamp, location: 'Clinic' },
      delayReason: 'NO_SLOT_AVAILABLE',
    },
    {
      transitionKey: 'CLOSE_CONFIRMATION_UNREACHABLE',
      expectedState: 'CONFIRMATION_PENDING',
      evidence: {
        closureReason: 'UNREACHABLE_AFTER_ATTEMPTS',
        documentedReason: 'No response after required outreach.',
      },
    },
  ])('accepts valid $transitionKey request', (payload) => {
    expect(TransitionRequestSchema.safeParse(payload).success).toBe(true);
  });

  it.each([
    {
      transitionKey: 'REVIEW_CASE',
      evidence: { approvedExplanationIds: [id, secondId] },
    },
    { transitionKey: 'REQUEST_CONFIRMATION', evidence: {} },
    {
      transitionKey: 'CREATE_REFERRAL_FROM_REVIEW',
      evidence: { toProviderId: id, referralReason: 'Referral' },
    },
    { transitionKey: 'ACCEPT_REFERRAL', evidence: { referralId: id } },
    {
      transitionKey: 'REASSIGN_REFERRAL',
      evidence: { toProviderId: id, referralReason: 'Reassign' },
    },
    {
      transitionKey: 'SCHEDULE_APPOINTMENT',
      evidence: { scheduledAt: timestamp, location: 'Clinic' },
    },
    {
      transitionKey: 'START_CARE',
      evidence: { carePlan: 'Care plan', followUpAt: timestamp },
    },
    {
      transitionKey: 'RESCHEDULE_APPOINTMENT',
      evidence: { scheduledAt: timestamp, location: 'Clinic' },
    },
  ])('rejects $transitionKey when expectedState is absent', (payload) => {
    expect(TransitionRequestSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    {
      key: 'REVIEW_CASE',
      evidence: { approvedExplanationIds: [id, secondId] },
      extra: { resultSummaryApproved: 'Client-controlled field' },
    },
    {
      key: 'REVIEW_CASE',
      evidence: { approvedExplanationIds: [id, secondId] },
      extra: { route: 'REFERRAL' },
    },
    {
      key: 'ACCEPT_REFERRAL',
      evidence: { referralId: id },
      extra: { acceptedByUserId: id },
    },
    {
      key: 'ACCEPT_REFERRAL',
      evidence: { referralId: id },
      extra: { receivingProviderId: id },
    },
    {
      key: 'REASSIGN_REFERRAL',
      evidence: { toProviderId: id, referralReason: 'Reassign' },
      extra: { previousReferralId: id },
    },
    {
      key: 'REASSIGN_REFERRAL',
      evidence: { toProviderId: id, referralReason: 'Reassign' },
      extra: { newReferralId: id },
    },
    {
      key: 'REASSIGN_REFERRAL',
      evidence: { toProviderId: id, referralReason: 'Reassign' },
      extra: { reassignmentCount: 1 },
    },
    {
      key: 'CLOSE_CONFIRMATION_UNREACHABLE',
      evidence: {
        closureReason: 'UNREACHABLE_AFTER_ATTEMPTS',
        documentedReason: 'No contact',
      },
      extra: { contactAttemptIds: [id, secondId, id] },
    },
    {
      key: 'CLOSE_CONFIRMATION_UNREACHABLE',
      evidence: {
        closureReason: 'UNREACHABLE_AFTER_ATTEMPTS',
        documentedReason: 'No contact',
      },
      extra: { escalationEventId: id },
    },
    {
      key: 'CLOSE_CONFIRMATION_UNREACHABLE',
      evidence: {
        closureReason: 'UNREACHABLE_AFTER_ATTEMPTS',
        documentedReason: 'No contact',
      },
      extra: { finalStatusDocumentation: 'unreachable' },
    },
    {
      key: 'CLOSE_CONFIRMATION_UNREACHABLE',
      evidence: {
        closureReason: 'UNREACHABLE_AFTER_ATTEMPTS',
        documentedReason: 'No contact',
      },
      extra: {
        clinicianSignOff: {
          evidenceId: id,
          clinicianId: id,
          signedAt: timestamp,
        },
      },
    },
    {
      key: 'START_CARE',
      evidence: { carePlan: 'Care plan', followUpAt: timestamp },
      extra: { attendedAppointmentId: id },
    },
    {
      key: 'RESCHEDULE_APPOINTMENT',
      evidence: { scheduledAt: timestamp, location: 'Clinic' },
      extra: { previousAppointmentId: id },
    },
    {
      key: 'CLOSE_AFTER_REVIEW_PATIENT_DECLINED',
      evidence: {
        closureReason: 'PATIENT_DECLINED',
        documentedReason: 'Declined',
      },
      extra: { patientDeclineEventId: id },
    },
    {
      key: 'CLOSE_SCHEDULED_UNREACHABLE',
      evidence: {
        closureReason: 'UNREACHABLE_AFTER_ATTEMPTS',
        documentedReason: 'No contact',
      },
      extra: { missedAppointmentId: id },
    },
    {
      key: 'CREATE_REFERRAL_AFTER_CONFIRMATION',
      evidence: { toProviderId: id, referralReason: 'Referral' },
      extra: { confirmatoryResultId: id },
    },
    {
      key: 'CREATE_REFERRAL_AFTER_CONFIRMATION',
      evidence: { toProviderId: id, referralReason: 'Referral' },
      extra: { referralId: id },
    },
    {
      key: 'CREATE_REFERRAL_AFTER_CONFIRMATION',
      evidence: { toProviderId: id, referralReason: 'Referral' },
      extra: { fromProviderId: id },
    },
    {
      key: 'CREATE_REFERRAL_AFTER_CONFIRMATION',
      evidence: { toProviderId: id, referralReason: 'Referral' },
      extra: { consentId: id },
    },
    {
      key: 'SCHEDULE_APPOINTMENT',
      evidence: { scheduledAt: timestamp, location: 'Clinic' },
      extra: { referralId: id },
    },
    {
      key: 'SCHEDULE_APPOINTMENT',
      evidence: { scheduledAt: timestamp, location: 'Clinic' },
      extra: { appointmentId: id },
    },
    {
      key: 'SCHEDULE_APPOINTMENT',
      evidence: { scheduledAt: timestamp, location: 'Clinic' },
      extra: { receivingProviderId: id },
    },
    {
      key: 'REQUEST_CONFIRMATION',
      evidence: {},
      extra: { confirmationTaskId: id },
    },
  ] as const)(
    'rejects client-derived field in $key',
    ({ key, evidence, extra }) => {
      expect(
        TransitionEvidenceSchemas[key].safeParse({ ...evidence, ...extra })
          .success,
      ).toBe(false);
    },
  );

  it('validates review, explanation, follow-up and list request shapes', () => {
    expect(
      ReviewDraftRequestSchema.safeParse({
        resultCategoryCode: 'FOLLOW_UP_NEEDED',
        nextStepCode: 'CONFIRMATORY_TEST',
        urgencyLabel: 'ROUTINE',
        route: 'CONFIRMATION',
      }).success,
    ).toBe(true);
    expect(GenerateExplanationsRequestSchema.safeParse({}).success).toBe(true);
    expect(
      UpdateFollowUpRequestSchema.safeParse({ status: 'COMPLETED' }).success,
    ).toBe(true);
    expect(
      CaseListQuerySchema.safeParse({
        limit: 25,
        updatedSince: timestamp,
      }).success,
    ).toBe(true);
  });

  it('rejects staff-only fields from patient event DTOs', () => {
    const patientEvent = {
      id,
      label: 'Referral accepted',
      timestamp,
      patientStatus: 'Your referral was accepted.',
    };
    expect(CaseEventDtoPatientSchema.safeParse(patientEvent).success).toBe(
      true,
    );
    expect(
      CaseEventDtoPatientSchema.safeParse({
        ...patientEvent,
        payload: { internal: 'detail' },
        actorId: id,
      }).success,
    ).toBe(false);
    expect(
      CaseEventDtoStaffSchema.safeParse({
        id,
        type: 'CASE_REVIEWED',
        fromState: 'NEW',
        toState: 'CLINICIAN_REVIEWED',
        actorType: 'USER',
        actorId: id,
        actorName: 'Clinician',
        createdAt: timestamp,
        payload: {},
      }).success,
    ).toBe(true);
  });

  it('limits coordinator evidence to the approved non-clinical kinds', () => {
    const base = {
      id,
      recordedBy: id,
      details: {},
      createdAt: timestamp,
    };
    expect(
      CoordinatorEvidenceDtoSchema.safeParse({
        ...base,
        kind: 'CONTACT_ATTEMPTS',
      }).success,
    ).toBe(true);
    expect(
      CoordinatorEvidenceDtoSchema.safeParse({
        ...base,
        kind: 'APPROVED_CLINICAL_PLAN',
      }).success,
    ).toBe(false);
  });

  it('keeps provider staff projections to id, name and role', () => {
    const staff = { id, name: 'Coordinator', role: 'COORDINATOR' };
    expect(ProviderStaffDtoSchema.safeParse(staff).success).toBe(true);
    expect(
      ProviderStaffDtoSchema.safeParse({
        ...staff,
        email: 'staff@example.test',
      }).success,
    ).toBe(false);
  });
});
