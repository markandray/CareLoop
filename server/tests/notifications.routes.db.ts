import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { ActorType, CaseEventType, CaseState, PrismaClient, type Role } from '@prisma/client';
import { createApp } from '../src/app';
import type { Clock } from '../src/core/clock';
import { queueNotification } from '../src/modules/notifications/notificationService';

const prisma = new PrismaClient();
const now = new Date('2026-11-04T15:00:00.000Z');
const clock: Clock = { now: () => new Date(now), advance: async () => new Date(now), reset: async () => new Date(now) };
const secret = 't203_notification_route_tests_secret_at_least_32_chars';
const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
let originId: string;
let otherProviderId: string;
let patientOne: string;
let patientTwo: string;
let doctor: string;
let otherDoctor: string;
let coordinator: string;
let otherCoordinator: string;
let admin: string;
let server: http.Server;
let baseUrl: string;

before(async () => {
  await prisma.$connect();
  const [origin, other] = await Promise.all([provider('origin'), provider('other')]);
  originId = origin.id;
  otherProviderId = other.id;
  const [patientA, patientB, doctorUser, otherDoctorUser, coordinatorUser, otherCoordinatorUser, adminUser] = await Promise.all([
    user('PATIENT', 'patient-a'), user('PATIENT', 'patient-b'),
    user('DOCTOR', 'doctor', originId), user('DOCTOR', 'other-doctor', otherProviderId), user('COORDINATOR', 'coordinator', originId),
    user('COORDINATOR', 'other-coordinator', otherProviderId), user('ADMIN', 'admin'),
  ]);
  patientOne = await patient(patientA);
  patientTwo = await patient(patientB);
  patientIds.set(patientOne, patientA.id);
  patientIds.set(patientTwo, patientB.id);
  doctor = doctorUser.id;
  otherDoctor = otherDoctorUser.id;
  coordinator = coordinatorUser.id;
  otherCoordinator = otherCoordinatorUser.id;
  admin = adminUser.id;
  const app = createApp({ prisma, clock, env: {
    NODE_ENV: 'test', SERVER_PORT: 0, DATABASE_URL: process.env.DATABASE_URL ?? '',
    JWT_SECRET: secret, CLIENT_ORIGIN: 'http://localhost:3000', DEMO_PASSWORD: 'unused-test-password',
  } });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

test('notification DTOs omit clinical review claims and use language review notices', async () => {
  const item = await makeCase(patientOne, originId);
  const english = await makeNotification(item.id, patientUserId(patientOne), 'consent_needed', 'SENT', 'EN');
  const arabic = await makeNotification(item.id, patientUserId(patientOne), 'consent_needed', 'SENT', 'AR');
  const other = await makeNotification(item.id, patientUserId(patientOne), 'consent_needed', 'SENT', 'OTHER');
  const items = await allNotifications('PATIENT');
  const englishDto = items.find((entry) => entry.id === english.id);
  const arabicDto = items.find((entry) => entry.id === arabic.id);
  const otherDto = items.find((entry) => entry.id === other.id);
  assert.ok(englishDto);
  assert.ok(arabicDto);
  assert.ok(otherDto);
  for (const dto of [englishDto, arabicDto, otherDto]) {
    assert.equal(Object.hasOwn(dto, 'clinicallyReviewed'), false);
  }
  assert.match(englishDto.text, /request/);
  assert.equal(englishDto.reviewNotice, 'NONE');
  assert.equal(arabicDto.reviewNotice, 'UNREVIEWED_TRANSLATION');
  assert.equal(otherDto.reviewNotice, 'NONE');
});

test('Arabic notification DTO carries the unreviewed translation notice', async () => {
  const item = await makeCase(patientTwo, originId);
  const notification = await makeNotification(item.id, patientUserId(patientTwo), 'consent_needed', 'SENT', 'AR');
  const items = await allNotifications('PATIENT', patientUserId(patientTwo));
  const listed = items.find((entry) => entry.id === notification.id);
  assert.ok(listed);
  assert.equal(listed.language, 'AR');
  assert.match(listed.text, /يرجى/);
  assert.equal(listed.reviewNotice, 'UNREVIEWED_TRANSLATION');
});

test('coordinator notification list is limited to cases at their provider', async () => {
  const ownCase = await makeCase(patientOne, originId);
  const otherCase = await makeCase(patientTwo, otherProviderId);
  const own = await makeNotification(ownCase.id, patientUserId(patientOne), 'care_started', 'SENT');
  const foreign = await makeNotification(otherCase.id, patientUserId(patientTwo), 'care_started', 'SENT');
  const items = await allNotifications('COORDINATOR');
  assert.ok(items.some((entry) => entry.id === own.id));
  assert.ok(!items.some((entry) => entry.id === foreign.id));
});

test('admin can list notifications across providers', async () => {
  const ownCase = await makeCase(patientOne, originId);
  const otherCase = await makeCase(patientTwo, otherProviderId);
  const own = await makeNotification(ownCase.id, patientUserId(patientOne), 'care_started', 'SENT');
  const foreign = await makeNotification(otherCase.id, patientUserId(patientTwo), 'care_started', 'SENT');
  const items = await allNotifications('ADMIN');
  assert.ok(items.some((entry) => entry.id === own.id));
  assert.ok(items.some((entry) => entry.id === foreign.id));
});

test('origin coordinator dispatches result_reviewed and writes sent event, timestamp, and audit', async () => {
  const item = await makeCase(patientOne, originId);
  await approvedExplanation(item.id);
  const notification = await makeNotification(item.id, patientUserId(patientOne), 'result_reviewed', 'QUEUED');
  const response = await request('COORDINATOR', 'POST', `/notifications/${notification.id}/dispatch`, {});
  assert.equal(response.status, 200);
  const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
  const updatedCase = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(stored.status, 'SENT');
  assert.equal(stored.sentAt?.toISOString(), now.toISOString());
  assert.equal(updatedCase.notifiedAt?.toISOString(), now.toISOString());
  assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: CaseEventType.NOTIFICATION_SENT, payload: { path: ['templateKey'], equals: 'result_reviewed' } } }));
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'NOTIFICATION_DISPATCHED', entityId: notification.id } }));
});

test('dispatch requires an approved explanation and returns 422 EVIDENCE_MISSING', async () => {
  const item = await makeCase(patientOne, originId);
  const notification = await makeNotification(item.id, patientUserId(patientOne), 'result_reviewed', 'QUEUED');
  const response = await request('COORDINATOR', 'POST', `/notifications/${notification.id}/dispatch`, {});
  assert.equal(response.status, 422);
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'EVIDENCE_MISSING');
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).status, 'QUEUED');
});

test('dispatching a notification twice returns 409 CONFLICT', async () => {
  const item = await makeCase(patientOne, originId);
  await approvedExplanation(item.id);
  const notification = await makeNotification(item.id, patientUserId(patientOne), 'result_reviewed', 'QUEUED');
  assert.equal((await request('COORDINATOR', 'POST', `/notifications/${notification.id}/dispatch`, {})).status, 200);
  const repeated = await request('COORDINATOR', 'POST', `/notifications/${notification.id}/dispatch`, {});
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json() as { error: { code: string } }).error.code, 'CONFLICT');
});

test('only the case origin coordinator may dispatch its result_reviewed notification', async () => {
  const item = await makeCase(patientOne, originId);
  await approvedExplanation(item.id);
  const notification = await makeNotification(item.id, patientUserId(patientOne), 'result_reviewed', 'QUEUED');
  const response = await request('OTHER_COORDINATOR', 'POST', `/notifications/${notification.id}/dispatch`, {});
  assert.equal(response.status, 404);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).status, 'QUEUED');
});

test('patient role receives 403 when dispatching a notification', async () => {
  const item = await makeCase(patientOne, originId);
  const notification = await makeNotification(item.id, patientUserId(patientOne), 'result_reviewed', 'QUEUED');
  const response = await request('PATIENT', 'POST', `/notifications/${notification.id}/dispatch`, {});
  assert.equal(response.status, 403);
});

test('acknowledging result_reviewed sets acknowledgedAt and preserves workflow state', async () => {
  const item = await makeCase(patientOne, originId, 'CLINICIAN_REVIEWED');
  const notification = await makeNotification(item.id, patientUserId(patientOne), 'result_reviewed', 'SENT');
  const response = await request('PATIENT', 'POST', `/notifications/${notification.id}/acknowledge`, {});
  assert.equal(response.status, 200);
  const responseBody = await response.json() as { event: { id: string; labelKey: string; timestamp: string; patientStatus: string; type?: string } };
  assert.equal(responseBody.event.labelKey, 'UPDATE_VIEWED');
  assert.equal(responseBody.event.timestamp, now.toISOString());
  assert.equal('type' in responseBody.event, false);
  const after = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(after.acknowledgedAt?.toISOString(), now.toISOString());
  assert.equal(after.state, 'CLINICIAN_REVIEWED');
  assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: CaseEventType.NOTIFICATION_ACKNOWLEDGED } }));
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'NOTIFICATION_ACKNOWLEDGED', entityId: notification.id } }));
});

test('acknowledging consent_needed writes its event and audit but leaves acknowledgedAt null', async () => {
  const item = await makeCase(patientOne, originId);
  const notification = await makeNotification(item.id, patientUserId(patientOne), 'consent_needed', 'SENT');
  const response = await request('PATIENT', 'POST', `/notifications/${notification.id}/acknowledge`, {});
  assert.equal(response.status, 200);
  const after = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(after.acknowledgedAt, null);
  const notificationRow = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
  assert.equal(notificationRow.acknowledgedAt?.toISOString(), now.toISOString());
  assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: CaseEventType.NOTIFICATION_ACKNOWLEDGED, payload: { path: ['notificationId'], equals: notification.id } } }));
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'NOTIFICATION_ACKNOWLEDGED', entityId: notification.id } }));
});

test('acknowledging one notification timestamps only that notification', async () => {
  const item = await makeCase(patientOne, originId);
  const first = await makeNotification(item.id, patientUserId(patientOne), 'consent_needed', 'SENT');
  const second = await makeNotification(item.id, patientUserId(patientOne), 'care_started', 'SENT');
  const response = await request('PATIENT', 'POST', `/notifications/${first.id}/acknowledge`, {});
  assert.equal(response.status, 200);
  const firstRow = await prisma.notification.findUniqueOrThrow({ where: { id: first.id } });
  const secondRow = await prisma.notification.findUniqueOrThrow({ where: { id: second.id } });
  assert.equal(firstRow.acknowledgedAt?.toISOString(), now.toISOString());
  assert.equal(secondRow.acknowledgedAt, null);
  assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).acknowledgedAt, null);
});

test('later automatic notification acknowledgement is audited without changing the initial timestamp', async () => {
  const item = await makeCase(patientOne, originId);
  const first = await makeNotification(item.id, patientUserId(patientOne), 'result_reviewed', 'SENT');
  assert.equal((await request('PATIENT', 'POST', `/notifications/${first.id}/acknowledge`, {})).status, 200);
  const acknowledgedAt = (await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).acknowledgedAt;
  assert.equal(acknowledgedAt?.toISOString(), now.toISOString());

  const later = await makeNotification(item.id, patientUserId(patientOne), 'consent_needed', 'SENT');
  assert.equal((await request('PATIENT', 'POST', `/notifications/${later.id}/acknowledge`, {})).status, 200);
  const after = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(after.acknowledgedAt?.toISOString(), acknowledgedAt?.toISOString());
  assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: CaseEventType.NOTIFICATION_ACKNOWLEDGED, payload: { path: ['notificationId'], equals: later.id } } }));
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'NOTIFICATION_ACKNOWLEDGED', entityId: later.id } }));
});

test('dispatch sets notifiedAt once and a later automatic notification preserves it', async () => {
  const item = await makeCase(patientOne, originId);
  await approvedExplanation(item.id);
  const initial = await makeNotification(item.id, patientUserId(patientOne), 'result_reviewed', 'QUEUED');
  const dispatched = await request('COORDINATOR', 'POST', `/notifications/${initial.id}/dispatch`, {});
  assert.equal(dispatched.status, 200);
  const firstNotifiedAt = (await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).notifiedAt;
  assert.equal(firstNotifiedAt?.toISOString(), now.toISOString());

  const automatic = await prisma.$transaction((tx) => queueNotification(tx, clock, {
    caseId: item.id,
    templateKey: 'consent_needed',
    actor: { actorType: ActorType.USER, actorId: coordinator },
  }));
  assert.equal(automatic.status, 'SENT');
  assert.equal(automatic.sentAt?.toISOString(), now.toISOString());
  const afterAutomatic = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(afterAutomatic.notifiedAt?.toISOString(), firstNotifiedAt?.toISOString());
});

test('doctor role receives 403 when acknowledging a notification', async () => {
  const item = await makeCase(patientOne, originId);
  const notification = await makeNotification(item.id, patientUserId(patientOne), 'care_started', 'SENT');
  const response = await request('DOCTOR', 'POST', `/notifications/${notification.id}/acknowledge`, {});
  assert.equal(response.status, 403);
});

test('repeated patient acknowledgement returns 409 CONFLICT', async () => {
  const item = await makeCase(patientOne, originId);
  const notification = await makeNotification(item.id, patientUserId(patientOne), 'care_started', 'SENT');
  assert.equal((await request('PATIENT', 'POST', `/notifications/${notification.id}/acknowledge`, {})).status, 200);
  const repeated = await request('PATIENT', 'POST', `/notifications/${notification.id}/acknowledge`, {});
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json() as { error: { code: string } }).error.code, 'CONFLICT');
});

test('patient cannot see another patient notification in their notification list', async () => {
  const item = await makeCase(patientTwo, originId);
  const notification = await makeNotification(item.id, patientUserId(patientTwo), 'care_started', 'SENT');
  const items = await allNotifications('PATIENT');
  assert.ok(!items.some((entry) => entry.id === notification.id));
});

test('patient cannot read another patient notification and receives 404', async () => {
  const item = await makeCase(patientTwo, originId);
  const notification = await makeNotification(item.id, patientUserId(patientTwo), 'care_started', 'SENT');
  const response = await request('PATIENT', 'GET', `/notifications/${notification.id}`);
  assert.equal(response.status, 404);
});

test('patient cannot acknowledge another patient notification and receives 404', async () => {
  const item = await makeCase(patientTwo, originId);
  const notification = await makeNotification(item.id, patientUserId(patientTwo), 'care_started', 'SENT');
  const response = await request('PATIENT', 'POST', `/notifications/${notification.id}/acknowledge`, {});
  assert.equal(response.status, 404);
});

test('approved understanding confirmation does not change workflow state', async () => {
  const item = await makeCase(patientOne, originId, 'REFERRAL_PENDING');
  const explanationId = await approvedExplanation(item.id);
  const response = await request('PATIENT', 'POST', `/cases/${item.id}/understanding`, { explanationId });
  assert.equal(response.status, 200);
  const updated = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(updated.understandingConfirmedAt?.toISOString(), now.toISOString());
  assert.equal(updated.state, 'REFERRAL_PENDING');
  assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: CaseEventType.UNDERSTANDING_CONFIRMED } }));
});

test('understanding rejects an explanation belonging to a different case', async () => {
  const item = await makeCase(patientOne, originId);
  const otherCase = await makeCase(patientOne, originId);
  const explanationId = await approvedExplanation(otherCase.id);
  const response = await request('PATIENT', 'POST', `/cases/${item.id}/understanding`, { explanationId });
  assert.equal(response.status, 400);
  assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).understandingConfirmedAt, null);
});

test('consent request automatically sends consent_needed and records its event', async () => {
  const item = await makeCase(patientOne, originId);
  const response = await request('COORDINATOR', 'POST', `/cases/${item.id}/consent-requests`, { providerId: otherProviderId });
  assert.equal(response.status, 201);
  const body = await response.json() as { id: string; status: string; templateKey: string };
  assert.equal(body.status, 'SENT');
  assert.equal(body.templateKey, 'consent_needed');
  assert.ok(await prisma.caseEvent.findFirst({ where: { caseId: item.id, type: CaseEventType.NOTIFICATION_SENT, payload: { path: ['templateKey'], equals: 'consent_needed' } } }));
});

test('consent request from another provider cannot target an origin case', async () => {
  const item = await makeCase(patientOne, originId);
  const response = await request('OTHER_COORDINATOR', 'POST', `/cases/${item.id}/consent-requests`, { providerId: otherProviderId });
  assert.equal(response.status, 404);
});

function request(role: string, method: string, path: string, body?: unknown): Promise<globalThis.Response> {
  const id = ({ PATIENT: patientUserId(patientOne), DOCTOR: doctor, COORDINATOR: coordinator, OTHER_COORDINATOR: otherCoordinator, ADMIN: admin } as Record<string, string>)[role];
  return requestFor(id, role, method, path, body);
}

function requestFor(id: string, role: string, method: string, path: string, body?: unknown): Promise<globalThis.Response> {
  const token = jwt.sign({ userId: id, role }, secret);
  return fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: `careloop_session=${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

type NotificationTestDto = { id: string; text: string; language: string; reviewNotice: 'NONE' | 'UNREVIEWED_TRANSLATION'; [key: string]: unknown };

async function allNotifications(role: string, userId?: string): Promise<NotificationTestDto[]> {
  const all: NotificationTestDto[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
    const response = userId
      ? await requestFor(userId, 'PATIENT', 'GET', `/notifications?${query}`)
      : await request(role, 'GET', `/notifications?${query}`);
    assert.equal(response.status, 200);
    const page = await response.json() as { items: typeof all; nextCursor: string | null };
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

async function provider(label: string) {
  return prisma.provider.create({ data: { name: `T203 ${label} ${suffix}`, type: label === 'origin' ? 'SCREENING_CENTRE' : 'CLINIC' } });
}

async function user(role: Role, label: string, providerId: string | null = null) {
  return prisma.user.create({ data: { email: `t203-${label}-${suffix}@example.test`, name: `T203 ${label}`, passwordHash: 'test-only-hash', role, providerId } });
}

async function patient(userRecord: { id: string }) {
  return (await prisma.patient.create({ data: { userId: userRecord.id, syntheticMrn: `T203-${suffix}-${randomUUID().slice(0, 6)}`, dateOfBirth: new Date('1980-01-01T00:00:00.000Z'), preferredLanguage: 'EN' } })).id;
}

function patientUserId(_patientId: string): string {
  // IDs are resolved from the patient profile in fixtures below via the cached users map.
  return patientIds.get(_patientId) ?? '';
}

const patientIds = new Map<string, string>();

async function makeCase(patientId: string, providerId: string, state: CaseState = CaseState.NEW) {
  const ownerUserId = providerId === originId ? doctor : otherDoctor;
  return prisma.screeningCase.create({ data: {
    patientId, originProviderId: providerId, createdById: ownerUserId,
    pathway: 'T203 test pathway', screeningType: 'T203 test type', resultCategory: 'T203 test category',
    intakeUrgency: 'ROUTINE', state, ownerUserId, dueAt: now, createdAt: now, updatedAt: now,
  } });
}

async function makeNotification(caseId: string, userId: string, templateKey: 'result_reviewed' | 'consent_needed' | 'care_started' | 'referral_started', status: 'QUEUED' | 'SENT', language: 'EN' | 'AR' = 'EN') {
  return prisma.notification.create({ data: { caseId, userId, templateKey, status, language, channel: 'PORTAL', createdAt: now, sentAt: status === 'SENT' ? now : null } });
}

async function approvedExplanation(caseId: string) {
  return (await prisma.explanationDraft.create({ data: {
    caseId, language: 'EN', text: 'Approved synthetic explanation', source: 'TEMPLATE', status: 'APPROVED',
    approvedBy: doctor, approvedAt: now, createdAt: now, updatedAt: now,
  } })).id;
}
