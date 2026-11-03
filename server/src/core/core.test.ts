import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  ActorType,
  CaseEventType,
  CaseState,
  PrismaClient,
  ProviderType,
  Role,
  Urgency,
} from "@prisma/client";
import { DatabaseClock } from "./clock";
import { appendEvent } from "./eventLog";
import { record } from "./audit";
import { withTransaction } from "./withTransaction";

const prisma = new PrismaClient();
const fixedInstant = new Date("2026-11-03T10:00:00.000Z");
const clock = new DatabaseClock(
  prisma.systemSetting,
  () => new Date(fixedInstant),
);

interface CaseFixture {
  caseId: string;
  doctorId: string;
}

before(async () => {
  await prisma.$connect();
  await clock.initialize();
  await clock.reset();
});

after(async () => {
  await clock.reset();
  await prisma.$disconnect();
});

test("clock advance, reset, and persistence across a new instance", async () => {
  const initial = clock.now();
  const advanced = await clock.advance(90, "minutes");
  assert.equal(advanced.getTime() - initial.getTime(), 90 * 60_000);

  const restartedClock = new DatabaseClock(
    prisma.systemSetting,
    () => new Date(fixedInstant),
  );
  await restartedClock.initialize();
  assert.equal(restartedClock.now().getTime(), advanced.getTime());
  assert.equal((await restartedClock.reset()).getTime(), initial.getTime());
  await clock.reset();
});

test("appendEvent writes an append-only CaseEvent row", async () => {
  const fixture = await createCaseFixture();
  const event = await withTransaction(prisma, (tx) =>
    appendEvent(
      tx,
      {
        caseId: fixture.caseId,
        type: CaseEventType.CASE_CREATED,
        actorType: ActorType.USER,
        actorId: fixture.doctorId,
        toState: CaseState.NEW,
      },
      clock,
    ),
  );

  const stored = await prisma.caseEvent.findUnique({ where: { id: event.id } });
  assert.equal(stored?.caseId, fixture.caseId);
  assert.equal(stored?.actorType, ActorType.USER);
  assert.equal(stored?.createdAt.toISOString(), fixedInstant.toISOString());
});

test("record appends an AuditLog row", async () => {
  const fixture = await createCaseFixture();
  const audit = await withTransaction(prisma, (tx) =>
    record(
      tx,
      {
        actorType: ActorType.USER,
        actorId: fixture.doctorId,
        action: "CASE_READ",
        entityType: "ScreeningCase",
        entityId: fixture.caseId,
      },
      clock,
    ),
  );

  const stored = await prisma.auditLog.findUnique({ where: { id: audit.id } });
  assert.equal(stored?.actorId, fixture.doctorId);
  assert.equal(stored?.entityId, fixture.caseId);
  assert.equal(stored?.createdAt.toISOString(), fixedInstant.toISOString());
});

test("a failed audit write rolls back its event in the same transaction", async () => {
  const fixture = await createCaseFixture();
  const beforeCount = await prisma.caseEvent.count({
    where: { caseId: fixture.caseId },
  });

  await assert.rejects(
    withTransaction(prisma, async (tx) => {
      await appendEvent(
        tx,
        {
          caseId: fixture.caseId,
          type: CaseEventType.CASE_REVIEWED,
          actorType: ActorType.USER,
          actorId: fixture.doctorId,
        },
        clock,
      );
      await record(
        tx,
        {
          actorType: ActorType.USER,
          actorId: fixture.doctorId,
          action: "x".repeat(121),
          entityType: "ScreeningCase",
          entityId: fixture.caseId,
        },
        clock,
      );
    }),
  );

  assert.equal(
    await prisma.caseEvent.count({ where: { caseId: fixture.caseId } }),
    beforeCount,
  );
});

test("database triggers reject update and delete on CaseEvent", async () => {
  const fixture = await createCaseFixture();
  const event = await withTransaction(prisma, (tx) =>
    appendEvent(
      tx,
      {
        caseId: fixture.caseId,
        type: CaseEventType.CASE_CREATED,
        actorType: ActorType.USER,
        actorId: fixture.doctorId,
      },
      clock,
    ),
  );

  await assert.rejects(
    prisma.caseEvent.update({
      where: { id: event.id },
      data: { payload: { changed: true } },
    }),
  );
  await assert.rejects(prisma.caseEvent.delete({ where: { id: event.id } }));
});

test("USER actor without actorId is rejected in code and by PostgreSQL", async () => {
  const fixture = await createCaseFixture();
  assert.throws(
    () =>
      appendEvent(
        {} as never,
        {
          caseId: fixture.caseId,
          type: CaseEventType.CASE_CREATED,
          actorType: ActorType.USER,
        },
        clock,
      ),
    /actorId is required/,
  );
  assert.throws(
    () =>
      record(
        {} as never,
        {
          actorType: ActorType.USER,
          action: "test",
          entityType: "ScreeningCase",
          entityId: fixture.caseId,
        },
        clock,
      ),
    /actorId is required/,
  );

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "CaseEvent" ("id", "caseId", "type", "actorType", "actorId", "createdAt")
      VALUES (gen_random_uuid(), ${fixture.caseId}, 'CASE_CREATED', 'USER', NULL, ${clock.now()})
    `,
  );
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "actorType", "actorId", "action", "entityType", "entityId", "createdAt")
      VALUES (gen_random_uuid(), 'USER', NULL, 'test', 'ScreeningCase', ${fixture.caseId}, ${clock.now()})
    `,
  );
});

async function createCaseFixture(): Promise<CaseFixture> {
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const provider = await prisma.provider.create({
    data: { name: `T102 test ${suffix}`, type: ProviderType.SCREENING_CENTRE },
  });
  const doctor = await prisma.user.create({
    data: {
      email: `t102-doctor-${suffix}@example.test`,
      passwordHash: "test-only-hash",
      role: Role.DOCTOR,
      name: "T102 Test Doctor",
      providerId: provider.id,
    },
  });
  const patientUser = await prisma.user.create({
    data: {
      email: `t102-patient-${suffix}@example.test`,
      passwordHash: "test-only-hash",
      role: Role.PATIENT,
      name: "T102 Test Patient",
    },
  });
  const patient = await prisma.patient.create({
    data: {
      userId: patientUser.id,
      syntheticMrn: `T102-${suffix}`,
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
    },
  });
  const screeningCase = await prisma.screeningCase.create({
    data: {
      patientId: patient.id,
      originProviderId: provider.id,
      createdById: doctor.id,
      pathway: "T102 test pathway",
      screeningType: "T102 test screening",
      resultCategory: "T102 test category",
      intakeUrgency: Urgency.ROUTINE,
      state: CaseState.NEW,
      ownerUserId: doctor.id,
      dueAt: clock.now(),
      createdAt: clock.now(),
    },
  });
  return { caseId: screeningCase.id, doctorId: doctor.id };
}
