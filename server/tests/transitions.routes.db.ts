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
import { hashExplanationInput } from '../src/modules/explanation/provider';

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
  test('T-401b HTTP journey creates case, drafts, approvals, review, dispatch, acknowledgement, explanation read, and understanding', async () => {
    const created = await createCaseHttp();
    assert.equal(created.status, 201);
    const caseId = (await created.json() as { case: { id: string } }).case.id;
    assert.equal((await api('DOCTOR', 'PUT', `/cases/${caseId}/review-draft`, completeDraft())).status, 200);
    const generated = await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/generate`, {});
    assert.equal(generated.status, 200);
    const drafts = (await generated.json() as { explanations: Array<{ id: string; language: string }> }).explanations;
    const en = drafts.find((item) => item.language === 'EN')!;
    const ar = drafts.find((item) => item.language === 'AR')!;
    const repeated = await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/generate`, {});
    assert.deepEqual((await repeated.json() as { explanations: Array<{ id: string }> }).explanations.map((item) => item.id), drafts.map((item) => item.id));
    assert.equal((await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/${en.id}/approve`, {})).status, 200);
    assert.equal((await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/${ar.id}/approve`, {})).status, 200);
    assert.equal((await api('DOCTOR', 'POST', `/cases/${caseId}/transitions`, { transitionKey: 'REVIEW_CASE', expectedState: 'NEW', evidence: { approvedExplanationIds: [en.id, ar.id] } })).status, 200);
    const queued = await prisma.notification.findFirstOrThrow({ where: { caseId, templateKey: 'result_reviewed' } });
    assert.equal((await api('COORDINATOR_ORIGIN', 'POST', `/notifications/${queued.id}/dispatch`, {})).status, 200);
    const listed = await api('PATIENT', 'GET', '/notifications');
    assert.equal(listed.status, 200);
    assert.equal((await api('PATIENT', 'POST', `/notifications/${queued.id}/acknowledge`, {})).status, 200);
    const visible = await api('PATIENT', 'GET', `/cases/${caseId}/explanations`);
    assert.equal(visible.status, 200);
    const visibleItems = (await visible.json() as { items: Array<{ id: string; text: string; doctorNoteSection: { label: string; text: string } | null }> }).items;
    assert.deepEqual(new Set(visibleItems.map((item) => item.id)), new Set([en.id, ar.id]));
    for (const item of visibleItems) {
      assert.doesNotMatch(item.text, /\p{N}|cancer|tumou?r|aspirin|insulin|سرطان|سكري|دواء/iu);
      assert.equal(item.doctorNoteSection?.label, 'Not translated');
      assert.equal(item.text.includes('Please discuss the next step.'), false);
    }
    const readAudit = await prisma.auditLog.findFirst({ where: { action: 'EXPLANATIONS_READ', entityId: caseId, actorId: users.PATIENT.id } });
    assert.ok(readAudit);
    assert.equal((await api('PATIENT', 'POST', `/cases/${caseId}/understanding`, { explanationId: en.id })).status, 200);
  });

  test('T-401b generate rejects an incomplete review draft with 422 EVIDENCE_MISSING', async () => {
    const caseId = (await createCaseHttp().then(async (r) => (await r.json() as { case: { id: string } }).case.id));
    await assertError(await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/generate`, {}), 422, 'EVIDENCE_MISSING');
  });

  test('T-202a concurrent identical explanation generation leaves exactly one EN and one AR draft', async () => {
    const caseId = await newCaseWithDraft();
    const responses = await Promise.all([
      api('DOCTOR', 'POST', `/cases/${caseId}/explanations/generate`, {}),
      api('DOCTOR', 'POST', `/cases/${caseId}/explanations/generate`, {}),
    ]);
    assert.ok(responses.every((response) => response.status === 200));
    const rows = await prisma.explanationDraft.findMany({ where: { caseId } });
    assert.equal(rows.filter((row) => row.language === 'EN').length, 1);
    assert.equal(rows.filter((row) => row.language === 'AR').length, 1);
  });

  test('T-401b patients and coordinators receive 403 for draft, generate, and approve actions', async () => {
    const caseId = await newCaseWithDraft();
    const ids = await draftIds(caseId);
    for (const actor of ['PATIENT', 'COORDINATOR_ORIGIN'] as const) {
      await assertError(await api(actor, 'PUT', `/cases/${caseId}/review-draft`, completeDraft()), 403, 'FORBIDDEN');
      await assertError(await api(actor, 'POST', `/cases/${caseId}/explanations/generate`, {}), 403, 'FORBIDDEN');
      await assertError(await api(actor, 'POST', `/cases/${caseId}/explanations/${ids.en}/approve`, {}), 403, 'FORBIDDEN');
    }
  });

  test('T-401b doctor from another provider receives 404 for draft, generation, and approval', async () => {
    const caseId = await newCaseWithDraft();
    const ids = await draftIds(caseId);
    await assertError(await api('DOCTOR_RECEIVING', 'PUT', `/cases/${caseId}/review-draft`, completeDraft()), 404, 'NOT_FOUND');
    await assertError(await api('DOCTOR_RECEIVING', 'POST', `/cases/${caseId}/explanations/generate`, {}), 404, 'NOT_FOUND');
    await assertError(await api('DOCTOR_RECEIVING', 'POST', `/cases/${caseId}/explanations/${ids.en}/approve`, {}), 404, 'NOT_FOUND');
  });

  test('T-401b patient explanation list never returns a DRAFT row', async () => {
    const caseId = await newCaseWithDraft();
    await draftIds(caseId);
    const response = await api('PATIENT', 'GET', `/cases/${caseId}/explanations`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { items: unknown[] }).items, []);
  });

  test('T-401b coordinator sees only approved current explanations without case clinical fields', async () => {
    const caseId = await newCaseWithDraft();
    const ids = await draftIds(caseId);
    await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/${ids.en}/approve`, {});
    await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/${ids.ar}/approve`, {});
    const response = await api('COORDINATOR_ORIGIN', 'GET', `/cases/${caseId}/explanations`);
    assert.equal(response.status, 200);
    const items = (await response.json() as { items: Array<Record<string, unknown>> }).items;
    assert.equal(items.length, 2);
    assert.ok(items.every((item) => item.status === 'APPROVED' && item.current === true));
    for (const item of items) {
      assert.equal(Object.hasOwn(item, 'resultCategory'), false);
      assert.equal(Object.hasOwn(item, 'resultSummaryApproved'), false);
      assert.equal(Object.hasOwn(item, 'patient'), false);
    }
  });

  test('T-401b origin doctor sees stale explanation history with current labels', async () => {
    const caseId = await newCaseWithDraft();
    const first = await draftIds(caseId);
    await api('DOCTOR', 'PUT', `/cases/${caseId}/review-draft`, { ...completeDraft(), resultCategoryCode: 'UNCLEAR_RESULT' });
    const response = await api('DOCTOR', 'GET', `/cases/${caseId}/explanations`);
    assert.equal(response.status, 200);
    const items = (await response.json() as { items: Array<{ id: string; current: boolean; stale?: boolean }> }).items;
    assert.equal(items.length, 2);
    assert.ok(items.every((item) => item.current === false && item.stale === true));
    assert.ok(items.some((item) => item.id === first.en));
    assert.ok(items.some((item) => item.id === first.ar));
  });

  test('T-401b changed draft generation creates a new bilingual pair and retains old rows', async () => {
    const caseId = await newCaseWithDraft();
    const old = await draftIds(caseId);
    await api('DOCTOR', 'PUT', `/cases/${caseId}/review-draft`, { ...completeDraft(), resultCategoryCode: 'UNCLEAR_RESULT' });
    const fresh = await draftIds(caseId);
    assert.notEqual(fresh.en, old.en);
    assert.notEqual(fresh.ar, old.ar);
    assert.equal(await prisma.explanationDraft.count({ where: { caseId } }), 4);
    const history = await api('DOCTOR', 'GET', `/cases/${caseId}/explanations`);
    const rows = (await history.json() as { items: Array<{ id: string; current: boolean }> }).items;
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((item) => item.current).length, 2);
  });

  test('T-401b editing a review draft makes approvals stale and REVIEW_CASE fail', async () => {
    const caseId = await newCaseWithDraft();
    const ids = await draftIds(caseId);
    await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/${ids.en}/approve`, {});
    await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/${ids.ar}/approve`, {});
    await api('DOCTOR', 'PUT', `/cases/${caseId}/review-draft`, { ...completeDraft(), resultCategoryCode: 'UNCLEAR_RESULT' });
    const patientRead = await api('PATIENT', 'GET', `/cases/${caseId}/explanations`);
    assert.deepEqual((await patientRead.json() as { items: unknown[] }).items, []);
    await assertError(await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/${ids.en}/approve`, {}), 409, 'CONFLICT');
    await assertError(await api('DOCTOR', 'POST', `/cases/${caseId}/transitions`, { transitionKey: 'REVIEW_CASE', expectedState: 'NEW', evidence: { approvedExplanationIds: [ids.en, ids.ar] } }), 422, 'EVIDENCE_MISSING');
  });

  test('T-401b approving an already approved explanation returns 409 CONFLICT', async () => {
    const caseId = await newCaseWithDraft();
    const ids = await draftIds(caseId);
    assert.equal((await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/${ids.en}/approve`, {})).status, 200);
    await assertError(await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/${ids.en}/approve`, {}), 409, 'CONFLICT');
  });

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

  test('T-202a receiving coordinator rejection records response and returns ownership to the origin queue', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING', reason: 'Synthetic referral.' } });
    const response = await api('COORDINATOR_RECEIVING', 'POST', `/referrals/${referral.id}/reject`, { rejectionReason: 'No capacity' });
    assert.equal(response.status, 200);
    const updated = await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } });
    const currentCase = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(updated.status, 'REJECTED');
    assert.equal(updated.respondedAt?.toISOString(), now.toISOString());
    assert.equal(currentCase.state, 'REFERRAL_PENDING');
    assert.equal(currentCase.ownerQueueRole, 'COORDINATOR');
    assert.equal(currentCase.ownerQueueProviderId, originId);
    assert.equal(currentCase.dueAt?.toISOString(), new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString());
    assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: 'REFERRAL_REJECTED', payload: { path: ['referralId'], equals: referral.id } } }));
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'REFERRAL_REJECTED', entityId: referral.id } }));
  });

  test('T-205a urgent referral rejection sets the four hour reassignment deadline', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    await prisma.screeningCase.update({ where: { id: item.id }, data: { urgencyLabel: 'URGENT' } });
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    assert.equal((await api('COORDINATOR_RECEIVING', 'POST', `/referrals/${referral.id}/reject`, { rejectionReason: 'No capacity' })).status, 200);
    const updated = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(updated.dueAt?.toISOString(), new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString());
  });

  test('T-205a case referral history is scoped, cursor paged, and concealed from another provider', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    await prisma.referral.createMany({ data: [
      { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'SUPERSEDED', createdAt: new Date(now.getTime() - 1000), updatedAt: new Date(now.getTime() - 1000) },
      { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING', createdAt: now, updatedAt: now },
    ] });
    const first = await api('COORDINATOR_ORIGIN', 'GET', `/cases/${item.id}/referrals?limit=1`);
    assert.equal(first.status, 200);
    const firstBody = await responseBody(first);
    assert.equal(firstBody.items.length, 1);
    assert.ok(firstBody.nextCursor);
    const second = await api('COORDINATOR_ORIGIN', 'GET', `/cases/${item.id}/referrals?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`);
    assert.equal((await responseBody(second)).items.length, 1);
    assert.equal((await api('COORDINATOR_ALTERNATE', 'GET', `/cases/${item.id}/referrals`)).status, 404);
  });

  test('T-205a referral appointment history is scoped, cursor paged, and concealed from another provider', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'ACCEPTED' } });
    await prisma.appointment.createMany({ data: [
      { referralId: referral.id, scheduledAt: new Date(now.getTime() + 86400000), status: 'SCHEDULED', createdAt: new Date(now.getTime() - 1000), updatedAt: new Date(now.getTime() - 1000) },
      { referralId: referral.id, scheduledAt: new Date(now.getTime() + 2 * 86400000), status: 'SCHEDULED', createdAt: now, updatedAt: now },
    ] });
    const first = await api('COORDINATOR_ORIGIN', 'GET', `/referrals/${referral.id}/appointments?limit=1`);
    assert.equal(first.status, 200);
    const firstBody = await responseBody(first);
    assert.equal(firstBody.items.length, 1);
    assert.ok(firstBody.nextCursor);
    const second = await api('COORDINATOR_ORIGIN', 'GET', `/referrals/${referral.id}/appointments?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`);
    assert.equal((await responseBody(second)).items.length, 1);
    assert.equal((await api('COORDINATOR_ALTERNATE', 'GET', `/referrals/${referral.id}/appointments`)).status, 404);
  });

  test('T-202a referral rejection is forbidden to the origin coordinator', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    assert.equal((await api('COORDINATOR_ORIGIN', 'POST', `/referrals/${referral.id}/reject`, { rejectionReason: 'No capacity' })).status, 403);
  });

  test('T-202a rejected referral cannot be rejected twice', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'REJECTED', rejectionReason: 'No capacity', respondedAt: now } });
    assert.equal((await api('COORDINATOR_RECEIVING', 'POST', `/referrals/${referral.id}/reject`, { rejectionReason: 'Again' })).status, 409);
  });

  test('T-202a unrelated provider cannot reject a referral', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    await assertError(await api('COORDINATOR_ALTERNATE', 'POST', `/referrals/${referral.id}/reject`, { rejectionReason: 'No capacity' }), 403, 'FORBIDDEN');
  });

  test('T-202a rejected referral can be reassigned and resets receiving owner and SLA', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    assert.equal((await api('COORDINATOR_RECEIVING', 'POST', `/referrals/${referral.id}/reject`, { rejectionReason: 'No capacity' })).status, 200);
    const reassigned = await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/transitions`, { transitionKey: 'REASSIGN_REFERRAL', expectedState: 'REFERRAL_PENDING', evidence: { toProviderId: alternateId, referralReason: 'Alternative provider.' } });
    assert.equal(reassigned.status, 200);
    const currentCase = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(currentCase.ownerQueueProviderId, alternateId);
    assert.equal(currentCase.ownerQueueRole, 'COORDINATOR');
    assert.equal(currentCase.dueAt?.toISOString(), new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString());
  });

  test('T-202a ATTENDED records timestamp, event, audit and 24 hour recovery deadline without starting care', async () => {
    const { item, appointment } = await scheduledAppointmentForAttendance();
    const response = await api('COORDINATOR_RECEIVING', 'POST', `/appointments/${appointment.id}/attendance`, { status: 'ATTENDED' });
    assert.equal(response.status, 200);
    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    const currentCase = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(updated.status, 'ATTENDED');
    assert.equal(updated.attendedAt?.toISOString(), now.toISOString());
    assert.equal(currentCase.state, 'APPOINTMENT_SCHEDULED');
    assert.equal(currentCase.dueAt?.toISOString(), new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString());
    assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: 'APPOINTMENT_ATTENDED' } }));
    assert.ok(await prisma.auditLog.findFirst({ where: { entityType: 'Appointment', entityId: appointment.id, action: 'APPOINTMENT_ATTENDED' } }));
  });

  test('T-202a MISSED records reason events and urgent four hour recovery deadline', async () => {
    const { item, appointment } = await scheduledAppointmentForAttendance('URGENT');
    const response = await api('COORDINATOR_RECEIVING', 'POST', `/appointments/${appointment.id}/attendance`, { status: 'MISSED', delayReason: 'PATIENT_UNREACHABLE', note: 'Synthetic contact note.' });
    assert.equal(response.status, 200);
    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    const currentCase = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(updated.status, 'MISSED');
    assert.equal(updated.delayReason, 'PATIENT_UNREACHABLE');
    assert.equal(currentCase.dueAt?.toISOString(), new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString());
    assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: 'APPOINTMENT_MISSED' } }));
    assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: 'DELAY_REASON_RECORDED' } }));
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'APPOINTMENT_MISSED', entityId: appointment.id } }));
  });

  test('T-202a MISSED without delayReason returns 422 DELAY_REASON_REQUIRED', async () => {
    const { appointment } = await scheduledAppointmentForAttendance();
    await assertError(await api('COORDINATOR_RECEIVING', 'POST', `/appointments/${appointment.id}/attendance`, { status: 'MISSED' }), 422, 'DELAY_REASON_REQUIRED');
  });

  test('T-202a attendance is denied to origin coordinator', async () => {
    const { appointment } = await scheduledAppointmentForAttendance();
    await assertError(await api('COORDINATOR_ORIGIN', 'POST', `/appointments/${appointment.id}/attendance`, { status: 'ATTENDED' }), 403, 'FORBIDDEN');
  });

  test('T-202a attendance on an appointment that is no longer scheduled returns 409', async () => {
    const { appointment } = await scheduledAppointmentForAttendance();
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'MISSED', delayReason: 'PATIENT_UNREACHABLE' } });
    await assertError(await api('COORDINATOR_RECEIVING', 'POST', `/appointments/${appointment.id}/attendance`, { status: 'ATTENDED' }), 409, 'CONFLICT');
  });

  test('T-202a contact attempt derives current referral milestone and rejects client milestone identifiers', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    const response = await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'REACHED' });
    assert.equal(response.status, 201);
    const saved = await prisma.contactAttempt.findFirstOrThrow({ where: { caseId: item.id } });
    assert.equal(saved.milestoneState, 'REFERRAL_PENDING');
    assert.equal(saved.referralId, referral.id);
    assert.equal(saved.appointmentId, null);
    assert.equal((await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'REACHED', referralId: randomUUID() })).status, 400);
    assert.equal((await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'REACHED', appointmentId: randomUUID() })).status, 400);
  });

  test('T-202a the second failed contact attempt does not raise LEVEL_2 and the third does', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    for (let index = 1; index <= 2; index += 1) {
      const response = await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'FAILED' });
      assert.equal(response.status, 201);
      const row = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(row.escalationLevel, 'LEVEL_0');
    }
    assert.equal((await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'NO_ANSWER' })).status, 201);
    const after = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(after.escalationLevel, 'LEVEL_2');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'ESCALATION_RAISED', entityType: 'ScreeningCase', entityId: item.id } }));
  });

  test('T-202a failed counts are isolated when the case advances to a different milestone', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    for (let index = 0; index < 2; index += 1) await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'FAILED' });
    await prisma.screeningCase.update({ where: { id: item.id }, data: { state: 'APPOINTMENT_SCHEDULED' } });
    const appointment = await prisma.appointment.create({ data: { referralId: referral.id, scheduledAt: new Date(now.getTime() + 86_400_000) } });
    const response = await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'FAILED' });
    assert.equal(response.status, 201);
    const result = await response.json() as { contactAttempt: { id: string } };
    const row = await prisma.contactAttempt.findUniqueOrThrow({ where: { id: result.contactAttempt.id } });
    assert.equal(row.milestoneState, 'APPOINTMENT_SCHEDULED');
    assert.equal(row.appointmentId, appointment.id);
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).escalationLevel, 'LEVEL_0');
  });

  test('T-202a failed contact sends unreachable_retry while REACHED does not', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'REACHED' });
    assert.equal(await prisma.notification.count({ where: { caseId: item.id, templateKey: 'unreachable_retry' } }), 0);
    await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'NO_ANSWER' });
    assert.equal(await prisma.notification.count({ where: { caseId: item.id, templateKey: 'unreachable_retry', status: 'SENT' } }), 1);
    const retry = await prisma.notification.findFirstOrThrow({ where: { caseId: item.id, templateKey: 'unreachable_retry' } });
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'UNREACHABLE_RETRY_SENT', entityId: retry.id } }));
  });

  test('T-202a patient and doctor cannot write contact attempts', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    await assertError(await api('PATIENT', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'REACHED' }), 403, 'FORBIDDEN');
    await assertError(await api('DOCTOR', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'REACHED' }), 403, 'FORBIDDEN');
  });

  test('T-202a contact attempt write creates audit row and a readable attempt list', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    const response = await api('COORDINATOR_ORIGIN', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PORTAL', outcome: 'REACHED' });
    assert.equal(response.status, 201);
    const attempt = await prisma.contactAttempt.findFirstOrThrow({ where: { caseId: item.id } });
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'CONTACT_ATTEMPT_LOGGED', entityId: attempt.id } }));
    const list = await api('COORDINATOR_ORIGIN', 'GET', `/cases/${item.id}/contact-attempts?limit=10`);
    assert.equal(list.status, 200);
    assert.equal((await list.json() as { items: unknown[] }).items.length, 1);
  });

  test('T-202a receiving coordinator can contact only while a live consented referral exists', async () => {
    const item = await makeCase('REFERRAL_PENDING');
    const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'PENDING' } });
    assert.equal((await api('COORDINATOR_RECEIVING', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'REACHED' })).status, 201);
    assert.equal((await api('COORDINATOR_RECEIVING', 'GET', `/cases/${item.id}/contact-attempts`)).status, 200);
    assert.equal((await api('COORDINATOR_RECEIVING', 'POST', `/referrals/${referral.id}/reject`, { rejectionReason: 'Capacity unavailable' })).status, 200);
    assert.equal((await api('COORDINATOR_RECEIVING', 'POST', `/cases/${item.id}/contact-attempts`, { channel: 'PHONE', outcome: 'REACHED' })).status, 404);
    assert.equal((await api('COORDINATOR_RECEIVING', 'GET', `/cases/${item.id}/contact-attempts`)).status, 404);
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

function completeDraft() {
  return { resultCategoryCode: 'FOLLOW_UP_NEEDED', nextStepCode: 'SPECIALIST_REFERRAL', urgencyLabel: 'ROUTINE', route: 'REFERRAL', doctorNote: 'Please discuss the next step.' };
}

async function api(actor: ActorKey, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { ...authHeaders(actor), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createCaseHttp(): Promise<Response> {
  return api('ADMIN', 'POST', '/cases', { transitionKey: 'CREATE_CASE', evidence: {
    patientId,
    originProviderId: originId,
    assignedDoctorId: users.DOCTOR.id,
    pathway: 'Synthetic screening pathway',
    screeningType: 'Synthetic screening',
    resultCategory: 'Synthetic actionable result',
    preliminarySummary: 'Synthetic intake summary.',
    recommendedAction: 'Clinician review required.',
    intakeUrgency: 'ROUTINE',
  } });
}

async function newCaseWithDraft(): Promise<string> {
  const response = await createCaseHttp();
  assert.equal(response.status, 201);
  const caseId = (await response.json() as { case: { id: string } }).case.id;
  assert.equal((await api('DOCTOR', 'PUT', `/cases/${caseId}/review-draft`, completeDraft())).status, 200);
  return caseId;
}

async function draftIds(caseId: string): Promise<{ en: string; ar: string }> {
  const response = await api('DOCTOR', 'POST', `/cases/${caseId}/explanations/generate`, {});
  assert.equal(response.status, 200);
  const rows = (await response.json() as { explanations: Array<{ id: string; language: string }> }).explanations;
  return { en: rows.find((row) => row.language === 'EN')!.id, ar: rows.find((row) => row.language === 'AR')!.id };
}

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
      reviewDraftResultCategoryCode: options.route ? 'FOLLOW_UP_NEEDED' : null,
      reviewDraftNextStepCode: options.route ? (options.route === 'CONFIRMATION' ? 'CONFIRMATORY_TEST' : 'SPECIALIST_REFERRAL') : null,
      reviewDraftDoctorNote: null,
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

async function scheduledAppointmentForAttendance(urgency: 'ROUTINE' | 'URGENT' = 'ROUTINE') {
  const item = await makeCase('REFERRAL_PENDING');
  await prisma.screeningCase.update({ where: { id: item.id }, data: { state: 'APPOINTMENT_SCHEDULED', urgencyLabel: urgency } });
  const referral = await prisma.referral.create({ data: { caseId: item.id, fromProviderId: originId, toProviderId: receivingId, status: 'ACCEPTED', respondedAt: now } });
  const appointment = await prisma.appointment.create({ data: { referralId: referral.id, scheduledAt: new Date(now.getTime() + 86_400_000), status: 'SCHEDULED' } });
  return { item, appointment };
}

async function approvedExplanations(caseId: string): Promise<[string, string]> {
  const caseRow = await prisma.screeningCase.findUniqueOrThrow({ where: { id: caseId } });
  const fields = { resultCategoryCode: caseRow.reviewDraftResultCategoryCode!, nextStepCode: caseRow.reviewDraftNextStepCode!, urgencyLabel: caseRow.reviewDraftUrgencyLabel!, route: caseRow.reviewRoute as 'REFERRAL' | 'CONFIRMATION' };
  const common = {
    caseId,
    text: 'Approved synthetic patient explanation.',
    source: ExplanationSource.TEMPLATE,
    status: ExplanationStatus.APPROVED,
    approvedBy: users.DOCTOR.id,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
    inputHash: hashExplanationInput(fields),
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
