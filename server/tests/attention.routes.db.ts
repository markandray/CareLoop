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
import { runEscalationSweep } from '../src/modules/escalation/escalationService';

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
  test('sweep raises level one for one millisecond overdue and a second sweep is a no-op', async () => {
    const item = await makeCase({ providerId: providerA, dueAt: new Date(baseNow.getTime() - 1) });
    await runEscalationSweep({ prisma, clock });
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).escalationLevel, 'LEVEL_1');
    assert.equal(await runEscalationSweep({ prisma, clock }), 0);
    assert.equal(await prisma.caseEvent.count({ where: { caseId: item.id, type: 'ESCALATION_RAISED' } }), 1);
  });

  test('sweep raises level two and three at two and three completed SLA periods', async () => {
    const levelTwo = await makeCase({ providerId: providerA, dueAt: new Date(baseNow.getTime() - 4 * 24 * 3600000) });
    const levelThree = await makeCase({ providerId: providerA, dueAt: new Date(baseNow.getTime() - 6 * 24 * 3600000) });
    await runEscalationSweep({ prisma, clock });
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: levelTwo.id } })).escalationLevel, 'LEVEL_2');
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: levelThree.id } })).escalationLevel, 'LEVEL_3');
  });

  test('level two escalates after exactly 48 uncleared hours and not before', async () => {
    const item = await makeCase({ providerId: providerA, dueAt: new Date(baseNow.getTime() + 1) });
    await prisma.screeningCase.update({ where: { id: item.id }, data: { escalationLevel: 'LEVEL_2', escalatedAt: baseNow } });
    await clock.advance(47 * 60 + 59, 'minutes');
    await runEscalationSweep({ prisma, clock });
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).escalationLevel, 'LEVEL_2');
    await clock.advance(1, 'minutes');
    await runEscalationSweep({ prisma, clock });
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).escalationLevel, 'LEVEL_3');
  });

  test('sweep does not lower escalations and ignores closed and non-overdue cases', async () => {
    const high = await makeCase({ providerId: providerA, dueAt: new Date(baseNow.getTime() + 86400000) });
    const closed = await makeCase({ providerId: providerA, state: 'CLOSED', dueAt: new Date(baseNow.getTime() - 1) });
    await prisma.screeningCase.update({ where: { id: high.id }, data: { escalationLevel: 'LEVEL_3', escalatedAt: baseNow } });
    await runEscalationSweep({ prisma, clock });
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: high.id } })).escalationLevel, 'LEVEL_3');
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: closed.id } })).escalationLevel, 'LEVEL_0');
    await prisma.screeningCase.update({ where: { id: closed.id }, data: { state: 'NEW', closureReason: null, closedAt: null, ownerUserId: users.DOCTOR_A.id, dueAt: new Date(baseNow.getTime() + 7 * 86400000) } });
  });

  test('two concurrent sweeps emit only one escalation event', async () => {
    const item = await makeCase({ providerId: providerA, dueAt: new Date(baseNow.getTime() - 1) });
    await Promise.all([runEscalationSweep({ prisma, clock }), runEscalationSweep({ prisma, clock })]);
    assert.equal(await prisma.caseEvent.count({ where: { caseId: item.id, type: 'ESCALATION_RAISED' } }), 1);
  });

  test('sweep query count stays constant for ten and fifty open cases', async () => {
    const measure = async (count: number) => {
      for (let i = 0; i < count; i += 1) await makeCase({ providerId: providerA });
      queryCount = 0; captureQueries = true;
      try { await runEscalationSweep({ prisma, clock }); }
      finally { captureQueries = false; }
      return queryCount;
    };
    const ten = await measure(10);
    const fifty = await measure(50);
    assert.equal(fifty, ten);
  });

  test('resolve rejects missing action plan and non-escalated cases with named errors', async () => {
    const item = await makeCase({ providerId: providerA });
    assert.equal((await api('DOCTOR_A', 'POST', `/cases/${item.id}/escalation/resolve`, {})).status, 400);
    const result = await api('DOCTOR_A', 'POST', `/cases/${item.id}/escalation/resolve`, { actionPlan: 'Review and assign a follow-up owner.' });
    assert.equal(result.status, 409);
  });

  test('overdue escalation resolution requires delay reason, resets dueAt, and clears escalation', async () => {
    const item = await makeCase({ providerId: providerA, dueAt: new Date(baseNow.getTime() - 1) });
    await prisma.screeningCase.update({ where: { id: item.id }, data: { escalationLevel: 'LEVEL_1', escalatedAt: baseNow } });
    const path = `/cases/${item.id}/escalation/resolve`;
    assert.equal((await api('COORDINATOR_A', 'POST', path, { actionPlan: 'Contact the patient and confirm the next operational step.' })).status, 422);
    const response = await api('COORDINATOR_A', 'POST', path, { actionPlan: 'Contact the patient and confirm the next operational step.', delayReason: 'PROVIDER_DELAY' });
    assert.equal(response.status, 200);
    const row = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(row.escalationLevel, 'LEVEL_0'); assert.equal(row.escalatedAt, null); assert.ok(row.dueAt!.getTime() > baseNow.getTime());
    assert.equal(await prisma.caseEvent.count({ where: { caseId: item.id, type: 'ESCALATION_CLEARED' } }), 1);
    assert.equal(await prisma.caseEvent.count({ where: { caseId: item.id, type: 'DELAY_REASON_RECORDED' } }), 1);
    await clock.advance(48, 'hours');
    await runEscalationSweep({ prisma, clock });
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).escalationLevel, 'LEVEL_0');
    await clock.advance(1, 'milliseconds');
    await runEscalationSweep({ prisma, clock });
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).escalationLevel, 'LEVEL_1');
  });

  test('level two resolution is doctor-only and patient/admin are denied', async () => {
    const item = await makeCase({ providerId: providerA });
    await prisma.screeningCase.update({ where: { id: item.id }, data: { escalationLevel: 'LEVEL_2', escalatedAt: baseNow } });
    const body = { actionPlan: 'Clinician review the operational plan and next owner.' };
    assert.equal((await api('COORDINATOR_A', 'POST', `/cases/${item.id}/escalation/resolve`, body)).status, 403);
    assert.equal((await api('PATIENT', 'POST', `/cases/${item.id}/escalation/resolve`, body)).status, 403);
    assert.equal((await api('ADMIN', 'POST', `/cases/${item.id}/escalation/resolve`, body)).status, 403);
    assert.equal((await api('DOCTOR_A', 'POST', `/cases/${item.id}/escalation/resolve`, body)).status, 200);
  });

  test('level one permits a doctor and level three remains doctor-only within scope', async () => {
    const levelOne = await makeCase({ providerId: providerA });
    await prisma.screeningCase.update({ where: { id: levelOne.id }, data: { escalationLevel: 'LEVEL_1', escalatedAt: baseNow } });
    assert.equal((await api('DOCTOR_A', 'POST', `/cases/${levelOne.id}/escalation/resolve`, { actionPlan: 'Review and record the next coordination step.' })).status, 200);
    const levelThree = await makeCase({ providerId: providerA });
    await prisma.screeningCase.update({ where: { id: levelThree.id }, data: { escalationLevel: 'LEVEL_3', escalatedAt: baseNow } });
    const plan = { actionPlan: 'Clinician review and record a safe operational plan.' };
    assert.equal((await api('COORDINATOR_A', 'POST', `/cases/${levelThree.id}/escalation/resolve`, plan)).status, 403);
    assert.equal((await api('DOCTOR_B', 'POST', `/cases/${levelThree.id}/escalation/resolve`, plan)).status, 404);
    assert.equal((await api('DOCTOR_A', 'POST', `/cases/${levelThree.id}/escalation/resolve`, plan)).status, 200);
  });

  test('owner assignment accepts the state owner role and rejects a wrong-role target', async () => {
    const item = await makeCase({ providerId: providerA, owner: false });
    const wrongRole = await api('COORDINATOR_A', 'PUT', `/cases/${item.id}/owner`, { userId: users.COORDINATOR_A.id });
    assert.equal(wrongRole.status, 400);
    const wrongProvider = await api('COORDINATOR_A', 'PUT', `/cases/${item.id}/owner`, { userId: users.DOCTOR_B.id });
    assert.equal(wrongProvider.status, 400);
    const response = await api('COORDINATOR_A', 'PUT', `/cases/${item.id}/owner`, { userId: users.DOCTOR_A.id });
    assert.equal(response.status, 200);
    const row = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(row.ownerUserId, users.DOCTOR_A.id); assert.equal(row.ownerQueueRole, null); assert.equal(row.ownerQueueProviderId, null);
  });

  test('receiving coordinator may assign a receiving queue owner to a pending referral', async () => {
    const item = await makeCase({ providerId: providerA, state: 'REFERRAL_PENDING', referralTo: providerB });
    await prisma.explanationDraft.create({ data: { caseId: item.id, language: 'EN', text: 'Synthetic approved explanation.', status: 'APPROVED', approvedBy: users.DOCTOR_A.id, approvedAt: baseNow, inputHash: '0'.repeat(64), createdAt: baseNow, updatedAt: baseNow } });
    await prisma.screeningCase.update({ where: { id: item.id }, data: { ownerUserId: null, ownerQueueRole: 'COORDINATOR', ownerQueueProviderId: providerB } });
    const response = await api('COORDINATOR_B', 'PUT', `/cases/${item.id}/owner`, { userId: users.COORDINATOR_B.id });
    assert.equal(response.status, 200);
    const row = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(row.ownerUserId, users.COORDINATOR_B.id);
    assert.equal(row.ownerQueueRole, null);
    assert.equal(row.ownerQueueProviderId, null);
  });

  test('admin owner assignment is audited with admin actor and closed assignment conflicts', async () => {
    const item = await makeCase({ providerId: providerA, owner: false });
    assert.equal((await api('ADMIN', 'PUT', `/cases/${item.id}/owner`, { userId: users.DOCTOR_A.id })).status, 200);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'OWNER_ASSIGNED', entityId: item.id, actorId: users.ADMIN.id } }));
    const closed = await makeCase({ providerId: providerA, state: 'CLOSED' });
    assert.equal((await api('ADMIN', 'PUT', `/cases/${closed.id}/owner`, { userId: users.DOCTOR_A.id })).status, 409);
  });

  test('demo clock advance is admin-only, capped, audited, and disabled routes return 404', async () => {
    const beforeAdvance = await clock.now();
    assert.equal((await api('COORDINATOR_A', 'POST', '/demo/clock/advance', { amount: 1, unit: 'HOURS' })).status, 403);
    assert.equal((await api('ADMIN', 'POST', '/demo/clock/advance', { amount: 31, unit: 'DAYS' })).status, 400);
    const response = await api('ADMIN', 'POST', '/demo/clock/advance', { amount: 1, unit: 'HOURS' });
    assert.equal(response.status, 200);
    assert.equal((await clock.now()).getTime() - beforeAdvance.getTime(), 3600000);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'DEMO_CLOCK_ADVANCED', actorId: users.ADMIN.id } }));
    const disabledApp = createApp({ prisma, clock, env: { NODE_ENV: 'test', SERVER_PORT: 0, DATABASE_URL: process.env.DATABASE_URL ?? '', JWT_SECRET: secret, CLIENT_ORIGIN: origin, DEMO_PASSWORD: 'unused-test-password', DEMO_CONTROLS_ENABLED: false } });
    const disabledServer = http.createServer(disabledApp); await new Promise<void>((resolve) => disabledServer.listen(0, '127.0.0.1', resolve));
    const disabledBase = `http://127.0.0.1:${(disabledServer.address() as AddressInfo).port}`;
    const token = jwt.sign({ userId: users.ADMIN.id, role: 'ADMIN' }, secret, { expiresIn: '1h' });
    const disabled = await fetch(`${disabledBase}/api/v1/demo/clock`, { headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` } });
    assert.equal(disabled.status, 404);
    for (const path of ['/demo/clock/advance', '/demo/clock/reset']) {
      const disabledResponse = await fetch(`${disabledBase}/api/v1${path}`, { method: 'POST', headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, Origin: origin, 'Content-Type': 'application/json' }, body: path.endsWith('advance') ? JSON.stringify({ amount: 1, unit: 'HOURS' }) : '{}' });
      assert.equal(disabledResponse.status, 404);
    }
    await new Promise<void>((resolve) => disabledServer.close(() => resolve()));
  });

  test('one 48 hour admin clock advance makes an urgent pending referral HIGH and escalated', async () => {
    const item = await makeCase({ providerId: providerA, urgency: 'URGENT', state: 'REFERRAL_PENDING', dueAt: baseNow, referralTo: providerB });
    const advanced = await api('ADMIN', 'POST', '/demo/clock/advance', { amount: 48, unit: 'HOURS' });
    assert.equal(advanced.status, 200);
    const row = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(row.escalationLevel, 'LEVEL_2');
    assert.ok(row.escalatedAt);
    assert.equal((await getAttention('DOCTOR_A', item.id)).attentionLevel, 'HIGH');
  });
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
    const isolatedProvider = (await makeProvider('sort')).id;
    const lower = await makeCase({ providerId: isolatedProvider, urgency: 'ROUTINE', owner: false });
    const higher = await makeCase({ providerId: isolatedProvider, urgency: 'URGENT', owner: false });
    const firstResponse = await api('ADMIN', 'GET', `/attention/cases?providerId=${isolatedProvider}&minLevel=MEDIUM&limit=1`);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as { items: Array<{ caseId: string; score: number }>; nextCursor: string | null };
    assert.ok(first.nextCursor);
    assert.notEqual(first.items[0]?.caseId, lower.id);
    const nextResponse = await api('ADMIN', 'GET', `/attention/cases?providerId=${isolatedProvider}&minLevel=MEDIUM&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`);
    assert.equal(nextResponse.status, 200);
    const next = await nextResponse.json() as { items: Array<{ caseId: string }> };
    assert.notEqual(first.items[0]?.caseId, next.items[0]?.caseId);
    assert.ok([lower.id, higher.id].includes(first.items[0]!.caseId));
  });

  test('minimum escalation filter is inclusive and queue DTO exposes escalation timestamp', async () => {
    const isolatedProvider = (await makeProvider('filter')).id;
    const lower = await makeCase({ providerId: isolatedProvider, dueAt: new Date(baseNow.getTime() - 1) });
    const higher = await makeCase({ providerId: isolatedProvider, dueAt: new Date(baseNow.getTime() - 4 * 24 * 3600000) });
    await runEscalationSweep({ prisma, clock });
    const response = await api('ADMIN', 'GET', `/attention/cases?minEscalation=LEVEL_2&providerId=${isolatedProvider}&limit=100`);
    assert.equal(response.status, 200);
    const rows = (await response.json() as { items: Array<{ caseId: string; escalationLevel: string; escalatedAt: string | null }> }).items;
    assert.ok(!rows.some((row) => row.caseId === lower.id));
    const row = rows.find((item) => item.caseId === higher.id);
    assert.equal(row?.escalationLevel, 'LEVEL_2');
    assert.ok(row?.escalatedAt);
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
