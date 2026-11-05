import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  ActorType,
  CaseEventType,
  CaseState,
  ExplanationSource,
  ExplanationStatus,
  PrismaClient,
  ProviderType,
  Role,
  Urgency,
} from '@prisma/client';
import type { Clock } from '../src/core/clock';
import { appendEvent } from '../src/core/eventLog';
import { caseDetailInclude } from '../src/modules/cases/caseProjection';
import {
  createCase,
  getCase,
  listCaseEvents,
  listCases,
  type CaseServiceDependencies,
  type CreateCaseEvidence,
} from '../src/modules/cases/caseService';
import type { CaseActor } from '../src/modules/cases/caseVisibility';

const prisma = new PrismaClient();
const fixedTime = new Date('2026-11-03T10:00:00.000Z');
const clock: Clock = {
  now: () => new Date(fixedTime),
  advance: async () => new Date(fixedTime),
  reset: async () => new Date(fixedTime),
};
const dependencies: CaseServiceDependencies = { prisma, clock };
const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;

let providerAId: string;
let providerBId: string;
let doctorAId: string;
let doctorBId: string;
let coordinatorAId: string;
let adminId: string;
let patientAUserId: string;
let patientBUserId: string;
let patientAId: string;
let patientBId: string;
let patientACaseA: string;
let patientACaseB: string;
let patientBCaseA: string;
const extraCaseIds: string[] = [];

before(async () => {
  await prisma.$connect();
  const [providerA, providerB] = await Promise.all([
    prisma.provider.create({
      data: { name: `T104a origin ${suffix}`, type: ProviderType.SCREENING_CENTRE },
    }),
    prisma.provider.create({
      data: { name: `T104a other ${suffix}`, type: ProviderType.HOSPITAL },
    }),
  ]);
  providerAId = providerA.id;
  providerBId = providerB.id;

  const [doctorA, doctorB, coordinatorA, admin, patientAUser, patientBUser] =
    await Promise.all([
      createUser('DOCTOR', `doctor-a-${suffix}`, providerAId),
      createUser('DOCTOR', `doctor-b-${suffix}`, providerBId),
      createUser('COORDINATOR', `coord-a-${suffix}`, providerAId),
      createUser('ADMIN', `admin-${suffix}`, null),
      createUser('PATIENT', `patient-a-${suffix}`, null),
      createUser('PATIENT', `patient-b-${suffix}`, null),
    ]);
  doctorAId = doctorA.id;
  doctorBId = doctorB.id;
  coordinatorAId = coordinatorA.id;
  adminId = admin.id;
  patientAUserId = patientAUser.id;
  patientBUserId = patientBUser.id;

  const [patientA, patientB] = await Promise.all([
    prisma.patient.create({
      data: {
        userId: patientAUserId,
        syntheticMrn: `T104a-A-${suffix}`,
        dateOfBirth: new Date('1980-01-01T00:00:00.000Z'),
      },
    }),
    prisma.patient.create({
      data: {
        userId: patientBUserId,
        syntheticMrn: `T104a-B-${suffix}`,
        dateOfBirth: new Date('1982-02-02T00:00:00.000Z'),
      },
    }),
  ]);
  patientAId = patientA.id;
  patientBId = patientB.id;

  patientACaseA = await createStoredCase(patientAId, providerAId, doctorAId);
  patientACaseB = await createStoredCase(patientAId, providerBId, doctorBId);
  patientBCaseA = await createStoredCase(patientBId, providerAId, doctorAId);
  extraCaseIds.push(
    await createStoredCase(patientAId, providerAId, doctorAId),
    await createStoredCase(patientBId, providerAId, doctorAId),
  );
});

after(async () => {
  await prisma.$disconnect();
});

test('case visibility limits patients to their profile and clinicians to origin provider; admins see all', async () => {
  const patientPage = await listCases(
    dependencies,
    actor(patientAUserId, 'PATIENT', null),
    { limit: 100 },
  );
  const patientIds = new Set(patientPage.items.map((item) => item.id));
  assert.ok(patientIds.has(patientACaseA));
  assert.ok(patientIds.has(patientACaseB));
  assert.ok(!patientIds.has(patientBCaseA));

  const doctorPage = await listCases(
    dependencies,
    actor(doctorAId, 'DOCTOR', providerAId),
    { limit: 100 },
  );
  const doctorIds = new Set(doctorPage.items.map((item) => item.id));
  assert.ok(doctorIds.has(patientACaseA));
  assert.ok(doctorIds.has(patientBCaseA));
  assert.ok(!doctorIds.has(patientACaseB));

  const coordinatorPage = await listCases(
    dependencies,
    actor(coordinatorAId, 'COORDINATOR', providerAId),
    { limit: 100 },
  );
  assert.ok(coordinatorPage.items.some((item) => item.id === patientACaseA));

  const unaffiliatedDoctorPage = await listCases(
    dependencies,
    actor(doctorAId, 'DOCTOR', null),
    { limit: 100 },
  );
  assert.equal(unaffiliatedDoctorPage.items.length, 0);

  const adminIds = await fetchAllCaseIds(actor(adminId, 'ADMIN', null));
  assert.ok(
    [patientACaseA, patientACaseB, patientBCaseA, ...extraCaseIds].every((id) =>
      adminIds.includes(id),
    ),
  );
});

test('coordinator DTO contains no clinical result summary', async () => {
  const result = await getCase(
    dependencies,
    actor(coordinatorAId, 'COORDINATOR', providerAId),
    patientACaseA,
  );
  assert.equal(result.id, patientACaseA);
  assert.equal('resultCategory' in result, false);
  assert.equal('resultSummaryApproved' in result, false);
});

test('patient event DTO contains no payload or actor identifiers', async () => {
  const storedCase = await prisma.screeningCase.findUniqueOrThrow({
    where: { id: patientACaseA },
  });
  const event = await prisma.$transaction((tx) =>
    appendEvent(
      tx,
      {
        caseId: patientACaseA,
        type: CaseEventType.CASE_CREATED,
        actorType: ActorType.USER,
        actorId: doctorAId,
        toState: storedCase.state,
        payload: { secret: 'must not be projected' },
      },
      clock,
    ),
  );
  const result = await listCaseEvents(
    dependencies,
    actor(patientAUserId, 'PATIENT', null),
    patientACaseA,
    { limit: 100 },
  );
  const dto = result.items.find((item) => item.id === event.id);
  assert.ok(dto);
  assert.equal('payload' in dto, false);
  assert.equal('actorId' in dto, false);
  assert.equal('actorType' in dto, false);
  assert.equal('secret' in dto, false);
});

test('createCase writes case, intake evidence, event, and audit with sequence ID and clock timestamps', async () => {
  const evidence = createEvidence(patientAId, providerAId, doctorAId);
  const result = await createCase(
    dependencies,
    actor(doctorAId, 'DOCTOR', providerAId),
    evidence,
  );
  assert.match(result.id, /^CL-\d{4,}$/);
  assert.equal(result.state, CaseState.NEW);
  assert.equal(result.dueAt, new Date(fixedTime.getTime() + 48 * 60 * 60 * 1000).toISOString());

  const [storedCase, intakeEvidence, event, audit] = await Promise.all([
    prisma.screeningCase.findUniqueOrThrow({ where: { id: result.id } }),
    prisma.evidence.findFirst({ where: { caseId: result.id } }),
    prisma.caseEvent.findFirst({ where: { caseId: result.id } }),
    prisma.auditLog.findFirst({
      where: { action: 'CASE_CREATED', entityId: result.id, actorId: doctorAId },
    }),
  ]);
  assert.equal(storedCase.createdAt.toISOString(), fixedTime.toISOString());
  assert.equal(storedCase.ownerUserId, doctorAId);
  assert.equal(storedCase.ownerQueueProviderId, null);
  assert.equal(intakeEvidence?.kind, 'SCREENING_INTAKE');
  assert.equal(intakeEvidence?.recordedBy, doctorAId);
  assert.equal(event?.type, 'CASE_CREATED');
  assert.equal(event?.actorId, doctorAId);
  assert.equal(event?.createdAt.toISOString(), fixedTime.toISOString());
  assert.ok(audit);
  assert.equal(audit.createdAt.toISOString(), fixedTime.toISOString());
});

test('case creation rolls back all writes when the audit writer fails', async () => {
  const before = await prisma.screeningCase.count({ where: { createdById: doctorAId } });
  const failingDependencies: CaseServiceDependencies = {
    ...dependencies,
    auditWriter: async () => {
      throw new Error('simulated audit outage');
    },
  };
  await assert.rejects(
    createCase(
      failingDependencies,
      actor(doctorAId, 'DOCTOR', providerAId),
      createEvidence(patientAId, providerAId, doctorAId),
    ),
    /simulated audit outage/,
  );
  assert.equal(
    await prisma.screeningCase.count({ where: { createdById: doctorAId } }),
    before,
  );
});

test('doctor cannot create a case for another provider', async () => {
  const before = await prisma.screeningCase.count({ where: { createdById: doctorAId } });
  await assert.rejects(
    createCase(
      dependencies,
      actor(doctorAId, 'DOCTOR', providerAId),
      createEvidence(patientAId, providerBId, doctorAId),
    ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'FORBIDDEN');
      return true;
    },
  );
  assert.equal(
    await prisma.screeningCase.count({ where: { createdById: doctorAId } }),
    before,
  );
});

test('admin may create for any provider and an unassigned case remains unassigned', async () => {
  const result = await createCase(
    dependencies,
    actor(adminId, 'ADMIN', null),
    createEvidence(patientBId, providerBId, undefined, 'URGENT'),
  );
  assert.equal(result.state, CaseState.NEW);
  assert.equal('originProvider' in result ? result.originProvider.id : null, providerBId);
  assert.deepEqual('owner' in result ? result.owner : null, { kind: 'UNASSIGNED' });
  assert.equal(result.dueAt, new Date(fixedTime.getTime() + 4 * 60 * 60 * 1000).toISOString());
});

test('keyset pagination returns stable pages for equal creation timestamps', async () => {
  const requester = actor(doctorAId, 'DOCTOR', providerAId);
  const fetchIds = async (): Promise<string[]> => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listCases(dependencies, requester, {
        limit: 2,
        ownerUserId: doctorAId,
        cursor,
      });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  };

  const firstWalk = await fetchIds();
  const secondWalk = await fetchIds();
  assert.deepEqual(firstWalk, secondWalk);
  assert.equal(new Set(firstWalk).size, firstWalk.length);
  for (const id of [patientACaseA, patientBCaseA, ...extraCaseIds]) {
    assert.ok(firstWalk.includes(id));
  }
});

test('event cursor pagination returns stable pages when timestamps tie', async () => {
  for (let index = 0; index < 3; index += 1) {
    await prisma.$transaction((tx) =>
      appendEvent(
        tx,
        {
          caseId: patientACaseA,
          type: CaseEventType.CASE_CREATED,
          actorType: ActorType.USER,
          actorId: doctorAId,
          payload: { index },
        },
        clock,
      ),
    );
  }
  const requester = actor(doctorAId, 'DOCTOR', providerAId);
  const fetchIds = async (): Promise<string[]> => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listCaseEvents(dependencies, requester, patientACaseA, {
        limit: 1,
        cursor,
      });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  };
  const firstWalk = await fetchIds();
  const secondWalk = await fetchIds();
  assert.deepEqual(firstWalk, secondWalk);
  assert.equal(new Set(firstWalk).size, firstWalk.length);
});

test('case, case list, and event reads are audited', async () => {
  await getCase(dependencies, actor(doctorAId, 'DOCTOR', providerAId), patientACaseA);
  await listCases(dependencies, actor(doctorAId, 'DOCTOR', providerAId), { limit: 2 });
  await listCaseEvents(
    dependencies,
    actor(doctorAId, 'DOCTOR', providerAId),
    patientACaseA,
    { limit: 2 },
  );

  const audits = await prisma.auditLog.findMany({
    where: { actorId: doctorAId, entityId: { in: [patientACaseA, doctorAId] } },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(audits.some((entry) => entry.action === 'CASE_READ' && entry.entityId === patientACaseA));
  assert.ok(audits.some((entry) => entry.action === 'CASE_LIST_READ' && entry.entityId === doctorAId));
  assert.ok(audits.filter((entry) => entry.action === 'CASE_READ' && entry.entityId === patientACaseA).length >= 2);
});

test('patient projection never includes a DRAFT explanation', async () => {
  await prisma.explanationDraft.create({
    data: {
      caseId: patientACaseA,
      language: 'EN',
      text: 'DRAFT ONLY SECRET',
      source: ExplanationSource.TEMPLATE,
      status: ExplanationStatus.DRAFT,
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
  });
  const approvedAt = new Date(fixedTime.getTime() + 1000);
  await prisma.explanationDraft.create({
    data: {
      caseId: patientACaseA,
      language: 'EN',
      text: 'Approved patient-safe explanation.',
      source: ExplanationSource.TEMPLATE,
      status: ExplanationStatus.APPROVED,
      approvedBy: doctorAId,
      approvedAt,
      createdAt: approvedAt,
      updatedAt: approvedAt,
    },
  });

  const row = await prisma.screeningCase.findUniqueOrThrow({
    where: { id: patientACaseA },
    include: caseDetailInclude,
  });
  const { projectCaseForActor } = await import('../src/modules/cases/caseProjection');
  const dto = projectCaseForActor(row, actor(patientAUserId, 'PATIENT', null));
  assert.equal(dto.approvedExplanation?.status, 'APPROVED');
  assert.equal(dto.approvedExplanation?.text, 'Approved patient-safe explanation.');
  assert.equal(JSON.stringify(dto).includes('DRAFT ONLY SECRET'), false);
});

test('patient case detail separates a safe clinician note from explanation text', async () => {
  const createdAt = new Date(fixedTime.getTime() + 3000);
  await prisma.explanationDraft.create({ data: {
    caseId: patientACaseA,
    language: 'EN',
    text: JSON.stringify({ language: 'EN', sections: { resultMeaning: 'Safe explanation.', doctorNote: 'Please discuss the next step.' }, disclaimer: 'General information.' }),
    source: ExplanationSource.TEMPLATE,
    status: ExplanationStatus.APPROVED,
    approvedBy: doctorAId,
    approvedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  } });
  const row = await prisma.screeningCase.findUniqueOrThrow({ where: { id: patientACaseA }, include: caseDetailInclude });
  const { projectCaseForActor } = await import('../src/modules/cases/caseProjection');
  const dto = projectCaseForActor(row, actor(patientAUserId, 'PATIENT', null));
  assert.ok(dto.approvedExplanation);
  assert.equal(dto.approvedExplanation.text.includes('Please discuss the next step.'), false);
  assert.equal(dto.approvedExplanation.doctorNoteSection?.label, 'Not translated');
  assert.equal(dto.approvedExplanation.doctorNoteSection?.text, 'Please discuss the next step.');
});

test('patient case detail suppresses clinician notes containing digits or denylist terms', async () => {
  const createdAt = new Date(fixedTime.getTime() + 4000);
  await prisma.explanationDraft.create({ data: {
    caseId: patientACaseA,
    language: 'EN',
    text: JSON.stringify({ language: 'EN', sections: { resultMeaning: 'Safe.', doctorNote: 'Call 2 about aspirin.' }, disclaimer: 'Safe.' }),
    source: ExplanationSource.TEMPLATE,
    status: ExplanationStatus.APPROVED,
    approvedBy: doctorAId,
    approvedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  } });
  const row = await prisma.screeningCase.findUniqueOrThrow({ where: { id: patientACaseA }, include: caseDetailInclude });
  const { projectCaseForActor } = await import('../src/modules/cases/caseProjection');
  const dto = projectCaseForActor(row, actor(patientAUserId, 'PATIENT', null));
  assert.ok(dto.approvedExplanation);
  assert.equal(dto.approvedExplanation.text.includes('Call 2 about aspirin.'), false);
  assert.equal(dto.approvedExplanation.doctorNoteSection, null);
});

async function createUser(role: Role, name: string, providerId: string | null) {
  return prisma.user.create({
    data: {
      email: `${name}@example.test`,
      name,
      role,
      providerId,
      passwordHash: 'test-only-hash',
    },
  });
}

async function fetchAllCaseIds(requester: CaseActor): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await listCases(dependencies, requester, { limit: 100, cursor });
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return ids;
}

async function createStoredCase(
  patientId: string,
  originProviderId: string,
  createdById: string,
): Promise<string> {
  const row = await prisma.screeningCase.create({
    data: {
      patientId,
      originProviderId,
      createdById,
      pathway: 'Synthetic pathway',
      screeningType: 'Synthetic screening',
      resultCategory: 'Synthetic result category',
      resultSummaryApproved: 'Sensitive clinical result summary.',
      recommendedNextStep: 'Clinician-approved follow-up action.',
      intakeUrgency: Urgency.ROUTINE,
      urgencyLabel: Urgency.ROUTINE,
      state: CaseState.NEW,
      ownerUserId: createdById,
      dueAt: new Date(fixedTime.getTime() + 24 * 60 * 60 * 1000),
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
    select: { id: true },
  });
  return row.id;
}

function actor(userId: string, role: Role, providerId: string | null): CaseActor {
  return { userId, role, providerId };
}

function createEvidence(
  patientId: string,
  originProviderId: string,
  assignedDoctorId: string | undefined,
  intakeUrgency: Urgency = Urgency.ROUTINE,
): CreateCaseEvidence {
  const evidence: CreateCaseEvidence = {
    patientId,
    originProviderId,
    pathway: 'Synthetic pathway',
    screeningType: 'Synthetic screening',
    resultCategory: 'Synthetic result category',
    preliminarySummary: 'Preliminary intake summary.',
    recommendedAction: 'Recommended initial action.',
    intakeUrgency,
  };
  if (assignedDoctorId) evidence.assignedDoctorId = assignedDoctorId;
  return evidence;
}
