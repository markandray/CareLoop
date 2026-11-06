import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { PrismaClient, ProviderType, Role, Urgency } from '@prisma/client';
import { DatabaseClock } from '../src/core/clock';
import { AUTH_COOKIE_NAME } from '../src/middleware/auth/authMiddleware';
import { createApp } from '../src/app';

const prisma = new PrismaClient();
const clock = new DatabaseClock(prisma.systemSetting);
const secret = 't104b_case_route_tests_jwt_secret_at_least_32_chars';
const clientOrigin = 'http://localhost:3000';
const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
const credentials = {
  PATIENT: { id: '', providerId: null as string | null },
  DOCTOR_A: { id: '', providerId: null as string | null },
  DOCTOR_B: { id: '', providerId: null as string | null },
  COORDINATOR: { id: '', providerId: null as string | null },
  ADMIN: { id: '', providerId: null as string | null },
};
let patientId: string;
let providerAId: string;
let providerBId: string;
let server: http.Server;
let baseUrl: string;
let doctorCaseId: string;
let otherProviderCaseId: string;
const doctorCaseIds: string[] = [];

before(async () => {
  await clock.initialize();
  const [providerA, providerB] = await Promise.all([
    prisma.provider.create({
      data: { name: `T104b origin ${suffix}`, type: ProviderType.SCREENING_CENTRE },
    }),
    prisma.provider.create({
      data: { name: `T104b receiving ${suffix}`, type: ProviderType.HOSPITAL },
    }),
  ]);
  providerAId = providerA.id;
  providerBId = providerB.id;

  const [patient, doctorA, doctorB, coordinator, admin] = await Promise.all([
    createUser('PATIENT', 'patient', null),
    createUser('DOCTOR', 'doctor-a', providerAId),
    createUser('DOCTOR', 'doctor-b', providerBId),
    createUser('COORDINATOR', 'coordinator', providerAId),
    createUser('ADMIN', 'admin', null),
  ]);
  credentials.PATIENT.id = patient.id;
  credentials.DOCTOR_A.id = doctorA.id;
  credentials.DOCTOR_A.providerId = providerAId;
  credentials.DOCTOR_B.id = doctorB.id;
  credentials.DOCTOR_B.providerId = providerBId;
  credentials.COORDINATOR.id = coordinator.id;
  credentials.COORDINATOR.providerId = providerAId;
  credentials.ADMIN.id = admin.id;
  patientId = (
    await prisma.patient.create({
      data: {
        userId: patient.id,
        syntheticMrn: `T104b-${suffix}`,
        dateOfBirth: new Date('1980-01-01T00:00:00.000Z'),
      },
    })
  ).id;

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
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe('T-104b case routes', () => {
  test('unauthenticated request is rejected and patients cannot create cases', async () => {
    const unauthenticated = await postCase(undefined, caseBody(providerAId));
    assert.equal(unauthenticated.status, 401);
    assert.equal(
      (await responseJson<{ error: { code: string } }>(unauthenticated)).error.code,
      'UNAUTHENTICATED',
    );

    const patientResponse = await postCase('PATIENT', caseBody(providerAId));
    assert.equal(patientResponse.status, 403);
    assert.equal(
      (await responseJson<{ error: { code: string } }>(patientResponse)).error.code,
      'FORBIDDEN',
    );
  });

  test('doctor creates and reads a case; another provider receives 404', async () => {
    const created = await postCase('DOCTOR_A', caseBody(providerAId, true));
    assert.equal(created.status, 201);
    const createdBody = await responseJson<{
      case: { id: string; state: string };
      event: { type: string };
    }>(created);
    doctorCaseId = createdBody.case.id;
    doctorCaseIds.push(doctorCaseId);
    assert.equal(createdBody.case.state, 'NEW');
    assert.equal(createdBody.event.type, 'CASE_CREATED');

    const read = await getCase('DOCTOR_A', doctorCaseId);
    assert.equal(read.status, 200);
    assert.equal((await responseJson<{ id: string }>(read)).id, doctorCaseId);

    const hidden = await getCase('DOCTOR_B', doctorCaseId);
    assert.equal(hidden.status, 404);
    assert.equal(
      (await responseJson<{ error: { code: string } }>(hidden)).error.code,
      'NOT_FOUND',
    );
  });

  test('coordinator case detail excludes clinical summary keys throughout JSON', async () => {
    const response = await getCase('COORDINATOR', doctorCaseId);
    assert.equal(response.status, 200);
    const keys = collectKeys(await response.json());
    assert.ok(!keys.has('resultCategory'));
    assert.ok(!keys.has('resultSummaryApproved'));
  });

  test('patient event response contains no payload or actor ID keys', async () => {
    const response = await fetch(`${baseUrl}/api/v1/cases/${doctorCaseId}/events`, {
      headers: authHeaders('PATIENT'),
    });
    assert.equal(response.status, 200);
    const keys = collectKeys(await response.json());
    assert.ok(!keys.has('payload'));
    assert.ok(!keys.has('actorId'));
    assert.ok(!keys.has('actorType'));
  });

  test('admin can see cases from both providers', async () => {
    const created = await postCase('ADMIN', caseBody(providerBId));
    assert.equal(created.status, 201);
    otherProviderCaseId = (
      await responseJson<{ case: { id: string } }>(created)
    ).case.id;

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const page = await fetch(`${baseUrl}/api/v1/cases?${query}`, {
        headers: authHeaders('ADMIN'),
      });
      assert.equal(page.status, 200);
      const body = await responseJson<{
        items: Array<{ id: string }>;
        nextCursor: string | null;
      }>(page);
      ids.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
    } while (cursor);
    assert.ok(ids.includes(doctorCaseId));
    assert.ok(ids.includes(otherProviderCaseId));
  });

  test('cursor pages are stable and non-overlapping', async () => {
    for (let index = 0; index < 3; index += 1) {
      const response = await postCase('DOCTOR_A', caseBody(providerAId, true));
      assert.equal(response.status, 201);
      doctorCaseIds.push(
        (await responseJson<{ case: { id: string } }>(response)).case.id,
      );
    }

    const walk = async (): Promise<string[]> => {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: '2', ownerUserId: credentials.DOCTOR_A.id });
        if (cursor) query.set('cursor', cursor);
        const response = await fetch(`${baseUrl}/api/v1/cases?${query}`, {
          headers: authHeaders('ADMIN'),
        });
        assert.equal(response.status, 200);
        const page = await responseJson<{
          items: Array<{ id: string }>;
          nextCursor: string | null;
        }>(response);
        ids.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor);
      return ids;
    };

    const firstWalk = await walk();
    const secondWalk = await walk();
    assert.deepEqual(firstWalk, secondWalk);
    assert.equal(new Set(firstWalk).size, firstWalk.length);
    for (const id of doctorCaseIds) assert.ok(firstWalk.includes(id));
  });

  test('invalid create body returns 400 VALIDATION_ERROR and cross-origin write returns 403', async () => {
    const invalid = await postCase('DOCTOR_A', {
      ...caseBody(providerAId),
      clientSuppliedDerivedField: true,
    });
    assert.equal(invalid.status, 400);
    assert.equal(
      (await responseJson<{ error: { code: string } }>(invalid)).error.code,
      'VALIDATION_ERROR',
    );

    const crossOrigin = await fetch(`${baseUrl}/api/v1/cases`, {
      method: 'POST',
      headers: {
        ...authHeaders('DOCTOR_A'),
        'Content-Type': 'application/json',
        Origin: 'https://attacker.invalid',
      },
      body: JSON.stringify(caseBody(providerAId)),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(
      (await responseJson<{ error: { code: string } }>(crossOrigin)).error.code,
      'FORBIDDEN',
    );
  });

  test('GET case writes a sensitive-read audit row', async () => {
    const response = await getCase('DOCTOR_A', doctorCaseId);
    assert.equal(response.status, 200);
    const audit = await prisma.auditLog.findFirst({
      where: {
        actorId: credentials.DOCTOR_A.id,
        action: 'CASE_READ',
        entityType: 'ScreeningCase',
        entityId: doctorCaseId,
      },
    });
    assert.ok(audit);
  });

  test('patient search returns only the approved DTO fields and writes PATIENT_SEARCH audit', async () => {
    for (const term of ['atient', 't104b']) {
      const response = await fetch(`${baseUrl}/api/v1/patients?query=${term}`, { headers: authHeaders('DOCTOR_A') });
      assert.equal(response.status, 200);
      const body = await responseJson<{ items: Array<Record<string, unknown>> }>(response);
      assert.ok(body.items.some((item) => item.id === patientId), `search term ${term}`);
      for (const item of body.items) assert.deepEqual(Object.keys(item).sort(), ['displayName', 'id', 'preferredLanguage', 'syntheticMrn']);
    }
    assert.ok(await prisma.auditLog.findFirst({ where: { actorId: credentials.DOCTOR_A.id, action: 'PATIENT_SEARCH', entityType: 'Patient', entityId: credentials.DOCTOR_A.id } }));
  });

  test('patient search uses stable cursor pages and caps page size at twenty', async () => {
    const matches = [];
    for (const label of ['first', 'second']) {
      const user = await createUser('PATIENT', `search-${label}`, null);
      const patient = await prisma.patient.create({ data: { userId: user.id, syntheticMrn: `T104b-search-${label}-${suffix}`, dateOfBirth: new Date('1982-01-01T00:00:00.000Z') } });
      matches.push(patient.id);
    }
    const firstResponse = await fetch(`${baseUrl}/api/v1/patients?query=search&limit=1`, { headers: authHeaders('ADMIN') });
    assert.equal(firstResponse.status, 200);
    const first = await responseJson<{ items: Array<{ id: string }>; nextCursor: string | null }>(firstResponse);
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor);
    const secondResponse = await fetch(`${baseUrl}/api/v1/patients?query=search&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`, { headers: authHeaders('ADMIN') });
    assert.equal(secondResponse.status, 200);
    const second = await responseJson<{ items: Array<{ id: string }>; nextCursor: string | null }>(secondResponse);
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(new Set([first.items[0]!.id, second.items[0]!.id]), new Set(matches));
    assert.equal((await fetch(`${baseUrl}/api/v1/patients?query=search&limit=21`, { headers: authHeaders('ADMIN') })).status, 400);
  });

  test('admin can search patients while coordinator and patient roles are forbidden', async () => {
    assert.equal((await fetch(`${baseUrl}/api/v1/patients?query=t104b`, { headers: authHeaders('ADMIN') })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/v1/patients?query=t104b`, { headers: authHeaders('COORDINATOR') })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/v1/patients?query=t104b`, { headers: authHeaders('PATIENT') })).status, 403);
  });

  test('patient search requires authentication and at least two query characters', async () => {
    assert.equal((await fetch(`${baseUrl}/api/v1/patients?query=t104b`)).status, 401);
    const invalid = await fetch(`${baseUrl}/api/v1/patients?query=t`, { headers: authHeaders('ADMIN') });
    assert.equal(invalid.status, 400);
    assert.equal((await responseJson<{ error: { code: string } }>(invalid)).error.code, 'VALIDATION_ERROR');
  });

  test('patient can decline care on their own case with event and audit but no state change', async () => {
    const created = await postCase('DOCTOR_A', caseBody(providerAId, true));
    const id = (await responseJson<{ case: { id: string; state: string } }>(created)).case.id;
    const response = await fetch(`${baseUrl}/api/v1/cases/${id}/decline-care`, {
      method: 'POST', headers: { ...authHeaders('PATIENT'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Synthetic preference.' }),
    });
    assert.equal(response.status, 200);
    const body = await responseJson<{ event: { label: string } }>(response);
    assert.ok(body.event.label);
    const event = await prisma.caseEvent.findFirstOrThrow({ where: { caseId: id, type: 'CARE_DECLINED_BY_PATIENT' } });
    assert.equal(event.fromState, 'NEW');
    assert.equal(event.toState, 'NEW');
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id }, select: { state: true } })).state, 'NEW');
    assert.ok(await prisma.auditLog.findFirst({ where: { actorId: credentials.PATIENT.id, action: 'CARE_DECLINED_BY_PATIENT', entityType: 'ScreeningCase', entityId: id } }));
  });

  test('patient cannot decline care for another patient case', async () => {
    const otherUser = await createUser('PATIENT', 'other-patient', null);
    const otherPatient = await prisma.patient.create({ data: { userId: otherUser.id, syntheticMrn: `T104b-other-${suffix}`, dateOfBirth: new Date('1981-01-01T00:00:00.000Z') } });
    const created = await postCase('DOCTOR_A', caseBody(providerAId, true, otherPatient.id));
    const id = (await responseJson<{ case: { id: string } }>(created)).case.id;
    const response = await fetch(`${baseUrl}/api/v1/cases/${id}/decline-care`, {
      method: 'POST', headers: { ...authHeaders('PATIENT'), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Synthetic preference.' }),
    });
    assert.equal(response.status, 404);
  });

  test('decline care returns conflict for a closed case', async () => {
    const created = await postCase('DOCTOR_A', caseBody(providerAId, true));
    const id = (await responseJson<{ case: { id: string } }>(created)).case.id;
    await prisma.screeningCase.update({ where: { id }, data: { state: 'CLOSED', closureReason: 'PATIENT_DECLINED', closedAt: clock.now(), dueAt: null, ownerUserId: null, ownerQueueRole: null, ownerQueueProviderId: null } });
    const response = await fetch(`${baseUrl}/api/v1/cases/${id}/decline-care`, {
      method: 'POST', headers: { ...authHeaders('PATIENT'), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Synthetic preference.' }),
    });
    assert.equal(response.status, 409);
    assert.equal((await responseJson<{ error: { code: string } }>(response)).error.code, 'CONFLICT');
  });

  test('doctor and coordinator cannot use patient decline-care action', async () => {
    const created = await postCase('DOCTOR_A', caseBody(providerAId, true));
    const id = (await responseJson<{ case: { id: string } }>(created)).case.id;
    for (const actor of ['DOCTOR_A', 'COORDINATOR'] as const) {
      const response = await fetch(`${baseUrl}/api/v1/cases/${id}/decline-care`, {
        method: 'POST', headers: { ...authHeaders(actor), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Synthetic preference.' }),
      });
      assert.equal(response.status, 403, actor);
    }
  });
});

type ActorKey = keyof typeof credentials;

async function postCase(actor: ActorKey | undefined, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/cases`, {
    method: 'POST',
    headers: {
      ...(actor ? authHeaders(actor) : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function getCase(actor: ActorKey, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/cases/${id}`, { headers: authHeaders(actor) });
}

function authHeaders(actor: ActorKey): Record<string, string> {
  const user = credentials[actor];
  const role: Role =
    actor === 'DOCTOR_A' || actor === 'DOCTOR_B'
      ? 'DOCTOR'
      : actor === 'COORDINATOR'
        ? 'COORDINATOR'
        : actor === 'ADMIN'
          ? 'ADMIN'
          : 'PATIENT';
  const token = jwt.sign(
    { userId: user.id, role },
    secret,
    { expiresIn: '1h' },
  );
  return { Cookie: `${AUTH_COOKIE_NAME}=${token}` };
}

function caseBody(originProviderId: string, assignDoctor = false, patient = patientId) {
  return {
    transitionKey: 'CREATE_CASE',
    evidence: {
      patientId: patient,
      originProviderId,
      pathway: 'Synthetic pathway',
      screeningType: 'Synthetic screening',
      resultCategory: 'Synthetic result category',
      preliminarySummary: 'Preliminary intake summary.',
      recommendedAction: 'Recommended initial action.',
      intakeUrgency: Urgency.ROUTINE,
      ...(assignDoctor ? { assignedDoctorId: credentials.DOCTOR_A.id } : {}),
    },
  };
}

async function createUser(role: Role, label: string, providerId: string | null) {
  return prisma.user.create({
    data: {
      email: `t104b-${label}-${suffix}@careloop.test`,
      name: `T-104b ${label}`,
      role,
      providerId,
      passwordHash: 'test-only-hash',
    },
  });
}

async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}
