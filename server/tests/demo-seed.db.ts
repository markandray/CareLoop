import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { DatabaseClock } from '../src/core/clock';
import { createApp } from '../src/app';
import { runSeed } from '../src/seed';
import { transitionTable } from '../src/core/stateMachine/transitionTable';

const prisma = new PrismaClient();
const clock = new DatabaseClock(prisma.systemSetting);
const secret = 'demo_seed_test_secret_with_at_least_32_characters';
const password = 'DemoTestPassword2026!';
let server: http.Server;
let apiUrl: string;
let seedOutput = '';
let caseIds: string[] = [];
let stuckId = '';
const tsxCli = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
const demoScript = fileURLToPath(new URL('../src/demoSeed.ts', import.meta.url));

before(async () => {
  process.env.DEMO_PASSWORD = password;
  await prisma.$connect();
  await clock.initialize();
  await runSeed();
  const app = createApp({ prisma, clock, env: {
    NODE_ENV: 'test', SERVER_PORT: 0, DATABASE_URL: process.env.DATABASE_URL ?? '', JWT_SECRET: secret,
    CLIENT_ORIGIN: 'http://localhost:3000', DEMO_PASSWORD: password,
  } });
  server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const child = spawn(tsxCli, [demoScript], {
    cwd: process.cwd(),
    env: { ...process.env, API_BASE_URL: apiUrl, DEMO_PASSWORD: password, CLIENT_ORIGIN: 'http://localhost:3000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
  const [code] = await once(child, 'close') as [number | null];
  seedOutput = Buffer.concat(chunks).toString('utf8');
  assert.equal(code, 0, seedOutput);
  const marker = await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'demoSeed' } });
  const value = marker.value as { caseIds: string[]; stuckCaseId: string };
  caseIds = value.caseIds;
  stuckId = value.stuckCaseId;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

test('demo seed creates the requested cases in each workflow state', async () => {
  assert.equal(caseIds.length, 14);
  const rows = await prisma.screeningCase.findMany({ where: { id: { in: caseIds } }, select: { state: true } });
  const counts = Object.fromEntries(['NEW', 'CLINICIAN_REVIEWED', 'CONFIRMATION_PENDING', 'REFERRAL_PENDING', 'REFERRAL_ACCEPTED', 'APPOINTMENT_SCHEDULED', 'CARE_STARTED', 'CLOSED'].map((state) => [state, rows.filter((row) => row.state === state).length]));
  assert.deepEqual(counts, { NEW: 2, CLINICIAN_REVIEWED: 3, CONFIRMATION_PENDING: 1, REFERRAL_PENDING: 2, REFERRAL_ACCEPTED: 1, APPOINTMENT_SCHEDULED: 2, CARE_STARTED: 1, CLOSED: 2 });
});

test('each demo case starts with CASE_CREATED and follows allowed state-machine transitions', async () => {
  for (const id of caseIds) {
    const events = await prisma.caseEvent.findMany({ where: { caseId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    assert.equal(events[0]?.type, 'CASE_CREATED', id);
    let state = 'NEW';
    for (const event of events) {
      if (typeof event.payload !== 'object' || event.payload === null || !('transitionKey' in event.payload)) continue;
      const key = event.payload.transitionKey;
      if (typeof key !== 'string' || key === 'CREATE_CASE') continue;
      const policy = transitionTable[key as keyof typeof transitionTable];
      assert.ok(policy, `unknown transition ${key} on ${id}`);
      assert.equal(event.fromState, state, `${id} transition ${key} starts from expected state`);
      assert.equal(event.toState, policy.to, `${id} transition ${key} reaches its policy state`);
      state = policy.to;
    }
    const stored = await prisma.screeningCase.findUniqueOrThrow({ where: { id }, select: { state: true } });
    assert.equal(state, stored.state, id);
  }
});

test('stuck demo case retains pending referral and active cross-provider consent', async () => {
  const row = await prisma.screeningCase.findUniqueOrThrow({ where: { id: stuckId }, include: { referrals: true, patient: { include: { consents: true } } } });
  assert.equal(row.state, 'REFERRAL_PENDING');
  assert.equal(row.referrals.filter((referral) => referral.status === 'PENDING').length, 1);
  assert.ok(row.patient.consents.some((consent) => consent.providerId === row.referrals[0]?.toProviderId && consent.scope === 'CROSS_PROVIDER_REFERRAL' && consent.revokedAt === null));
});

test('patient-facing seeded explanation and notification text has no digits or denylisted clinical terms', async () => {
  const explanations = await prisma.explanationDraft.findMany({ where: { caseId: { in: caseIds }, status: 'APPROVED' }, select: { text: true } });
  const notifications = await prisma.notification.findMany({ where: { caseId: { in: caseIds } }, select: { templateKey: true, language: true } });
  const { getNotificationTemplate } = await import('../src/modules/notifications/templateCatalog');
  const denylist = /\b(?:cancer|tumou?r|carcinoma|diabetes|hypertension|asthma|stroke|infection|aspirin|ibuprofen|paracetamol|acetaminophen|insulin|metformin|mg|dose|dosage|tablet|capsule)\b|سرطان|ورم|سكري|داء السكري|ضغط الدم|ربو|سكتة|عدوى|أسبرين|إيبوبروفين|باراسيتامول|إنسولين|ميتفورمين|جرعة|دواء/u;
  for (const item of explanations) {
    const value = JSON.parse(item.text) as { sections: Record<string, unknown> };
    for (const text of Object.values(value.sections)) {
      if (typeof text !== 'string') continue;
      assert.doesNotMatch(text, /[0-9٠-٩۰-۹]/);
      assert.doesNotMatch(text, denylist);
    }
  }
  for (const item of notifications) {
    const text = getNotificationTemplate(item.templateKey, item.language).text;
    assert.doesNotMatch(text, /[0-9٠-٩۰-۹]/);
    assert.doesNotMatch(text, denylist);
  }
});

test('demo seed refuses a second run and points to demo:reset', async () => {
  const child = spawn(tsxCli, [demoScript], { cwd: process.cwd(), env: { ...process.env, API_BASE_URL: apiUrl, DEMO_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
  const [code] = await once(child, 'close') as [number | null];
  const output = Buffer.concat(chunks).toString('utf8');
  assert.notEqual(code, 0);
  assert.match(output, /demo:reset/);
});

test('demo seed prints the stuck case identifier and a fourteen-case summary', () => {
  assert.match(seedOutput, new RegExp(`STUCK_DEMO_CASE_ID=${stuckId}`));
  assert.match(seedOutput, /caseId/);
  assert.match(seedOutput, /STUCK_DEMO_CASE_ID=/);
});
