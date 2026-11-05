import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { PrismaClient, ProviderType, type Role } from '@prisma/client';
import type { Clock } from '../src/core/clock';
import { AUTH_COOKIE_NAME } from '../src/middleware/auth/authMiddleware';
import { createApp } from '../src/app';

const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const baseNow = new Date('2026-11-05T12:00:00.000Z');
let clockNow = new Date(baseNow);
const clock: Clock = { now: () => new Date(clockNow), advance: async (n, unit) => { const scale = { milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[unit]; clockNow = new Date(clockNow.getTime() + n * scale); return new Date(clockNow); }, reset: async () => { clockNow = new Date(baseNow); return new Date(clockNow); } };
const secret = 't205a_attention_route_tests_secret_at_least_32_chars';
const origin = 'http://localhost:3000';
const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
const users: Record<string, { id: string; role: Role; providerId: string | null }> = {};
let providerA: string;
let providerB: string;
let patientId: string;
let server: http.Server;
let baseUrl: string;
let captureQueries = false;
let queryCount = 0;
prisma.$on('query', () => { if (captureQueries) queryCount += 1; });

before(async () => {
  await prisma.$connect();
  const [a, b] = await Promise.all([makeProvider('a'), makeProvider('b')]);
  providerA = a.id; providerB = b.id;
  const [patient, doctorA, coordinatorA, doctorB, coordinatorB, admin] = await Promise.all([
    makeUser('PATIENT', 'patient', null), makeUser('DOCTOR', 'doctor-a', providerA),
    makeUser('COORDINATOR', 'coordinator-a', providerA), makeUser('DOCTOR', 'doctor-b', providerB),
    makeUser('COORDINATOR', 'coordinator-b', providerB), makeUser('ADMIN', 'admin', null),
  ]);
  Object.assign(users, { PATIENT: patient, DOCTOR_A: doctorA, COORDINATOR_A: coordinatorA, DOCTOR_B: doctorB, COORDINATOR_B: coordinatorB, ADMIN: admin });
  patientId = (await prisma.patient.create({ data: { userId: patient.id, syntheticMrn: `T205A-${suffix}`, dateOfBirth: new Date('1980-01-01T00:00:00Z') } })).id;
  await prisma.consent.create({ data: { patientId, providerId: providerB, scope: 'CROSS_PROVIDER_REFERRAL', grantedAt: new Date(baseNow.getTime() - 60000) } });
  const app = createApp({ prisma, clock, env: { NODE_ENV: 'test', SERVER_PORT: 0, DATABASE_URL: process.env.DATABASE_URL ?? '', JWT_SECRET: secret, CLIENT_ORIGIN: origin, DEMO_PASSWORD: 'unused-test-password' } });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => { await clock.reset(); });
after(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); await prisma.$disconnect(); });

describe('T-205a attention HTTP and database behavior', () => {
  test('origin staff, consented receiving staff, and admin see only their permitted scopes', async () => {
    const local = await makeCase({ providerId: providerA });
    const received = await makeCase({ providerId: providerA, referralTo: providerB });
    const other = await makeCase({ providerId: providerB });
    const originList = await getList('DOCTOR_A');
    assert.ok(originList.some((item) => item.caseId === local.id));
    assert.ok(!originList.some((item) => item.caseId === other.id));
    const receivingList = await getList('COORDINATOR_B');
    assert.ok(receivingList.some((item) => item.caseId === received.id));
    assert.ok(!receivingList.some((item) => item.caseId === local.id));
    assert.equal((await api('ADMIN', 'GET', `/cases/${other.id}/attention`)).status, 200);
  });

  test('patient receives 403 for attention list and single-case attention', async () => {
    const item = await makeCase({ providerId: providerA });
    assert.equal((await api('PATIENT', 'GET', '/attention/cases')).status, 403);
    assert.equal((await api('PATIENT', 'GET', `/cases/${item.id}/attention`)).status, 403);
  });

  test('single case outside provider visibility is concealed with 404', async () => {
    const item = await makeCase({ providerId: providerA });
    assert.equal((await api('DOCTOR_B', 'GET', `/cases/${item.id}/attention`)).status, 404);
  });

  test('attention queue sorts by score and pages with an opaque cursor', async () => {
    const lower = await makeCase({ providerId: providerA, urgency: 'ROUTINE', owner: false });
    const higher = await makeCase({ providerId: providerA, urgency: 'URGENT', owner: false });
    const firstResponse = await api('ADMIN', 'GET', `/attention/cases?providerId=${providerA}&minLevel=MEDIUM&limit=1`);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as { items: Array<{ caseId: string; score: number }>; nextCursor: string | null };
    assert.ok(first.nextCursor);
    assert.notEqual(first.items[0]?.caseId, lower.id);
    const nextResponse = await api('ADMIN', 'GET', `/attention/cases?providerId=${providerA}&minLevel=MEDIUM&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`);
    assert.equal(nextResponse.status, 200);
    const next = await nextResponse.json() as { items: Array<{ caseId: string }> };
    assert.notEqual(first.items[0]?.caseId, next.items[0]?.caseId);
    assert.ok([lower.id, higher.id].includes(first.items[0]!.caseId));
  });

  test('new unassigned case scores thirty and urgent adds twenty', async () => {
    const routine = await makeCase({ providerId: providerA, owner: false });
    const urgent = await makeCase({ providerId: providerA, owner: false, urgency: 'URGENT' });
    const a = await getAttention('DOCTOR_A', routine.id);
    const b = await getAttention('DOCTOR_A', urgent.id);
    assert.equal(a.score, 30);
    assert.equal(b.score, 50);
  });

  test('advancing the injected clock forty eight hours moves an overdue urgent referral from MEDIUM to HIGH', async () => {
    const item = await makeCase({ providerId: providerA, urgency: 'URGENT', state: 'REFERRAL_PENDING', dueAt: new Date(baseNow.getTime() - 3600000), referralTo: providerB });
    const beforeValue = await getAttention('DOCTOR_A', item.id);
    assert.equal(beforeValue.attentionLevel, 'MEDIUM');
    await clock.advance(48, 'hours');
    const afterValue = await getAttention('DOCTOR_A', item.id);
    assert.equal(afterValue.attentionLevel, 'HIGH');
  });

  test('acknowledging result_reviewed removes the unacknowledged reason', async () => {
    const item = await makeCase({ providerId: providerA });
    const sentAt = new Date(baseNow.getTime() - 73 * 3600000);
    await prisma.screeningCase.update({ where: { id: item.id }, data: { notifiedAt: sentAt, acknowledgedAt: null } });
    const notification = await prisma.notification.create({ data: { caseId: item.id, userId: users.PATIENT.id, language: 'EN', templateKey: 'result_reviewed', status: 'SENT', sentAt } });
    assert.ok((await getAttention('DOCTOR_A', item.id)).reasons.some((reason) => reason.code === 'NOTIFICATION_UNACKNOWLEDGED'));
    assert.equal((await api('PATIENT', 'POST', `/notifications/${notification.id}/acknowledge`, {})).status, 200);
    assert.ok(!(await getAttention('DOCTOR_A', item.id)).reasons.some((reason) => reason.code === 'NOTIFICATION_UNACKNOWLEDGED'));
  });

  test('rejected referral reason appears only after the reassignment window', async () => {
    const item = await makeCase({ providerId: providerA, state: 'REFERRAL_PENDING', urgency: 'URGENT', referralTo: providerB, referralStatus: 'REJECTED', respondedAt: baseNow });
    assert.ok(!(await getAttention('DOCTOR_A', item.id)).reasons.some((reason) => reason.code === 'REJECTED_REFERRAL_NOT_REASSIGNED'));
    await clock.advance(4, 'hours');
    assert.ok(!(await getAttention('DOCTOR_A', item.id)).reasons.some((reason) => reason.code === 'REJECTED_REFERRAL_NOT_REASSIGNED'));
    await clock.advance(1, 'milliseconds');
    assert.ok((await getAttention('DOCTOR_A', item.id)).reasons.some((reason) => reason.code === 'REJECTED_REFERRAL_NOT_REASSIGNED'));
  });

  test('closed case is absent from the attention queue', async () => {
    const item = await makeCase({ providerId: providerA, state: 'CLOSED' });
    assert.equal((await api('ADMIN', 'GET', `/cases/${item.id}/attention`)).status, 404);
    assert.ok(!(await getList('ADMIN')).some((row) => row.caseId === item.id));
  });

  test('attention reason text contains no clinical content', async () => {
    const item = await makeCase({ providerId: providerA, urgency: 'URGENT', owner: false, state: 'REFERRAL_PENDING', referralTo: providerB });
    const response = await getAttention('DOCTOR_A', item.id);
    for (const reason of response.reasons) assert.doesNotMatch(reason.text, /diagnos|disease|cancer|tumou?r|symptom|treatment|medicine|drug|dose|clinical|screening|result/i);
  });

  test('snapshot query count stays constant for ten and fifty cases', async () => {
    const measure = async (count: number) => {
      for (let i = 0; i < count; i += 1) await makeCase({ providerId: providerA });
      queryCount = 0; captureQueries = true;
      try { await api('ADMIN', 'GET', `/attention/cases?providerId=${providerA}&limit=100`); }
      finally { captureQueries = false; }
      return queryCount;
    };
    const ten = await measure(10);
    const fifty = await measure(50);
    assert.equal(fifty, ten);
  });

  test('staff case list and detail include attention summary while patient DTO omits it', async () => {
    const item = await makeCase({ providerId: providerA });
    const staffDetail = await (await api('DOCTOR_A', 'GET', `/cases/${item.id}`)).json() as Record<string, unknown>;
    assert.deepEqual(staffDetail.attention, { level: 'LOW', score: 0 });
    const patientDetail = await (await api('PATIENT', 'GET', `/cases/${item.id}`)).json() as Record<string, unknown>;
    assert.equal(Object.hasOwn(patientDetail, 'attention'), false);
    const list = await (await api('DOCTOR_A', 'GET', `/cases?limit=100`)).json() as { items: Array<Record<string, unknown>> };
    assert.ok(list.items.find((row) => row.id === item.id)?.attention);
  });

  test('attentionOnly case filter includes MEDIUM and HIGH cases using the engine', async () => {
    const low = await makeCase({ providerId: providerA });
    const medium = await makeCase({ providerId: providerA, owner: false });
    const response = await api('DOCTOR_A', 'GET', '/cases?attentionOnly=true&limit=100');
    assert.equal(response.status, 200);
    const items = (await response.json() as { items: Array<{ id: string; attention?: { level: string } }> }).items;
    assert.ok(items.some((item) => item.id === medium.id && item.attention?.level === 'MEDIUM'));
    assert.ok(!items.some((item) => item.id === low.id));
  });

  test('attention reads write audit records and patients cannot use attentionOnly as a level oracle', async () => {
    const item = await makeCase({ providerId: providerA });
    await getAttention('DOCTOR_A', item.id);
    await getList('DOCTOR_A');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'ATTENTION_READ', actorId: users.DOCTOR_A.id, entityId: item.id } }));
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'ATTENTION_LIST_READ', actorId: users.DOCTOR_A.id } }));
    assert.equal((await api('PATIENT', 'GET', '/cases?attentionOnly=true')).status, 403);
  });
});

async function makeProvider(key: string) { return prisma.provider.create({ data: { name: `T205a-${suffix}-${key}`, type: ProviderType.CLINIC } }); }
async function makeUser(role: Role, key: string, providerId: string | null) { return prisma.user.create({ data: { email: `t205a-${suffix}-${key}@example.test`, passwordHash: 'not-used', name: key, role, providerId } }); }
async function makeCase(options: { providerId: string; referralTo?: string; referralStatus?: 'PENDING' | 'REJECTED'; respondedAt?: Date; urgency?: 'ROUTINE' | 'URGENT'; owner?: boolean; state?: 'NEW' | 'REFERRAL_PENDING' | 'CLOSED'; dueAt?: Date }) {
  const state = options.state ?? 'NEW';
  const row = await prisma.screeningCase.create({ data: {
    patientId, originProviderId: options.providerId, createdById: options.providerId === providerA ? users.DOCTOR_A.id : users.DOCTOR_B.id,
    pathway: 'Synthetic pathway', screeningType: 'Synthetic screen', resultCategory: 'Synthetic category',
    intakeUrgency: options.urgency ?? 'ROUTINE', urgencyLabel: state === 'NEW' ? null : options.urgency ?? 'ROUTINE', state: state === 'CLOSED' ? 'NEW' : state,
    ownerUserId: options.owner === false ? null : (options.providerId === providerA ? users.DOCTOR_A.id : users.DOCTOR_B.id),
    ownerQueueRole: null, ownerQueueProviderId: null, dueAt: options.dueAt ?? new Date(clock.now().getTime() + 7 * 86400000),
  } });
  if (options.referralTo) await prisma.referral.create({ data: { caseId: row.id, fromProviderId: options.providerId, toProviderId: options.referralTo, status: options.referralStatus ?? 'PENDING', ...(options.referralStatus === 'REJECTED' ? { rejectionReason: 'Synthetic handoff unavailable.' } : {}), respondedAt: options.respondedAt } });
  if (state === 'CLOSED') await prisma.screeningCase.update({ where: { id: row.id }, data: { state: 'CLOSED', closureReason: 'PATIENT_DECLINED', closedAt: clock.now(), dueAt: null, ownerUserId: null } });
  return row;
}
async function api(userKey: keyof typeof users, method: string, path: string, body?: Record<string, unknown>) {
  const user = users[userKey];
  const token = jwt.sign({ userId: user.id, role: user.role }, secret, { expiresIn: '1h' });
  return fetch(`${baseUrl}/api/v1${path}`, { method, headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function getList(userKey: keyof typeof users) { return (await (await api(userKey, 'GET', '/attention/cases?limit=100')).json() as { items: Array<{ caseId: string }> }).items; }
async function getAttention(userKey: keyof typeof users, caseId: string) { const response = await api(userKey, 'GET', `/cases/${caseId}/attention`); if (!response.ok) throw new Error(`Attention request failed ${response.status}: ${await response.text()}`); return await response.json() as { score: number; attentionLevel: string; reasons: Array<{ code: string; text: string }> }; }
