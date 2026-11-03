import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import {
  ActorType,
  CaseEventType,
  ExplanationSource,
  ExplanationStatus,
  PrismaClient,
  ProviderType,
  type Role,
} from '@prisma/client';
import {
  CaseTransitionResponseSchema,
  type CaseTransitionResponse,
} from '@careloop/shared';
import type { Clock } from '../src/core/clock';
import { appendEvent } from '../src/core/eventLog';
import { AUTH_COOKIE_NAME } from '../src/middleware/auth/authMiddleware';
import { createApp } from '../src/app';

const prisma = new PrismaClient();
const now = new Date('2026-11-04T12:00:00.000Z');
const clock: Clock = {
  now: () => new Date(now),
  advance: async () => new Date(now),
  reset: async () => new Date(now),
};
const secret = 't105b_transition_route_tests_secret_at_least_32_chars';
const clientOrigin = 'http://localhost:3000';
const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
const users: Record<string, { id: string; providerId: string | null }> = {};
let patientId: string;
let originId: string;
let receivingId: string;
let alternateId: string;
let server: http.Server;
let baseUrl: string;

before(async () => {
  await prisma.$connect();
  const [origin, receiving, alternate] = await Promise.all([
    createProvider('origin', ProviderType.SCREENING_CENTRE),
    createProvider('receiving', ProviderType.HOSPITAL),
    createProvider('alternate', ProviderType.CLINIC),
  ]);
  originId = origin.id;
  receivingId = receiving.id;
  alternateId = alternate.id;

  const [patient, doctor, coordinatorOrigin, coordinatorReceiving, doctorReceiving, coordinatorAlternate, admin] =
    await Promise.all([
      createUser('PATIENT', 'patient', null),
      createUser('DOCTOR', 'doctor-origin', originId),
      createUser('COORDINATOR', 'coordinator-origin', originId),
      createUser('COORDINATOR', 'coordinator-receiving', receivingId),
      createUser('DOCTOR', 'doctor-receiving', receivingId),
      createUser('COORDINATOR', 'coordinator-alternate', alternateId),
      createUser('ADMIN', 'admin', null),
    ]);
  Object.assign(users, {
    PATIENT: patient,
    DOCTOR: doctor,
    COORDINATOR_ORIGIN: coordinatorOrigin,
    COORDINATOR_RECEIVING: coordinatorReceiving,
    DOCTOR_RECEIVING: doctorReceiving,
    COORDINATOR_ALTERNATE: coordinatorAlternate,
    ADMIN: admin,
  });
  patientId = (
    await prisma.patient.create({
      data: {
        userId: patient.id,
        syntheticMrn: `T105B-${suffix}`,
        dateOfBirth: new Date('1980-01-01T00:00:00.000Z'),
        preferredLanguage: 'EN',
      },
    })
  ).id;
  await prisma.consent.createMany({
    data: [receivingId, alternateId].map((providerId) => ({
      patientId,
      providerId,
      scope: 'CROSS_PROVIDER_REFERRAL' as const,
      grantedAt: new Date(now.getTime() - 60_000),
    })),
  });

  const app = createApp({
    prisma,
    clock,
    env: {
      NODE_ENV: 'test',
      SERVER_PORT: 0,
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      JWT_SECRET: secret,
      CLIENT_ORIGIN: clientOrigin,
      DEMO_PASSWORD: 'unused-test-password',
    },
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe('T-105b transition HTTP routes', () => {
  test('HTTP happy journey uses each provider role and receiving DTO remains a ReferralPacket', async () => {
    const item = await makeCase('NEW', { route: 'REFERRAL', assigned: true });
    const explanations = await approvedExplanations(item.id);
    await seedReviewedSent(item.id);

    const reviewed = await transition('DOCTOR', item.id, {
      transitionKey: 'REVIEW_CASE',
      expectedState: 'NEW',
      evidence: { approvedExplanationIds: explanations },
    });
    assert.equal(reviewed.status, 200);
    assert.equal(stateOf(await responseBody(reviewed)), 'CLINICIAN_REVIEWED');

    const referred = await transition('COORDINATOR_ORIGIN', item.id, {
      transitionKey: 'CREATE_REFERRAL_FROM_REVIEW',
      expectedState: 'CLINICIAN_REVIEWED',
      evidence: { toProviderId: receivingId, referralReason: 'Synthetic referral reason.' },
    });
    assert.equal(referred.status, 200);
    const referredBody = await responseBody(referred);
    const referralId = referredBody.event.payload?.referralId;
    assert.equal(stateOf(referredBody), 'REFERRAL_PENDING');
    assert.equal(typeof referralId, 'string');

    const accepted = await transition('COORDINATOR_RECEIVING', item.id, {
      transitionKey: 'ACCEPT_REFERRAL',
      expectedState: 'REFERRAL_PENDING',
      evidence: { referralId },
    });
    assert.equal(accepted.status, 200);
    const acceptedBody = await responseBody(accepted);
    assert.equal(stateOf(acceptedBody), undefined);
    assert.equal('referralId' in acceptedBody.case, true);
    assertNoClinicalFields(acceptedBody);

    const scheduledAt = new Date(now.getTime() + 5 * 86_400_000).toISOString();
    const scheduled = await transition('COORDINATOR_RECEIVING', item.id, {
      transitionKey: 'SCHEDULE_APPOINTMENT',
      expectedState: 'REFERRAL_ACCEPTED',
      evidence: { scheduledAt, location: 'Receiving clinic, room 3' },
    });
    assert.equal(scheduled.status, 200);
    const scheduledBody = await responseBody(scheduled);
    assert.equal(stateOf(scheduledBody), undefined);
    assertNoClinicalFields(scheduledBody);
    assert.equal(scheduledBody.event.payload, null);
    const appointment = await prisma.appointment.findFirstOrThrow({
      where: { referral: { caseId: item.id } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const appointmentId = appointment.id;

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'ATTENDED' },
    });
    const started = await transition('DOCTOR_RECEIVING', item.id, {
      transitionKey: 'START_CARE',
      expectedState: 'APPOINTMENT_SCHEDULED',
      evidence: { carePlan: 'Synthetic care plan.' },
    });
    assert.equal(started.status, 200);
    const startedBody = await responseBody(started);
    assert.equal(stateOf(startedBody), undefined);
    assertNoClinicalFields(startedBody);

    const closed = await transition('DOCTOR_RECEIVING', item.id, {
      transitionKey: 'CLOSE_COMPLETED_CARE',
      expectedState: 'CARE_STARTED',
      evidence: {
        closureReason: 'COMPLETED_CARE',
        documentedReason: 'Synthetic care completed.',
        careCompletionSummary: 'Synthetic completion recorded.',
      },
    });
    assert.equal(closed.status, 200);
    const closedBody = await responseBody(closed);
    assert.equal(stateOf(closedBody), undefined);
    assertNoClinicalFields(closedBody);
    assert.equal(closedBody.event.type, 'CASE_CLOSED');
    const persistedCase = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(persistedCase.state, 'CLOSED');
    assert.equal(persistedCase.closureReason, 'COMPLETED_CARE');
  });

  test('HTTP rejected referral path can be reassigned', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    await approvedExplanations(item.id);
    await prisma.referral.create({
      data: {
        caseId: item.id,
        fromProviderId: originId,
        toProviderId: receivingId,
        status: 'REJECTED',
        rejectionReason: 'No capacity',
        respondedAt: now,
        reason: 'Initial synthetic referral.',
        createdAt: now,
        updatedAt: now,
      },
    });
    const response = await transition('COORDINATOR_ORIGIN', item.id, {
      transitionKey: 'REASSIGN_REFERRAL',
      expectedState: 'REFERRAL_PENDING',
      evidence: { toProviderId: alternateId, referralReason: 'Alternate provider referral.' },
    });
    assert.equal(response.status, 200);
    const referrals = await prisma.referral.findMany({ where: { caseId: item.id } });
    assert.deepEqual(referrals.map((row) => row.status).sort(), ['PENDING', 'SUPERSEDED']);
  });

  test('route returns every transition error status and code', async () => {
    const unauthenticatedCase = await makeCase('NEW');
    const noAuth = await transition(undefined, unauthenticatedCase.id, validReviewBody());
    await assertError(noAuth, 401, 'UNAUTHENTICATED');

    const patientCase = await makeCase('NEW');
    await assertError(
      await transition('PATIENT', patientCase.id, validReviewBody()),
      403,
      'FORBIDDEN',
    );
    await assertError(
      await transition('ADMIN', patientCase.id, validReviewBody()),
      403,
      'FORBIDDEN',
    );

    const unseen = await makeCase('NEW');
    await assertError(
      await transition('COORDINATOR_ALTERNATE', unseen.id, {
        transitionKey: 'REVIEW_CASE',
        expectedState: 'NEW',
        evidence: { approvedExplanationIds: [randomUUID(), randomUUID()] },
      }),
      404,
      'NOT_FOUND',
    );

    const invalid = await makeCase('NEW');
    await assertError(
      await transition('DOCTOR', invalid.id, {
        transitionKey: 'ACCEPT_REFERRAL',
        expectedState: 'NEW',
        evidence: { referralId: randomUUID() },
      }),
      409,
      'INVALID_TRANSITION',
    );

    const stale = await makeCase('NEW');
    await assertError(
      await transition('DOCTOR', stale.id, {
        transitionKey: 'REVIEW_CASE',
        expectedState: 'CLINICIAN_REVIEWED',
        evidence: { approvedExplanationIds: [randomUUID(), randomUUID()] },
      }),
      409,
      'CONFLICT',
    );

    const missingEvidence = await makeCase('NEW', { route: 'REFERRAL' });
    await assertError(
      await transition('DOCTOR', missingEvidence.id, validReviewBody()),
      422,
      'EVIDENCE_MISSING',
    );

    const noConsent = await makeCase('CLINICIAN_REVIEWED', { route: 'REFERRAL' });
    await seedReviewedSent(noConsent.id);
    const consentFailure = await transition('COORDINATOR_ORIGIN', noConsent.id, {
      transitionKey: 'CREATE_REFERRAL_FROM_REVIEW',
      expectedState: 'CLINICIAN_REVIEWED',
      evidence: { toProviderId: randomUUID(), referralReason: 'Cross-provider referral.' },
    });
    await assertError(consentFailure, 403, 'CONSENT_REQUIRED');

    const overdue = await makeCase('REFERRAL_PENDING');
    await prisma.referral.create({
      data: {
        caseId: overdue.id,
        fromProviderId: originId,
        toProviderId: receivingId,
        status: 'REJECTED',
        rejectionReason: 'No capacity',
        respondedAt: now,
      },
    });
    await prisma.screeningCase.update({
      where: { id: overdue.id },
      data: { dueAt: new Date(now.getTime() - 1_000) },
    });
    await assertError(
      await transition('COORDINATOR_ORIGIN', overdue.id, {
        transitionKey: 'REASSIGN_REFERRAL',
        expectedState: 'REFERRAL_PENDING',
        evidence: { toProviderId: alternateId, referralReason: 'Reassign.' },
      }),
      422,
      'DELAY_REASON_REQUIRED',
    );

    const closeCase = await makeCase('CARE_STARTED');
    await acceptedReferralAndAttendedAppointment(closeCase.id);
    await assertError(
      await transition('COORDINATOR_RECEIVING', closeCase.id, {
        transitionKey: 'CLOSE_CARE_TRANSFERRED_OUT',
        expectedState: 'CARE_STARTED',
        evidence: {
          closureReason: 'TRANSFERRED_OUT',
          documentedReason: 'Transfer.',
          externalProviderName: 'Other facility',
          facilityContact: 'Synthetic contact',
          handoverSummary: 'Synthetic handover.',
        },
      }),
      403,
      'FORBIDDEN',
    );

    const extraFieldCase = await makeCase('NEW');
    await assertError(
      await transition('DOCTOR', extraFieldCase.id, {
        ...validReviewBody(),
        clientSuppliedDerivedField: true,
      }),
      400,
      'VALIDATION_ERROR',
    );
  });

  test('two concurrent identical transition requests return one 200 and one 409', async () => {
    const item = await makeCase('NEW', { route: 'REFERRAL', assigned: true });
    const ids = await approvedExplanations(item.id);
    const body = {
      transitionKey: 'REVIEW_CASE',
      expectedState: 'NEW',
      evidence: { approvedExplanationIds: ids },
    };
    const results = await Promise.all([
      transition('DOCTOR', item.id, body),
      transition('DOCTOR', item.id, body),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const conflict = results.find((result) => result.status === 409);
    assert.ok(conflict);
    assert.equal((await errorBody(conflict)).error.code, 'CONFLICT');
    assert.equal(await prisma.caseEvent.count({ where: { caseId: item.id, type: 'CASE_REVIEWED' } }), 1);
  });
});

type ActorKey = keyof typeof users;

async function transition(actor: ActorKey | undefined, caseId: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/cases/${caseId}/transitions`, {
    method: 'POST',
    headers: {
      ...(actor ? authHeaders(actor) : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function authHeaders(actor: ActorKey): Record<string, string> {
  const user = users[actor];
  const role: Role = actor === 'PATIENT' ? 'PATIENT'
    : actor === 'ADMIN' ? 'ADMIN'
      : actor.startsWith('COORDINATOR') ? 'COORDINATOR' : 'DOCTOR';
  const token = jwt.sign({ userId: user.id, role }, secret, { expiresIn: '1h' });
  return { Cookie: `${AUTH_COOKIE_NAME}=${token}` };
}

function validReviewBody() {
  return {
    transitionKey: 'REVIEW_CASE',
    expectedState: 'NEW',
    evidence: { approvedExplanationIds: [randomUUID(), randomUUID()] },
  };
}

async function responseBody(response: Response): Promise<CaseTransitionResponse> {
  return CaseTransitionResponseSchema.parse(await response.json());
}

function stateOf(response: CaseTransitionResponse): string | undefined {
  return 'state' in response.case ? response.case.state : undefined;
}

async function errorBody(response: Response): Promise<{ error: { code: string; message: string; details?: unknown } }> {
  return (await response.json()) as { error: { code: string; message: string; details?: unknown } };
}

async function assertError(response: Response, status: number, code: string): Promise<void> {
  assert.equal(response.status, status);
  assert.equal((await errorBody(response)).error.code, code);
}

function assertNoClinicalFields(value: unknown): void {
  const forbidden = new Set(['resultCategory', 'resultSummaryApproved', 'preliminarySummary', 'originOnlyNotes']);
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        assert.equal(forbidden.has(key), false, `Receiving packet leaked ${key}`);
        visit(child);
      }
    }
  };
  visit(value);
}

async function createProvider(label: string, type: ProviderType) {
  return prisma.provider.create({ data: { name: `T105b ${label} ${suffix}`, type } });
}

async function createUser(role: Role, label: string, providerId: string | null) {
  const user = await prisma.user.create({
    data: {
      email: `t105b-${label}-${suffix}@careloop.test`,
      name: `T-105b ${label}`,
      role,
      providerId,
      passwordHash: 'test-only-hash',
    },
  });
  return { id: user.id, providerId };
}

async function makeCase(
  state: 'NEW' | 'CLINICIAN_REVIEWED' | 'REFERRAL_PENDING' | 'CARE_STARTED',
  options: { route?: 'REFERRAL' | 'CONFIRMATION'; assigned?: boolean } = {},
) {
  const row = await prisma.screeningCase.create({
    data: {
      patientId,
      originProviderId: originId,
      createdById: users.DOCTOR.id,
      pathway: 'Synthetic adult screening pathway',
      screeningType: 'Synthetic screening',
      resultCategory: 'Private synthetic result category',
      resultSummaryApproved: state === 'NEW' ? null : 'Private synthetic summary',
      recommendedNextStep: state === 'NEW' ? null : 'Synthetic next step',
      reviewDraftSummary: options.route ? 'Saved synthetic review draft' : null,
      reviewDraftNextStep: options.route ? 'Saved synthetic next step' : null,
      reviewDraftUrgencyLabel: options.route ? 'ROUTINE' : null,
      reviewRoute: options.route ?? null,
      intakeUrgency: 'ROUTINE',
      urgencyLabel: state === 'NEW' ? null : 'ROUTINE',
      state,
      ownerUserId: options.assigned ? users.DOCTOR.id : null,
      ownerQueueRole: null,
      ownerQueueProviderId: null,
      dueAt: new Date(now.getTime() + 7 * 86_400_000),
      createdAt: now,
      updatedAt: now,
    },
  });
  return row;
}

async function approvedExplanations(caseId: string): Promise<[string, string]> {
  const common = {
    caseId,
    text: 'Approved synthetic patient explanation.',
    source: ExplanationSource.TEMPLATE,
    status: ExplanationStatus.APPROVED,
    approvedBy: users.DOCTOR.id,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  } as const;
  const en = await prisma.explanationDraft.create({ data: { ...common, language: 'EN' } });
  const ar = await prisma.explanationDraft.create({
    data: { ...common, language: 'AR', createdAt: new Date(now.getTime() + 1), updatedAt: new Date(now.getTime() + 1) },
  });
  return [en.id, ar.id];
}

async function seedReviewedSent(caseId: string): Promise<void> {
  await prisma.$transaction((tx) => appendEvent(tx, {
    caseId,
    type: CaseEventType.NOTIFICATION_SENT,
    actorType: ActorType.SYSTEM,
    payload: { templateKey: 'result_reviewed' },
  }, clock));
}

async function acceptedReferralAndAttendedAppointment(caseId: string): Promise<void> {
  const referral = await prisma.referral.create({
    data: {
      caseId,
      fromProviderId: originId,
      toProviderId: receivingId,
      status: 'ACCEPTED',
      respondedAt: now,
    },
  });
  await prisma.appointment.create({
    data: {
      referralId: referral.id,
      scheduledAt: new Date(now.getTime() + 86_400_000),
      status: 'ATTENDED',
    },
  });
}
