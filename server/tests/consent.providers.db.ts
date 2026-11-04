import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { PrismaClient, ProviderType, type Role } from '@prisma/client';
import type { Clock } from '../src/core/clock';
import { AUTH_COOKIE_NAME } from '../src/middleware/auth/authMiddleware';
import { createApp } from '../src/app';

const prisma = new PrismaClient();
const now = new Date('2026-11-04T12:00:00.000Z');
const clock: Clock = { now: () => new Date(now), advance: async () => new Date(now), reset: async () => new Date(now) };
const secret = 't206_consent_test_jwt_secret_with_more_than_32_chars';
const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
const users: Record<string, { id: string; role: Role; providerId: string | null }> = {};
let patientId: string;
let otherPatientId: string;
let originProviderId: string;
let receivingProviderId: string;
let alternateProviderId: string;
let targetCaseId: string;
let targetReferralId: string;
let closedCaseId: string;
let acceptedCaseId: string;
let scheduledCaseId: string;
let otherProviderCaseId: string;
let nonReferralCaseId: string;
let higherLevelCaseId: string;
let server: http.Server;
let baseUrl: string;

before(async () => {
  await prisma.$connect();
  const [origin, receiving, alternate] = await Promise.all([
    makeProvider('origin', ProviderType.SCREENING_CENTRE),
    makeProvider('receiving', ProviderType.HOSPITAL),
    makeProvider('alternate', ProviderType.CLINIC),
  ]);
  originProviderId = origin.id; receivingProviderId = receiving.id; alternateProviderId = alternate.id;
  const [patient, otherPatient, doctorOrigin, doctorReceiving, coordinatorOrigin, coordinatorReceiving, coordinatorAlternate, admin] = await Promise.all([
    makeUser('PATIENT', 'patient', null), makeUser('PATIENT', 'other-patient', null),
    makeUser('DOCTOR', 'doctor-origin', originProviderId), makeUser('DOCTOR', 'doctor-receiving', receivingProviderId),
    makeUser('COORDINATOR', 'coordinator-origin', originProviderId), makeUser('COORDINATOR', 'coordinator-receiving', receivingProviderId),
    makeUser('COORDINATOR', 'coordinator-alternate', alternateProviderId), makeUser('ADMIN', 'admin', null),
  ]);
  Object.assign(users, { PATIENT: patient, OTHER_PATIENT: otherPatient, DOCTOR_ORIGIN: doctorOrigin, DOCTOR_RECEIVING: doctorReceiving,
    COORDINATOR_ORIGIN: coordinatorOrigin, COORDINATOR_RECEIVING: coordinatorReceiving, COORDINATOR_ALTERNATE: coordinatorAlternate, ADMIN: admin });
  patientId = (await prisma.patient.create({ data: { userId: patient.id, syntheticMrn: `T206-${suffix}`, dateOfBirth: new Date('1980-01-01T00:00:00Z') } })).id;
  otherPatientId = (await prisma.patient.create({ data: { userId: otherPatient.id, syntheticMrn: `T206-OTHER-${suffix}`, dateOfBirth: new Date('1980-01-01T00:00:00Z') } })).id;

  targetCaseId = await makeCase('REFERRAL_PENDING', doctorOrigin.id);
  acceptedCaseId = await makeCase('REFERRAL_ACCEPTED', doctorOrigin.id);
  scheduledCaseId = await makeCase('APPOINTMENT_SCHEDULED', doctorOrigin.id);
  otherProviderCaseId = await makeCase('REFERRAL_PENDING', doctorOrigin.id);
  nonReferralCaseId = await makeCase('NEW', doctorOrigin.id);
  closedCaseId = await makeCase('CLOSED', doctorOrigin.id);
  higherLevelCaseId = await makeCase('REFERRAL_PENDING', doctorOrigin.id, 'LEVEL_2');
  targetReferralId = await makeReferral(targetCaseId, receivingProviderId, originProviderId, 'PENDING');
  await makeReferral(acceptedCaseId, receivingProviderId, originProviderId, 'ACCEPTED');
  await makeReferral(scheduledCaseId, receivingProviderId, originProviderId, 'ACCEPTED');
  await makeReferral(otherProviderCaseId, alternateProviderId, originProviderId, 'PENDING');
  await makeReferral(higherLevelCaseId, receivingProviderId, originProviderId, 'PENDING');
  await prisma.explanationDraft.createMany({ data: ['EN', 'AR'].map((language) => ({
    caseId: targetCaseId, language: language as 'EN' | 'AR', text: 'Approved synthetic explanation.', source: 'TEMPLATE',
    status: 'APPROVED', approvedBy: doctorOrigin.id, approvedAt: now, createdAt: now, updatedAt: now,
  })) });

  const app = createApp({ prisma, clock, env: { NODE_ENV: 'test', SERVER_PORT: 0, DATABASE_URL: process.env.DATABASE_URL ?? '', JWT_SECRET: secret, CLIENT_ORIGIN: 'http://localhost:3000', DEMO_PASSWORD: 'unused-test-password' } });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

test('consent lifecycle, event/audit writes, escalation targeting, receiving access, providers and staff privacy', async () => {
  const initialGrant = await request('PATIENT', '/patients/me/consents', 'POST', { providerId: receivingProviderId, scope: 'CROSS_PROVIDER_REFERRAL' });
  assert.equal(initialGrant.status, 201);
  const grantBody = await json<{ consent: { id: string; grantedAt: string } }>(initialGrant);
  const consentId = grantBody.consent.id;
  assert.equal(grantBody.consent.grantedAt, now.toISOString());
  assert.equal((await request('PATIENT', '/patients/me/consents', 'POST', { providerId: receivingProviderId, scope: 'CROSS_PROVIDER_REFERRAL' })).status, 409);
  const listed = await request('PATIENT', '/patients/me/consents');
  assert.equal(listed.status, 200);
  assert.equal((await json<{ items: unknown[] }>(listed)).items.length, 1);

  assert.equal((await request('DOCTOR_ORIGIN', '/patients/me/consents')).status, 403);
  assert.equal((await request('ADMIN', '/patients/me/consents', 'POST', { providerId: receivingProviderId, scope: 'CROSS_PROVIDER_REFERRAL' })).status, 403);
  const otherPatientConsent = await prisma.consent.create({ data: { patientId: otherPatientId, providerId: receivingProviderId, scope: 'CROSS_PROVIDER_REFERRAL', grantedAt: now } });
  assert.equal((await request('PATIENT', `/patients/me/consents/${otherPatientConsent.id}/revoke`, 'POST', {})).status, 404);

  assert.equal((await request('DOCTOR_RECEIVING', `/cases/${targetCaseId}`)).status, 200);
  assert.equal((await request('DOCTOR_RECEIVING', `/referrals/${targetReferralId}/packet`)).status, 200);
  const revoked = await request('PATIENT', `/patients/me/consents/${consentId}/revoke`, 'POST', {});
  assert.equal(revoked.status, 200);
  const revokedBody = await json<{ consent: { revokedAt: string } }>(revoked);
  assert.equal(revokedBody.consent.revokedAt, now.toISOString());
  assert.equal((await request('PATIENT', `/patients/me/consents/${consentId}/revoke`, 'POST', {})).status, 409);

  assert.equal((await request('DOCTOR_RECEIVING', `/cases/${targetCaseId}`)).status, 404);
  assert.equal((await request('DOCTOR_RECEIVING', `/referrals/${targetReferralId}/packet`)).status, 404);
  const deniedTransition = await request('COORDINATOR_RECEIVING', `/cases/${targetCaseId}/transitions`, 'POST', {
    transitionKey: 'ACCEPT_REFERRAL', expectedState: 'REFERRAL_PENDING', evidence: { referralId: targetReferralId },
  });
  assert.equal(deniedTransition.status, 404);

  const regrant = await request('PATIENT', '/patients/me/consents', 'POST', { providerId: receivingProviderId, scope: 'CROSS_PROVIDER_REFERRAL' });
  assert.equal(regrant.status, 201);
  assert.equal((await request('DOCTOR_RECEIVING', `/cases/${targetCaseId}`)).status, 200);
  assert.equal((await request('DOCTOR_RECEIVING', `/referrals/${targetReferralId}/packet`)).status, 200);
  const accepted = await request('COORDINATOR_RECEIVING', `/cases/${targetCaseId}/transitions`, 'POST', {
    transitionKey: 'ACCEPT_REFERRAL', expectedState: 'REFERRAL_PENDING', evidence: { referralId: targetReferralId },
  });
  assert.equal(accepted.status, 200);

  const openCaseIds = [targetCaseId, acceptedCaseId, scheduledCaseId, otherProviderCaseId, nonReferralCaseId, higherLevelCaseId];
  assert.equal(await prisma.caseEvent.count({ where: { caseId: closedCaseId, type: 'CONSENT_GRANTED' } }), 0);
  assert.equal(await prisma.caseEvent.count({ where: { caseId: closedCaseId, type: 'CONSENT_REVOKED' } }), 0);
  for (const caseId of openCaseIds) {
    assert.equal(await prisma.caseEvent.count({ where: { caseId, type: 'CONSENT_GRANTED' } }), 2);
    assert.equal(await prisma.caseEvent.count({ where: { caseId, type: 'CONSENT_REVOKED' } }), 1);
  }
  const escalated = await prisma.screeningCase.findMany({ where: { patientId, escalationLevel: 'LEVEL_1' }, select: { id: true } });
  assert.ok(escalated.some((row) => row.id === targetCaseId));
  assert.ok(escalated.some((row) => row.id === acceptedCaseId));
  assert.ok(escalated.some((row) => row.id === scheduledCaseId));
  assert.ok(!escalated.some((row) => row.id === otherProviderCaseId));
  assert.ok(!escalated.some((row) => row.id === nonReferralCaseId));
  assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: higherLevelCaseId } })).escalationLevel, 'LEVEL_2');
  assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: closedCaseId } })).escalationLevel, 'LEVEL_0');
  assert.equal(await prisma.caseEvent.count({ where: { caseId: { in: [targetCaseId, closedCaseId] }, type: 'ESCALATION_RAISED', actorType: 'SYSTEM' } }), 1);
  assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: targetCaseId } })).escalationLevel, 'LEVEL_1');
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'CONSENT_GRANTED', entityId: consentId } }));
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'CONSENT_REVOKED', entityId: consentId } }));

  for (const role of ['PATIENT', 'DOCTOR_ORIGIN', 'DOCTOR_RECEIVING', 'COORDINATOR_ORIGIN', 'COORDINATOR_RECEIVING', 'ADMIN']) {
    const response = await request(role, '/providers');
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes('id') && body.includes('name') && body.includes('type'));
  }
  assert.equal((await request('PATIENT', `/providers/${receivingProviderId}/staff`)).status, 403);
  const staff = await request('ADMIN', `/providers/${receivingProviderId}/staff`);
  assert.equal(staff.status, 200);
  const staffText = await staff.text();
  assert.ok(staffText.includes('id') && staffText.includes('name') && staffText.includes('role'));
  assert.ok(!staffText.includes('email') && !staffText.includes('password'));
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'PROVIDER_STAFF_READ', entityId: receivingProviderId } }));
});

async function request(actor: string | undefined, path: string, method = 'GET', body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (actor && users[actor]) {
    const user = users[actor];
    headers.Cookie = `${AUTH_COOKIE_NAME}=${jwt.sign({ userId: user.id, role: user.role }, secret, { expiresIn: '1h' })}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}/api/v1${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function json<T>(response: Response): Promise<T> { return await response.json() as T; }
async function makeProvider(label: string, type: ProviderType) { return prisma.provider.create({ data: { name: `T206 ${label} ${suffix}`, type } }); }
async function makeUser(role: Role, label: string, providerId: string | null) {
  const user = await prisma.user.create({ data: { email: `t206-${label}-${suffix}@careloop.test`, name: `T206 ${label}`, role, providerId, passwordHash: 'test-only-hash' } });
  return { id: user.id, role, providerId };
}
async function makeCase(state: 'NEW' | 'REFERRAL_PENDING' | 'REFERRAL_ACCEPTED' | 'APPOINTMENT_SCHEDULED' | 'CLOSED', creatorId: string, escalationLevel: 'LEVEL_0' | 'LEVEL_2' = 'LEVEL_0'): Promise<string> {
  const row = await prisma.screeningCase.create({ data: {
    patientId, originProviderId, createdById: creatorId, pathway: 'Synthetic workflow', screeningType: 'Synthetic test', resultCategory: 'Synthetic category',
    intakeUrgency: 'ROUTINE', urgencyLabel: 'ROUTINE', state, escalationLevel, escalatedAt: escalationLevel === 'LEVEL_0' ? null : now,
    ownerQueueRole: state === 'CLOSED' ? null : 'COORDINATOR', ownerQueueProviderId: state === 'CLOSED' ? null : originProviderId,
    closureReason: state === 'CLOSED' ? 'PATIENT_DECLINED' : null, closedAt: state === 'CLOSED' ? now : null,
    dueAt: state === 'CLOSED' ? null : new Date(now.getTime() + 86_400_000), createdAt: now, updatedAt: now,
  } });
  return row.id;
}
async function makeReferral(caseId: string, toProviderId: string, fromProviderId: string, status: 'PENDING' | 'ACCEPTED') {
  return (await prisma.referral.create({ data: { caseId, toProviderId, fromProviderId, status, respondedAt: status === 'PENDING' ? null : now, reason: 'Synthetic test referral.', createdAt: now, updatedAt: now } })).id;
}
