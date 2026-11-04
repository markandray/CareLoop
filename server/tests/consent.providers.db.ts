import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { PrismaClient, ProviderType, type Role } from '@prisma/client';
import type { ConsentDto } from '@careloop/shared';
import type { Clock } from '../src/core/clock';
import { AUTH_COOKIE_NAME } from '../src/middleware/auth/authMiddleware';
import { createApp } from '../src/app';

const prisma = new PrismaClient();
const now = new Date('2026-11-04T12:00:00.000Z');
const clock: Clock = { now: () => new Date(now), advance: async () => new Date(now), reset: async () => new Date(now) };
const secret = 't206_consent_test_jwt_secret_with_more_than_32_chars';
const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
type TestUser = { id: string; role: Role; providerId: string | null };
const users: Record<string, TestUser> = {};
let originProviderId: string;
let receivingProviderId: string;
let alternateProviderId: string;
let server: http.Server;
let baseUrl: string;

before(async () => {
  await prisma.$connect();
  const [origin, receiving, alternate] = await Promise.all([
    makeProvider('origin', ProviderType.SCREENING_CENTRE),
    makeProvider('receiving', ProviderType.HOSPITAL),
    makeProvider('alternate', ProviderType.CLINIC),
  ]);
  originProviderId = origin.id;
  receivingProviderId = receiving.id;
  alternateProviderId = alternate.id;
  const staff = await Promise.all([
    makeUser('DOCTOR', 'doctor-origin', originProviderId),
    makeUser('DOCTOR', 'doctor-receiving', receivingProviderId),
    makeUser('COORDINATOR', 'coordinator-origin', originProviderId),
    makeUser('COORDINATOR', 'coordinator-receiving', receivingProviderId),
    makeUser('COORDINATOR', 'coordinator-alternate', alternateProviderId),
    makeUser('ADMIN', 'admin', null),
  ]);
  Object.assign(users, {
    DOCTOR_ORIGIN: staff[0],
    DOCTOR_RECEIVING: staff[1],
    COORDINATOR_ORIGIN: staff[2],
    COORDINATOR_RECEIVING: staff[3],
    COORDINATOR_ALTERNATE: staff[4],
    ADMIN: staff[5],
  });

  const app = createApp({
    prisma,
    clock,
    env: {
      NODE_ENV: 'test', SERVER_PORT: 0, DATABASE_URL: process.env.DATABASE_URL ?? '',
      JWT_SECRET: secret, CLIENT_ORIGIN: 'http://localhost:3000', DEMO_PASSWORD: 'unused-test-password',
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

test('patient grants consent, and listing returns it', async () => {
  const patient = await makePatient('grant-list');
  const response = await grant(patient, receivingProviderId);
  assert.equal(response.status, 201);
  const { consent } = await json<{ consent: ConsentDto }>(response);
  assert.equal(consent.providerId, receivingProviderId);
  assert.equal(consent.scope, 'CROSS_PROVIDER_REFERRAL');
  assert.equal(consent.grantedAt, now.toISOString());
  assert.equal(consent.revokedAt, null);

  const listed = await request(patient, '/patients/me/consents');
  assert.equal(listed.status, 200);
  const body = await json<{ items: ConsentDto[]; nextCursor: string | null; updatedAt: string }>(listed);
  assert.equal(body.items.length, 1);
  assert.deepEqual(body.items[0], consent);
  assert.equal(body.nextCursor, null);
  assert.equal(body.updatedAt, now.toISOString());
});

test('patient revokes consent and revokedAt is set', async () => {
  const patient = await makePatient('revoke');
  const consent = await grantConsent(patient, receivingProviderId);
  const response = await request(patient, `/patients/me/consents/${consent.id}/revoke`, 'POST', {});
  assert.equal(response.status, 200);
  const body = await json<{ consent: ConsentDto }>(response);
  assert.equal(body.consent.id, consent.id);
  assert.equal(body.consent.revokedAt, now.toISOString());
  assert.equal((await prisma.consent.findUniqueOrThrow({ where: { id: consent.id } })).revokedAt?.toISOString(), now.toISOString());
});

test('double revoke returns 409', async () => {
  const patient = await makePatient('double-revoke');
  const consent = await grantConsent(patient, receivingProviderId);
  assert.equal((await request(patient, `/patients/me/consents/${consent.id}/revoke`, 'POST', {})).status, 200);
  const repeated = await request(patient, `/patients/me/consents/${consent.id}/revoke`, 'POST', {});
  assert.equal(repeated.status, 409);
  assert.equal((await errorCode(repeated)), 'CONFLICT');
});

test('duplicate active grant for the same provider and scope returns 409', async () => {
  const patient = await makePatient('duplicate-grant');
  assert.equal((await grant(patient, receivingProviderId)).status, 201);
  const duplicate = await grant(patient, receivingProviderId);
  assert.equal(duplicate.status, 409);
  assert.equal(await errorCode(duplicate), 'CONFLICT');
});

test("another patient's consent id returns 404", async () => {
  const patient = await makePatient('consent-owner');
  const anotherPatient = await makePatient('consent-other-owner');
  const otherConsent = await grantConsent(anotherPatient, receivingProviderId);
  const response = await request(patient, `/patients/me/consents/${otherConsent.id}/revoke`, 'POST', {});
  assert.equal(response.status, 404);
  assert.equal(await errorCode(response), 'NOT_FOUND');
});

test('doctor, coordinator and admin get 403 on the consent endpoints', async () => {
  const patient = await makePatient('roles');
  const ownConsent = await grantConsent(patient, receivingProviderId);
  for (const role of ['DOCTOR_ORIGIN', 'COORDINATOR_ORIGIN', 'ADMIN']) {
    for (const [path, method, body] of [
      ['/patients/me/consents', 'GET', undefined],
      ['/patients/me/consents', 'POST', { providerId: receivingProviderId, scope: 'CROSS_PROVIDER_REFERRAL' }],
      [`/patients/me/consents/${ownConsent.id}/revoke`, 'POST', {}],
    ] as const) {
      const response = await request(role, path, method, body);
      assert.equal(response.status, 403, `${role} ${method} ${path} should be denied`);
      assert.equal(await errorCode(response), 'FORBIDDEN');
    }
  }
});

test('consent events appear on open cases and not CLOSED ones, and an audit row is written', async () => {
  const patient = await makePatient('events');
  const openCaseId = await makeCase(patient.patientId, 'REFERRAL_PENDING', users.DOCTOR_ORIGIN.id);
  const closedCaseId = await makeCase(patient.patientId, 'CLOSED', users.DOCTOR_ORIGIN.id);
  const consent = await grantConsent(patient, receivingProviderId);
  const revokeResponse = await request(patient, `/patients/me/consents/${consent.id}/revoke`, 'POST', {});
  assert.equal(revokeResponse.status, 200);

  assert.equal(await prisma.caseEvent.count({ where: { caseId: openCaseId, type: 'CONSENT_GRANTED' } }), 1);
  assert.equal(await prisma.caseEvent.count({ where: { caseId: openCaseId, type: 'CONSENT_REVOKED' } }), 1);
  assert.equal(await prisma.caseEvent.count({ where: { caseId: closedCaseId, type: 'CONSENT_GRANTED' } }), 0);
  assert.equal(await prisma.caseEvent.count({ where: { caseId: closedCaseId, type: 'CONSENT_REVOKED' } }), 0);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'CONSENT_GRANTED', entityId: consent.id } }));
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'CONSENT_REVOKED', entityId: consent.id } }));
});

test('revoke raises LEVEL_1 only for active referrals to that provider, and never lowers a higher level', async () => {
  const patient = await makePatient('escalation');
  const pending = await makeCase(patient.patientId, 'REFERRAL_PENDING', users.DOCTOR_ORIGIN.id);
  const accepted = await makeCase(patient.patientId, 'REFERRAL_ACCEPTED', users.DOCTOR_ORIGIN.id);
  const scheduled = await makeCase(patient.patientId, 'APPOINTMENT_SCHEDULED', users.DOCTOR_ORIGIN.id);
  const otherProvider = await makeCase(patient.patientId, 'REFERRAL_PENDING', users.DOCTOR_ORIGIN.id);
  const noReferral = await makeCase(patient.patientId, 'NEW', users.DOCTOR_ORIGIN.id);
  const closed = await makeCase(patient.patientId, 'CLOSED', users.DOCTOR_ORIGIN.id);
  const higherLevel = await makeCase(patient.patientId, 'REFERRAL_PENDING', users.DOCTOR_ORIGIN.id, 'LEVEL_2');
  await makeReferral(pending, receivingProviderId, originProviderId, 'PENDING');
  await makeReferral(accepted, receivingProviderId, originProviderId, 'ACCEPTED');
  await makeReferral(scheduled, receivingProviderId, originProviderId, 'ACCEPTED');
  await makeReferral(otherProvider, alternateProviderId, originProviderId, 'PENDING');
  await makeReferral(closed, receivingProviderId, originProviderId, 'PENDING');
  await makeReferral(higherLevel, receivingProviderId, originProviderId, 'PENDING');
  const consent = await grantConsent(patient, receivingProviderId);
  const revoked = await request(patient, `/patients/me/consents/${consent.id}/revoke`, 'POST', {});
  assert.equal(revoked.status, 200);

  for (const id of [pending, accepted, scheduled]) {
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id } })).escalationLevel, 'LEVEL_1');
    assert.equal(await prisma.caseEvent.count({ where: { caseId: id, type: 'ESCALATION_RAISED', actorType: 'SYSTEM' } }), 1);
  }
  for (const id of [otherProvider, noReferral, closed]) {
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id } })).escalationLevel, 'LEVEL_0');
    assert.equal(await prisma.caseEvent.count({ where: { caseId: id, type: 'ESCALATION_RAISED' } }), 0);
  }
  assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: higherLevel } })).escalationLevel, 'LEVEL_2');
  assert.equal(await prisma.caseEvent.count({ where: { caseId: higherLevel, type: 'ESCALATION_RAISED' } }), 0);
});

test('receiving-provider case read, referral packet and transition are denied after revoke and allowed after a new grant', async () => {
  const patient = await makePatient('access');
  const caseId = await makeCase(patient.patientId, 'REFERRAL_PENDING', users.DOCTOR_ORIGIN.id);
  const referralId = await makeReferral(caseId, receivingProviderId, originProviderId, 'PENDING');
  await addApprovedExplanations(caseId);
  const consent = await grantConsent(patient, receivingProviderId);

  assert.equal((await request('DOCTOR_RECEIVING', `/cases/${caseId}`)).status, 200);
  assert.equal((await request('DOCTOR_RECEIVING', `/referrals/${referralId}/packet`)).status, 200);
  const revokeResponse = await request(patient, `/patients/me/consents/${consent.id}/revoke`, 'POST', {});
  assert.equal(revokeResponse.status, 200);
  assert.equal((await request('DOCTOR_RECEIVING', `/cases/${caseId}`)).status, 404);
  assert.equal((await request('DOCTOR_RECEIVING', `/referrals/${referralId}/packet`)).status, 404);
  const denied = await request('COORDINATOR_RECEIVING', `/cases/${caseId}/transitions`, 'POST', acceptReferral(referralId));
  assert.equal(denied.status, 404);

  const regrant = await grant(patient, receivingProviderId);
  assert.equal(regrant.status, 201);
  assert.equal((await request('DOCTOR_RECEIVING', `/cases/${caseId}`)).status, 200);
  assert.equal((await request('DOCTOR_RECEIVING', `/referrals/${referralId}/packet`)).status, 200);
  const restored = await request('COORDINATOR_RECEIVING', `/cases/${caseId}/transitions`, 'POST', acceptReferral(referralId));
  assert.equal(restored.status, 200);
  assert.ok(await prisma.consent.findUnique({ where: { id: consent.id } }));
});

test('GET /providers returns the directory with the cursor contract', async () => {
  const patient = await makePatient('provider-directory');
  for (const role of [patient, 'DOCTOR_ORIGIN', 'DOCTOR_RECEIVING', 'COORDINATOR_ORIGIN', 'COORDINATOR_RECEIVING', 'ADMIN'] as const) {
    const response = await request(role, '/providers?limit=1');
    assert.equal(response.status, 200);
    const page = await json<{ items: Array<Record<string, unknown>>; nextCursor: string | null; updatedAt: string }>(response);
    assert.equal(page.items.length, 1);
    assert.deepEqual(Object.keys(page.items[0]!).sort(), ['id', 'name', 'type']);
    assert.equal(typeof page.updatedAt, 'string');
    assert.equal(typeof page.nextCursor, 'string');
    const next = await request(role, `/providers?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`);
    assert.equal(next.status, 200);
    const nextPage = await json<{ items: Array<{ id: string }> }>(next);
    assert.notEqual(nextPage.items[0]?.id, page.items[0]?.id);
  }
});

test('GET /providers/:id/staff returns no email or password fields', async () => {
  const patient = await makePatient('staff-directory');
  assert.equal((await request(patient, `/providers/${receivingProviderId}/staff`)).status, 403);
  const response = await request('ADMIN', `/providers/${receivingProviderId}/staff?limit=1`);
  assert.equal(response.status, 200);
  const page = await json<{ items: Array<Record<string, unknown>>; nextCursor: string | null; updatedAt: string }>(response);
  assert.equal(page.items.length, 1);
  assert.deepEqual(Object.keys(page.items[0]!).sort(), ['id', 'name', 'role']);
  assert.equal(typeof page.updatedAt, 'string');
  assert.equal(typeof page.nextCursor, 'string');
  const text = JSON.stringify(page);
  assert.ok(!text.includes('email') && !text.includes('password'));
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'PROVIDER_STAFF_READ', entityId: receivingProviderId } }));
});

async function request(actor: string | TestUser, path: string, method = 'GET', body?: unknown): Promise<Response> {
  const user = typeof actor === 'string' ? users[actor] : actor;
  const headers: Record<string, string> = {};
  if (user) headers.Cookie = `${AUTH_COOKIE_NAME}=${jwt.sign({ userId: user.id, role: user.role }, secret, { expiresIn: '1h' })}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}/api/v1${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function grant(patient: Awaited<ReturnType<typeof makePatient>>, providerId: string): Promise<Response> {
  return request(patient, '/patients/me/consents', 'POST', { providerId, scope: 'CROSS_PROVIDER_REFERRAL' });
}

async function grantConsent(patient: Awaited<ReturnType<typeof makePatient>>, providerId: string): Promise<ConsentDto> {
  const response = await grant(patient, providerId);
  assert.equal(response.status, 201);
  return (await json<{ consent: ConsentDto }>(response)).consent;
}

async function makePatient(label: string): Promise<TestUser & { patientId: string }> {
  const user = await makeUser('PATIENT', `${label}-${randomUUID().slice(0, 6)}`, null);
  const patient = await prisma.patient.create({ data: {
    userId: user.id, syntheticMrn: `T206-${label}-${randomUUID().slice(0, 8)}`,
    dateOfBirth: new Date('1980-01-01T00:00:00Z'),
  } });
  return { ...user, patientId: patient.id };
}

async function makeProvider(label: string, type: ProviderType) {
  return prisma.provider.create({ data: { name: `T206 ${label} ${suffix}`, type } });
}

async function makeUser(role: Role, label: string, providerId: string | null): Promise<TestUser> {
  const user = await prisma.user.create({ data: {
    email: `t206-${label}-${suffix}@careloop.test`, name: `T206 ${label}`, role, providerId, passwordHash: 'test-only-hash',
  } });
  return { id: user.id, role, providerId };
}

async function makeCase(
  patientId: string,
  state: 'NEW' | 'REFERRAL_PENDING' | 'REFERRAL_ACCEPTED' | 'APPOINTMENT_SCHEDULED' | 'CLOSED',
  creatorId: string,
  escalationLevel: 'LEVEL_0' | 'LEVEL_2' = 'LEVEL_0',
): Promise<string> {
  const row = await prisma.screeningCase.create({ data: {
    patientId, originProviderId, createdById: creatorId, pathway: 'Synthetic workflow', screeningType: 'Synthetic test',
    resultCategory: 'Synthetic category', intakeUrgency: 'ROUTINE', urgencyLabel: 'ROUTINE', state, escalationLevel,
    escalatedAt: escalationLevel === 'LEVEL_0' ? null : now,
    ownerQueueRole: state === 'CLOSED' ? null : 'COORDINATOR',
    ownerQueueProviderId: state === 'CLOSED' ? null : originProviderId,
    closureReason: state === 'CLOSED' ? 'PATIENT_DECLINED' : null,
    closedAt: state === 'CLOSED' ? now : null,
    dueAt: state === 'CLOSED' ? null : new Date(now.getTime() + 86_400_000), createdAt: now, updatedAt: now,
  } });
  return row.id;
}

async function makeReferral(caseId: string, toProviderId: string, fromProviderId: string, status: 'PENDING' | 'ACCEPTED'): Promise<string> {
  const referral = await prisma.referral.create({ data: {
    caseId, toProviderId, fromProviderId, status, respondedAt: status === 'PENDING' ? null : now,
    reason: 'Synthetic test referral.', createdAt: now, updatedAt: now,
  } });
  return referral.id;
}

async function addApprovedExplanations(caseId: string): Promise<void> {
  await prisma.explanationDraft.createMany({ data: ['EN', 'AR'].map((language) => ({
    caseId, language: language as 'EN' | 'AR', text: 'Approved synthetic explanation.', source: 'TEMPLATE',
    status: 'APPROVED', approvedBy: users.DOCTOR_ORIGIN!.id, approvedAt: now, createdAt: now, updatedAt: now,
  })) });
}

function acceptReferral(referralId: string) {
  return { transitionKey: 'ACCEPT_REFERRAL', expectedState: 'REFERRAL_PENDING', evidence: { referralId } };
}

async function json<T>(response: Response): Promise<T> { return await response.json() as T; }
async function errorCode(response: Response): Promise<string> {
  return (await json<{ error: { code: string } }>(response)).error.code;
}
