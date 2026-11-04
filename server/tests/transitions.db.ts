import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  ActorType,
  AppointmentStatus,
  CaseEventType,
  CaseState,
  ExplanationSource,
  ExplanationStatus,
  PrismaClient,
  ProviderType,
  Role,
} from '@prisma/client';
import {
  TransitionEvidenceSchemas,
  TransitionKeySchema,
  type TransitionEvidenceByKey,
  type TransitionKey,
  type TransitionRequest,
} from '@careloop/shared';
import type { Clock } from '../src/core/clock';
import { appendEvent } from '../src/core/eventLog';
import { executeTransition, type TransitionServiceDependencies } from '../src/modules/cases/transitionService';
import { getCase } from '../src/modules/cases/caseService';
import { evaluateTransition } from '../src/core/stateMachine/evaluateTransition';
import { transitionTable } from '../src/core/stateMachine/transitionTable';
import { loadFacts } from '../src/modules/cases/transitionFacts';
import type { CaseActor } from '../src/modules/cases/caseVisibility';

const prisma = new PrismaClient();
const now = new Date('2026-11-04T10:00:00.000Z');
const clock: Clock = {
  now: () => new Date(now),
  advance: async () => new Date(now),
  reset: async () => new Date(now),
};
const dependencies: TransitionServiceDependencies = { prisma, clock };
const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
let originId: string;
let receivingId: string;
let alternateId: string;
let doctorOrigin: string;
let coordinatorOrigin: string;
let doctorReceiving: string;
let coordinatorReceiving: string;
let doctorAlternate: string;
let patientId: string;

before(async () => {
  await prisma.$connect();
  const [origin, receiving, alternate] = await Promise.all([
    provider('origin'), provider('receiving'), provider('alternate'),
  ]);
  originId = origin.id;
  receivingId = receiving.id;
  alternateId = alternate.id;
  const [doctorA, coordinatorA, doctorB, coordinatorB, doctorC, patientUser] = await Promise.all([
    user('DOCTOR', 'doctor-origin', originId),
    user('COORDINATOR', 'coordinator-origin', originId),
    user('DOCTOR', 'doctor-receiving', receivingId),
    user('COORDINATOR', 'coordinator-receiving', receivingId),
    user('DOCTOR', 'doctor-alternate', alternateId),
    user('PATIENT', 'patient', null),
  ]);
  doctorOrigin = doctorA.id;
  coordinatorOrigin = coordinatorA.id;
  doctorReceiving = doctorB.id;
  coordinatorReceiving = coordinatorB.id;
  doctorAlternate = doctorC.id;
  const patient = await prisma.patient.create({
    data: {
      userId: patientUser.id,
      syntheticMrn: `T105-${suffix}`,
      dateOfBirth: new Date('1980-01-01T00:00:00.000Z'),
      preferredLanguage: 'EN',
    },
  });
  patientId = patient.id;
  await prisma.consent.createMany({
    data: [receivingId, alternateId].map((providerId) => ({
      patientId,
      providerId,
      scope: 'CROSS_PROVIDER_REFERRAL' as const,
      grantedAt: now,
    })),
  });
});

after(async () => prisma.$disconnect());

test('full referral-to-care path persists state, owner, dueAt, events, and receiving packet', async () => {
  const item = await makeCase('NEW', true, 'REFERRAL', doctorOrigin);
  const [english, arabic] = await approvedExplanations(item.id);
  await seedReviewedSent(item.id);

  await executeTransition(dependencies, actor(doctorOrigin, 'DOCTOR', originId), item.id, request(
    'REVIEW_CASE', 'NEW', { approvedExplanationIds: [english, arabic] },
  ));
  await assertCase(item.id, 'CLINICIAN_REVIEWED', 'COORDINATOR', originId, 24 * 60 * 60_000);

  await executeTransition(dependencies, actor(coordinatorOrigin, 'COORDINATOR', originId), item.id, request(
    'CREATE_REFERRAL_FROM_REVIEW', 'CLINICIAN_REVIEWED', {
      toProviderId: receivingId, referralReason: 'Requested specialist assessment',
    },
  ));
  const referral = await prisma.referral.findFirstOrThrow({ where: { caseId: item.id } });
  await assertCase(item.id, 'REFERRAL_PENDING', 'COORDINATOR', receivingId, 3 * 24 * 60 * 60_000);

  const accepted = await executeTransition(
    dependencies,
    actor(doctorReceiving, 'DOCTOR', receivingId),
    item.id,
    request('ACCEPT_REFERRAL', 'REFERRAL_PENDING', { referralId: referral.id }),
  );
  assert.equal('resultSummaryApproved' in accepted.case, false);
  assert.equal('resultCategory' in accepted.case, false);
  assert.equal('approvedExplanation' in accepted.case, true);
  assert.equal(accepted.event.payload, null);
  const acceptedReferral = await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } });
  assert.equal(acceptedReferral.status, 'ACCEPTED');
  assert.equal(acceptedReferral.respondedAt?.toISOString(), now.toISOString());
  await assertCase(item.id, 'REFERRAL_ACCEPTED', 'COORDINATOR', receivingId, 7 * 24 * 60 * 60_000);

  const scheduledAt = new Date(now.getTime() + 5 * 24 * 60 * 60_000);
  await executeTransition(dependencies, actor(coordinatorReceiving, 'COORDINATOR', receivingId), item.id,
    request('SCHEDULE_APPOINTMENT', 'REFERRAL_ACCEPTED', {
      scheduledAt: scheduledAt.toISOString(), location: 'Receiving clinic, room 2',
    }));
  let appointment = await prisma.appointment.findFirstOrThrow({ where: { referralId: referral.id } });
  assert.equal(appointment.scheduledAt.toISOString(), scheduledAt.toISOString());
  await assertCase(item.id, 'APPOINTMENT_SCHEDULED', 'COORDINATOR', receivingId, 2 * 24 * 60 * 60_000, scheduledAt);

  await prisma.appointment.update({ where: { id: appointment.id }, data: { status: AppointmentStatus.ATTENDED } });
  await executeTransition(dependencies, actor(doctorReceiving, 'DOCTOR', receivingId), item.id,
    request('START_CARE', 'APPOINTMENT_SCHEDULED', {
      carePlan: 'Care plan recorded by receiving clinician',
      followUpAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
  await assertCase(item.id, 'CARE_STARTED', 'DOCTOR', receivingId, 30 * 24 * 60 * 60_000);

  const closed = await executeTransition(dependencies, actor(doctorReceiving, 'DOCTOR', receivingId), item.id,
    request('CLOSE_COMPLETED_CARE', 'CARE_STARTED', {
      closureReason: 'COMPLETED_CARE',
      documentedReason: 'Recommended care was completed.',
      careCompletionSummary: 'Care completed.',
    }));
  assert.equal('resultSummaryApproved' in closed.case, false);
  const finalCase = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(finalCase.state, CaseState.CLOSED);
  assert.equal(finalCase.closureReason, 'COMPLETED_CARE');
  assert.equal(finalCase.closedAt?.toISOString(), now.toISOString());
  assert.equal(finalCase.ownerUserId, null);
  assert.equal(finalCase.ownerQueueRole, null);
  assert.equal(finalCase.dueAt, null);
  assert.ok(await prisma.evidence.findFirst({ where: { caseId: item.id, kind: 'CLINICIAN_SIGN_OFF', recordedBy: doctorReceiving } }));

  const lifecycle = await prisma.caseEvent.findMany({ where: { caseId: item.id } });
  assert.equal(lifecycle.length, 7); // Includes the pre-seeded result_reviewed dispatch fact.
  for (const eventType of [
    CaseEventType.CASE_REVIEWED,
    CaseEventType.REFERRAL_CREATED,
    CaseEventType.REFERRAL_ACCEPTED,
    CaseEventType.APPOINTMENT_SCHEDULED,
    CaseEventType.CARE_STARTED,
    CaseEventType.CASE_CLOSED,
  ]) {
    assert.equal(lifecycle.filter((event) => event.type === eventType).length, 1);
  }
  assert.equal(await prisma.notification.count({ where: { caseId: item.id, status: 'QUEUED' } }), 1);
});

test('rejected referral reassignment supersedes the old row and resets ownership and SLA', async () => {
  const item = await makeCase('NEW', true, 'REFERRAL', doctorOrigin);
  const [english, arabic] = await approvedExplanations(item.id);
  await seedReviewedSent(item.id);
  await executeTransition(dependencies, actor(doctorOrigin, 'DOCTOR', originId), item.id,
    request('REVIEW_CASE', 'NEW', { approvedExplanationIds: [english, arabic] }));
  await executeTransition(dependencies, actor(coordinatorOrigin, 'COORDINATOR', originId), item.id,
    request('CREATE_REFERRAL_FROM_REVIEW', 'CLINICIAN_REVIEWED', {
      toProviderId: receivingId, referralReason: 'First provider referral',
    }));
  const first = await prisma.referral.findFirstOrThrow({ where: { caseId: item.id } });
  await prisma.referral.update({
    where: { id: first.id },
    data: { status: 'REJECTED', respondedAt: now, rejectionReason: 'No capacity' },
  });
  await prisma.screeningCase.update({ where: { id: item.id }, data: { dueAt: new Date(now.getTime() - 1000) } });
  await executeTransition(dependencies, actor(coordinatorOrigin, 'COORDINATOR', originId), item.id,
    { ...request('REASSIGN_REFERRAL', 'REFERRAL_PENDING', {
      toProviderId: alternateId, referralReason: 'Referred to alternate provider',
    }), delayReason: 'PROVIDER_DELAY' });
  const refs = await prisma.referral.findMany({ where: { caseId: item.id }, orderBy: { createdAt: 'asc' } });
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.status, 'SUPERSEDED');
  assert.equal(refs[0]?.respondedAt?.toISOString(), now.toISOString());
  assert.equal(refs[1]?.status, 'PENDING');
  assert.equal(refs[1]?.toProviderId, alternateId);
  const packet = await getCase({ prisma, clock }, actor(doctorAlternate, 'DOCTOR', alternateId), item.id);
  assert.equal('resultCategory' in packet, false);
  assert.equal('resultSummaryApproved' in packet, false);
  assert.equal('approvedExplanation' in packet, true);
  assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).reassignmentCount, 1);
  await assertCase(item.id, 'REFERRAL_PENDING', 'COORDINATOR', alternateId, 3 * 24 * 60 * 60_000);
  const delayEvent = await prisma.caseEvent.findFirstOrThrow({
    where: { caseId: item.id, type: 'DELAY_REASON_RECORDED' },
  });
  assert.deepEqual(delayEvent.payload, {
    transitionKey: 'REASSIGN_REFERRAL',
    reason: 'PROVIDER_DELAY',
    overdueDurationMs: 1000,
    entityType: 'Referral',
    entityId: refs[0]?.id,
  });
});

test('rescheduling allows SCHEDULED or MISSED only and preserves prior status semantics', async () => {
  for (const priorStatus of ['SCHEDULED', 'MISSED'] as const) {
    const item = await makeCase('APPOINTMENT_SCHEDULED', false, null, doctorReceiving);
    await approvedExplanations(item.id);
    const referral = await prisma.referral.create({
      data: {
        caseId: item.id,
        fromProviderId: originId,
        toProviderId: receivingId,
        status: 'ACCEPTED',
        respondedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    const previous = await prisma.appointment.create({
      data: {
        referralId: referral.id,
        scheduledAt: new Date(now.getTime() + 24 * 60 * 60_000),
        status: priorStatus,
        location: 'Prior location',
        delayReason: priorStatus === 'MISSED' ? 'PATIENT_UNREACHABLE' : null,
        createdAt: now,
        updatedAt: now,
      },
    });
    const newScheduledAt = new Date(now.getTime() + 10 * 24 * 60 * 60_000);
    await executeTransition(
      dependencies,
      actor(coordinatorReceiving, 'COORDINATOR', receivingId),
      item.id,
      {
        ...request('RESCHEDULE_APPOINTMENT', 'APPOINTMENT_SCHEDULED', {
          scheduledAt: newScheduledAt.toISOString(),
          location: 'New location',
        }),
        delayReason: 'APPOINTMENT_RESCHEDULED',
      },
    );
    const previousAfter = await prisma.appointment.findUniqueOrThrow({ where: { id: previous.id } });
    const created = await prisma.appointment.findMany({ where: { referralId: referral.id, id: { not: previous.id } } });
    assert.equal(previousAfter.status, priorStatus === 'SCHEDULED' ? 'RESCHEDULED' : 'MISSED');
    assert.equal(
      previousAfter.delayReason,
      priorStatus === 'SCHEDULED' ? 'APPOINTMENT_RESCHEDULED' : 'PATIENT_UNREACHABLE',
    );
    assert.equal(created.length, 1);
    assert.equal(created[0]?.status, 'SCHEDULED');
    assert.equal(created[0]?.scheduledAt.toISOString(), newScheduledAt.toISOString());
    assert.equal(created[0]?.location, 'New location');
    assert.equal(created[0]?.delayReason, 'APPOINTMENT_RESCHEDULED');
    await assertCase(item.id, 'APPOINTMENT_SCHEDULED', 'COORDINATOR', receivingId, 2 * 24 * 60 * 60_000, newScheduledAt);
  }

  const attendedCase = await makeCase('APPOINTMENT_SCHEDULED', false, null, doctorReceiving);
  const referral = await prisma.referral.create({
    data: {
      caseId: attendedCase.id,
      fromProviderId: originId,
      toProviderId: receivingId,
      status: 'ACCEPTED',
      respondedAt: now,
    },
  });
  const attended = await prisma.appointment.create({
    data: { referralId: referral.id, scheduledAt: now, status: 'ATTENDED' },
  });
  const before = await counts(attendedCase.id);
  await assertCode(
    executeTransition(dependencies, actor(coordinatorReceiving, 'COORDINATOR', receivingId), attendedCase.id, {
      ...request('RESCHEDULE_APPOINTMENT', 'APPOINTMENT_SCHEDULED', {
        scheduledAt: new Date(now.getTime() + 5 * 24 * 60 * 60_000).toISOString(),
        location: 'Replacement location',
      }),
      delayReason: 'APPOINTMENT_RESCHEDULED',
    }),
    'EVIDENCE_MISSING',
  );
  assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: attended.id } })).status, 'ATTENDED');
  await assertCounts(attendedCase.id, before);
});

test('wrong role, stale state, missing closure fact, and coordinator closure write nothing', async () => {
  const item = await makeCase('NEW', true, 'REFERRAL', doctorOrigin);
  const baseline = await counts(item.id);
  await assertCode(executeTransition(dependencies, actor(coordinatorOrigin, 'COORDINATOR', originId), item.id,
    request('REVIEW_CASE', 'NEW', { approvedExplanationIds: [randomUUID(), randomUUID()] })), 'FORBIDDEN');
  await assertCounts(item.id, baseline);
  await assertCode(executeTransition(dependencies, actor(doctorOrigin, 'DOCTOR', originId), item.id,
    request('REVIEW_CASE', 'CLOSED', { approvedExplanationIds: [randomUUID(), randomUUID()] })), 'CONFLICT');
  await assertCounts(item.id, baseline);

  const care = await makeCase('CARE_STARTED', false, null, doctorReceiving, receivingId);
  const careReferral = await prisma.referral.create({
    data: {
      caseId: care.id,
      fromProviderId: originId,
      toProviderId: receivingId,
      status: 'ACCEPTED',
      respondedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  const careBefore = await counts(care.id);
  await assertCode(executeTransition(dependencies, actor(doctorReceiving, 'DOCTOR', receivingId), care.id,
    request('CLOSE_COMPLETED_CARE', 'CARE_STARTED', {
      closureReason: 'COMPLETED_CARE', documentedReason: 'Done', careCompletionSummary: 'Completed',
    })), 'EVIDENCE_MISSING');
  assert.equal((await prisma.referral.findUniqueOrThrow({ where: { id: careReferral.id } })).status, 'ACCEPTED');
  await assertCounts(care.id, careBefore);
  const beforeCoordinator = await counts(care.id);
  await assertCode(executeTransition(dependencies, actor(coordinatorReceiving, 'COORDINATOR', receivingId), care.id,
    request('CLOSE_COMPLETED_CARE', 'CARE_STARTED', {
      closureReason: 'COMPLETED_CARE', documentedReason: 'Done', careCompletionSummary: 'Completed',
    })), 'FORBIDDEN');
  await assertCounts(care.id, beforeCoordinator);
});

test('case row lock permits exactly one of two identical concurrent transitions', async () => {
  const item = await makeCase('NEW', true, 'REFERRAL', doctorOrigin);
  const [english, arabic] = await approvedExplanations(item.id);
  const transition = request('REVIEW_CASE', 'NEW', { approvedExplanationIds: [english, arabic] });
  const outcomes = await Promise.allSettled([
    executeTransition(dependencies, actor(doctorOrigin, 'DOCTOR', originId), item.id, transition),
    executeTransition(dependencies, actor(doctorOrigin, 'DOCTOR', originId), item.id, transition),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
  assert.equal(await prisma.caseEvent.count({ where: { caseId: item.id, type: 'CASE_REVIEWED' } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { entityId: item.id, action: 'CASE_TRANSITION_REVIEW_CASE' } }), 1);
});

test('audit failure rolls the transition back atomically', async () => {
  const item = await makeCase('NEW', true, 'REFERRAL', doctorOrigin);
  const [english, arabic] = await approvedExplanations(item.id);
  const before = await counts(item.id);
  const failing: TransitionServiceDependencies = {
    ...dependencies,
    auditWriter: async () => { throw new Error('simulated audit failure'); },
  };
  await assert.rejects(executeTransition(failing, actor(doctorOrigin, 'DOCTOR', originId), item.id,
    request('REVIEW_CASE', 'NEW', { approvedExplanationIds: [english, arabic] })), /simulated audit failure/);
  assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).state, 'NEW');
  await assertCounts(item.id, before);
});

test('every transition key persists the evaluator outcome and exactly its owned rows', async (t) => {
  const keys = TransitionKeySchema.options.filter(
    (key): key is Exclude<TransitionKey, 'CREATE_CASE'> => key !== 'CREATE_CASE',
  );
  assert.equal(TransitionKeySchema.options.length, 25);
  assert.equal(keys.length, 24);
  assert.ok(TransitionKeySchema.options.includes('CREATE_CASE'));
  for (const key of keys) {
    await t.test(key, async () => {
      const fixture = await prepareTransitionFixture(key);
      const actorUser = transitionActor(key);
      const transitionEvidence = evidenceForTransition(key, fixture.explanationIds, fixture.referralId);
      const requestPayload = {
        transitionKey: key,
        expectedState: transitionTable[key].from,
        evidence: transitionEvidence,
        ...(key === 'RESCHEDULE_APPOINTMENT' ? { delayReason: 'APPOINTMENT_RESCHEDULED' } : {}),
      } as unknown as TransitionRequest;
      const beforeCounts = await counts(fixture.caseId);
      const beforeEvidenceIds = new Set((await prisma.evidence.findMany({
        where: { caseId: fixture.caseId }, select: { id: true },
      })).map((row) => row.id));
      const beforeEventIds = new Set((await prisma.caseEvent.findMany({
        where: { caseId: fixture.caseId }, select: { id: true },
      })).map((row) => row.id));
      const beforeNotificationIds = new Set((await prisma.notification.findMany({
        where: { caseId: fixture.caseId }, select: { id: true },
      })).map((row) => row.id));

      const initial = await prisma.screeningCase.findUniqueOrThrow({ where: { id: fixture.caseId } });
      const loaded = await prisma.$transaction((tx) => loadFacts(
        tx,
        initial,
        key,
        { userId: actorUser.userId, role: actorUser.role, providerId: actorUser.providerId },
        { now, evidence: transitionEvidence },
      ));
      const expected = evaluateTransition({
        transitionKey: key,
        expectedState: initial.state,
        actor: { userId: actorUser.userId, role: actorUser.role, providerId: actorUser.providerId },
        case: {
          state: initial.state,
          originProviderId: initial.originProviderId,
          sendingProviderId: loaded.currentReferral?.fromProviderId,
          receivingProviderId: loaded.currentReferral?.toProviderId,
          ownerUserId: initial.ownerUserId,
          intakeUrgency: initial.intakeUrgency,
          urgencyLabel: key === 'REVIEW_CASE' ? initial.reviewDraftUrgencyLabel : initial.urgencyLabel,
        },
        facts: loaded.facts,
        evidence: transitionEvidence,
        delayReason: key === 'RESCHEDULE_APPOINTMENT' ? 'APPOINTMENT_RESCHEDULED' : undefined,
        now,
      });
      assert.equal(expected.ok, true, `${key} fixture must satisfy evaluator preconditions`);
      if (!expected.ok) return;

      const result = await executeTransition(dependencies, actorUser, fixture.caseId, requestPayload);
      assert.equal(result.event.type, expected.eventType);
      const after = await prisma.screeningCase.findUniqueOrThrow({ where: { id: fixture.caseId } });
      assert.equal(after.state, expected.newState);
      assert.equal(after.dueAt?.toISOString() ?? null, expected.dueAt?.toISOString() ?? null);
      assertOwnerMatches(after, expected.owner);
      if (expected.newState === 'CLOSED') {
        assert.equal(after.closureReason, transitionTable[key].closureReason);
        assert.equal(after.closedAt?.toISOString(), now.toISOString());
      } else {
        assert.equal(after.closureReason, null);
        assert.equal(after.closedAt, null);
      }

      const newEvents = (await prisma.caseEvent.findMany({ where: { caseId: fixture.caseId } }))
        .filter((event) => !beforeEventIds.has(event.id));
      assert.equal(newEvents.filter((event) => event.type === expected.eventType).length, 1);
      assert.equal(newEvents.length, 1 + (key === 'RESCHEDULE_APPOINTMENT' ? 1 : 0));

      const newEvidence = (await prisma.evidence.findMany({ where: { caseId: fixture.caseId } }))
        .filter((evidence) => !beforeEvidenceIds.has(evidence.id));
      const expectedKinds = evidenceKindsForTransition(key);
      assert.deepEqual(newEvidence.map((row) => row.kind).sort(), expectedKinds.sort());
      if (key.startsWith('CLOSE_')) {
        const signOff = newEvidence.find((row) => row.kind === 'CLINICIAN_SIGN_OFF');
        assert.ok(signOff);
        assert.equal(signOff.recordedBy, actorUser.userId);
        assert.equal((signOff.details as { clinicianSignOff?: { clinicianId?: string } }).clinicianSignOff?.clinicianId, actorUser.userId);
      }

      const newNotifications = (await prisma.notification.findMany({ where: { caseId: fixture.caseId } }))
        .filter((notification) => !beforeNotificationIds.has(notification.id));
      if (expected.notificationTemplate) {
        assert.equal(newNotifications.length, 1);
        assert.equal(newNotifications[0]?.templateKey, expected.notificationTemplate);
        assert.equal(newNotifications[0]?.status, expected.notificationTemplate === 'result_reviewed' ? 'QUEUED' : 'SENT');
      } else {
        assert.equal(newNotifications.length, 0);
      }
      assert.equal(await prisma.auditLog.count({
        where: { entityId: fixture.caseId, action: `CASE_TRANSITION_${key}`, actorId: actorUser.userId },
      }), 1);

      const afterCounts = await counts(fixture.caseId);
      assert.equal(afterCounts.events - beforeCounts.events, 1 + (key === 'RESCHEDULE_APPOINTMENT' ? 1 : 0));
      assert.equal(afterCounts.evidence - beforeCounts.evidence, expectedKinds.length);
      assert.equal(afterCounts.notifications - beforeCounts.notifications, expected.notificationTemplate ? 1 : 0);
      assert.equal(afterCounts.audits - beforeCounts.audits, 1);
      assert.equal(afterCounts.referrals - beforeCounts.referrals,
        key === 'CREATE_REFERRAL_FROM_REVIEW' || key === 'CREATE_REFERRAL_AFTER_CONFIRMATION' || key === 'REASSIGN_REFERRAL' ? 1 : 0);
      assert.equal(afterCounts.appointments - beforeCounts.appointments,
        key === 'SCHEDULE_APPOINTMENT' || key === 'RESCHEDULE_APPOINTMENT' ? 1 : 0);

      if (key === 'CREATE_REFERRAL_FROM_REVIEW' || key === 'CREATE_REFERRAL_AFTER_CONFIRMATION' || key === 'REASSIGN_REFERRAL') {
        const eventRow = newEvents.find((event) => event.type === expected.eventType);
        const eventPayload = eventRow?.payload as { referralId?: string } | null;
        assert.ok(eventPayload?.referralId);
        const createdReferral = await prisma.referral.findUniqueOrThrow({ where: { id: eventPayload.referralId } });
        assert.equal(createdReferral.reason, (transitionEvidence as { referralReason: string }).referralReason);
        assert.equal(createdReferral.status, 'PENDING');
      }
      if (key === 'SCHEDULE_APPOINTMENT' || key === 'RESCHEDULE_APPOINTMENT') {
        const eventRow = newEvents.find((event) => event.type === expected.eventType);
        const eventPayload = eventRow?.payload as { appointmentId?: string } | null;
        assert.ok(eventPayload?.appointmentId);
        const createdAppointment = await prisma.appointment.findUniqueOrThrow({ where: { id: eventPayload.appointmentId } });
        assert.equal(createdAppointment.location, (transitionEvidence as { location: string }).location);
        assert.equal(createdAppointment.status, 'SCHEDULED');
      }
    });
  }
});

test('confirmation route can close NOT_CONFIRMED or proceed to referral after confirmation', async () => {
  for (const branch of ['CLOSE_NOT_CONFIRMED', 'CREATE_REFERRAL_AFTER_CONFIRMATION'] as const) {
    const item = await makeCase('NEW', true, 'CONFIRMATION', doctorOrigin);
    const explanationIds = await approvedExplanations(item.id);
    await seedReviewedSent(item.id);
    await executeTransition(dependencies, actor(doctorOrigin, 'DOCTOR', originId), item.id,
      request('REVIEW_CASE', 'NEW', { approvedExplanationIds: explanationIds }));
    await executeTransition(dependencies, actor(coordinatorOrigin, 'COORDINATOR', originId), item.id,
      request('REQUEST_CONFIRMATION', 'CLINICIAN_REVIEWED', {}));
    assert.equal((await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } })).state, 'CONFIRMATION_PENDING');
    await prisma.evidence.create({
      data: {
        caseId: item.id,
        kind: 'CONFIRMATORY_RESULT',
        recordedBy: doctorOrigin,
        details: { result: 'confirmatory result recorded' },
        createdAt: now,
      },
    });
    if (branch === 'CLOSE_NOT_CONFIRMED') {
      await executeTransition(dependencies, actor(doctorOrigin, 'DOCTOR', originId), item.id,
        request('CLOSE_NOT_CONFIRMED', 'CONFIRMATION_PENDING', {
          closureReason: 'NOT_CONFIRMED', documentedReason: 'The finding was not confirmed.',
        }));
      const closed = await prisma.screeningCase.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(closed.state, 'CLOSED');
      assert.equal(closed.closureReason, 'NOT_CONFIRMED');
    } else {
      await executeTransition(dependencies, actor(doctorOrigin, 'DOCTOR', originId), item.id,
        request('CREATE_REFERRAL_AFTER_CONFIRMATION', 'CONFIRMATION_PENDING', {
          toProviderId: receivingId,
          referralReason: 'Confirmed finding requires specialty care.',
        }));
      const referral = await prisma.referral.findFirstOrThrow({ where: { caseId: item.id } });
      assert.equal(referral.status, 'PENDING');
      assert.equal(referral.reason, 'Confirmed finding requires specialty care.');
    }
  }
});

test('receiving-provider transition response never contains clinical or origin-only content at any depth', async () => {
  const item = await makeCase('REFERRAL_PENDING', false, 'REFERRAL', doctorOrigin);
  await approvedExplanations(item.id);
  const referral = await prisma.referral.create({
    data: {
      caseId: item.id,
      fromProviderId: originId,
      toProviderId: receivingId,
      status: 'PENDING',
      reason: 'Patient-safe referral reason.',
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.evidence.create({
    data: {
      caseId: item.id,
      kind: 'SCREENING_INTAKE',
      recordedBy: doctorOrigin,
      details: {
        preliminarySummary: 'PRIVATE_PRELIMINARY_SUMMARY',
        originOnlyNotes: 'PRIVATE_ORIGIN_ONLY_NOTES',
      },
      createdAt: now,
    },
  });
  await prisma.screeningCase.update({
    where: { id: item.id },
    data: {
      resultCategory: 'PRIVATE_RESULT_CATEGORY',
      resultSummaryApproved: 'PRIVATE_RESULT_SUMMARY',
      reviewDraftSummary: null,
      reviewDraftNextStep: null,
      reviewDraftUrgencyLabel: null,
    },
  });
  const response = await executeTransition(
    dependencies,
    actor(doctorReceiving, 'DOCTOR', receivingId),
    item.id,
    request('ACCEPT_REFERRAL', 'REFERRAL_PENDING', { referralId: referral.id }),
  );
  const serialized = JSON.stringify(response);
  for (const forbidden of [
    'resultCategory',
    'resultSummaryApproved',
    'preliminarySummary',
    'originOnlyNotes',
    'PRIVATE_RESULT_CATEGORY',
    'PRIVATE_RESULT_SUMMARY',
    'PRIVATE_PRELIMINARY_SUMMARY',
    'PRIVATE_ORIGIN_ONLY_NOTES',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `receiving response leaked ${forbidden}`);
  }
});

async function provider(label: string) {
  return prisma.provider.create({ data: { name: `T105 ${label} ${suffix}`, type: ProviderType.HOSPITAL } });
}

async function prepareTransitionFixture(key: Exclude<TransitionKey, 'CREATE_CASE'>) {
  const definition = transitionTable[key];
  const state = definition.from as CaseState;
  const route = key === 'REQUEST_CONFIRMATION'
    ? 'CONFIRMATION'
    : key === 'REVIEW_CASE' || key === 'CREATE_REFERRAL_FROM_REVIEW'
      ? 'REFERRAL'
      : null;
  const withDraft = key === 'REVIEW_CASE' || key === 'REQUEST_CONFIRMATION' || key === 'CREATE_REFERRAL_FROM_REVIEW';
  const item = await makeCase(state, withDraft, route, doctorOrigin);
  const explanationIds = await approvedExplanations(item.id);
  await seedReviewedSent(item.id);

  let referralId: string | null = null;
  if (['REFERRAL_PENDING', 'REFERRAL_ACCEPTED', 'APPOINTMENT_SCHEDULED', 'CARE_STARTED'].includes(state)) {
    const status = key === 'REASSIGN_REFERRAL'
      ? 'REJECTED'
      : state === 'REFERRAL_PENDING'
        ? 'PENDING'
        : 'ACCEPTED';
    const referral = await prisma.referral.create({
      data: {
        caseId: item.id,
        fromProviderId: originId,
        toProviderId: receivingId,
        status,
        rejectionReason: status === 'REJECTED' ? 'Synthetic rejection reason' : null,
        respondedAt: status === 'PENDING' ? null : now,
        createdAt: now,
        updatedAt: now,
      },
    });
    referralId = referral.id;
  }

  let appointmentId: string | null = null;
  if (state === 'APPOINTMENT_SCHEDULED' || state === 'CARE_STARTED') {
    assert.ok(referralId);
    const status = state === 'CARE_STARTED' || key === 'START_CARE' ? 'ATTENDED' : 'SCHEDULED';
    const appointment = await prisma.appointment.create({
      data: {
        referralId,
        scheduledAt: new Date(now.getTime() + 5 * 24 * 60 * 60_000),
        status,
        location: 'Synthetic appointment location',
        delayReason: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    appointmentId = appointment.id;
  }

  if (key === 'CLOSE_NOT_CONFIRMED' || key === 'CREATE_REFERRAL_AFTER_CONFIRMATION') {
    await prisma.evidence.create({
      data: {
        caseId: item.id,
        kind: 'CONFIRMATORY_RESULT',
        recordedBy: doctorOrigin,
        details: { result: 'Synthetic confirmatory result' },
        createdAt: now,
      },
    });
  }
  if (key.includes('PATIENT_DECLINED')) {
    await prisma.evidence.create({
      data: {
        caseId: item.id,
        kind: 'PATIENT_DECLINE',
        recordedBy: doctorOrigin,
        details: { documentedReason: 'Synthetic patient decline' },
        createdAt: now,
      },
    });
  }
  if (key.includes('UNREACHABLE')) {
    await prisma.evidence.create({
      data: {
        caseId: item.id,
        kind: 'ESCALATION_RECORD',
        recordedBy: doctorOrigin,
        details: { level: 'LEVEL_1' },
        createdAt: now,
      },
    });
    for (let index = 0; index < 3; index += 1) {
      await prisma.contactAttempt.create({
        data: {
          caseId: item.id,
          byUserId: coordinatorOrigin,
          milestoneState: state,
          referralId: state === 'REFERRAL_PENDING' ? referralId : null,
          appointmentId: state === 'APPOINTMENT_SCHEDULED' ? appointmentId : null,
          channel: 'PHONE',
          outcome: 'FAILED',
          createdAt: now,
        },
      });
    }
  }
  return { caseId: item.id, explanationIds, referralId, appointmentId };
}

function transitionActor(key: Exclude<TransitionKey, 'CREATE_CASE'>): CaseActor {
  const definition = transitionTable[key];
  const role = definition.allowedRoles[0];
  assert.ok(role);
  const relationship = definition.providerRules[role];
  const providerId = relationship === 'RECEIVING_PROVIDER'
    ? receivingId
    : relationship === 'ANY'
      ? null
      : originId;
  const userId = role === 'COORDINATOR'
    ? providerId === receivingId ? coordinatorReceiving : coordinatorOrigin
    : providerId === receivingId ? doctorReceiving : doctorOrigin;
  return actor(userId, role, providerId);
}

function evidenceForTransition(
  key: Exclude<TransitionKey, 'CREATE_CASE'>,
  explanationIds: [string, string],
  referralId: string | null,
): Record<string, unknown> {
  let value: Record<string, unknown>;
  if (key === 'REVIEW_CASE') value = { approvedExplanationIds: explanationIds };
  else if (key === 'REQUEST_CONFIRMATION') value = {};
  else if (key === 'CREATE_REFERRAL_FROM_REVIEW' || key === 'CREATE_REFERRAL_AFTER_CONFIRMATION') {
    value = { toProviderId: receivingId, referralReason: `Reason for ${key}` };
  } else if (key === 'REASSIGN_REFERRAL') {
    value = { toProviderId: alternateId, referralReason: 'Reassigned to alternate provider' };
  } else if (key === 'ACCEPT_REFERRAL') {
    assert.ok(referralId);
    value = { referralId };
  } else if (key === 'SCHEDULE_APPOINTMENT' || key === 'RESCHEDULE_APPOINTMENT') {
    value = {
      scheduledAt: new Date(now.getTime() + 10 * 24 * 60 * 60_000).toISOString(),
      location: `Location for ${key}`,
    };
  } else if (key === 'START_CARE') {
    value = {
      carePlan: 'Synthetic care plan',
      followUpAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
    };
  } else if (key === 'CLOSE_NOT_CONFIRMED') {
    value = { closureReason: 'NOT_CONFIRMED', documentedReason: 'Synthetic result was not confirmed.' };
  } else if (key.includes('PATIENT_DECLINED')) {
    value = { closureReason: 'PATIENT_DECLINED', documentedReason: 'Patient chose to decline.' };
  } else if (key.includes('UNREACHABLE')) {
    value = { closureReason: 'UNREACHABLE_AFTER_ATTEMPTS', documentedReason: 'Three attempts failed.' };
  } else if (key === 'CLOSE_COMPLETED_CARE') {
    value = {
      closureReason: 'COMPLETED_CARE',
      documentedReason: 'Care completed.',
      careCompletionSummary: 'Synthetic completion evidence.',
    };
  } else {
    value = {
      closureReason: 'TRANSFERRED_OUT',
      documentedReason: 'Transfer documented.',
      externalProviderName: 'Synthetic external provider',
      facilityContact: 'Synthetic facility contact',
      handoverSummary: 'Synthetic handover.',
    };
  }
  return TransitionEvidenceSchemas[key].parse(value) as Record<string, unknown>;
}

function evidenceKindsForTransition(key: Exclude<TransitionKey, 'CREATE_CASE'>): string[] {
  let kinds: string[];
  if (key === 'REVIEW_CASE') kinds = ['APPROVED_CLINICAL_PLAN', 'APPROVED_EXPLANATION'];
  else if (key === 'REQUEST_CONFIRMATION') kinds = ['CONFIRMATION_TASK_CREATED'];
  else if (key === 'CREATE_REFERRAL_FROM_REVIEW' || key === 'CREATE_REFERRAL_AFTER_CONFIRMATION') kinds = ['REFERRAL_CREATED'];
  else if (key === 'ACCEPT_REFERRAL') kinds = ['REFERRAL_ACCEPTANCE'];
  else if (key === 'REASSIGN_REFERRAL') kinds = ['REFERRAL_REASSIGNMENT'];
  else if (key === 'SCHEDULE_APPOINTMENT' || key === 'RESCHEDULE_APPOINTMENT') kinds = ['APPOINTMENT_SCHEDULED'];
  else if (key === 'START_CARE') kinds = ['CARE_PLAN'];
  else if (key === 'CLOSE_NOT_CONFIRMED') kinds = ['CONFIRMATORY_RESULT'];
  else if (key === 'CLOSE_COMPLETED_CARE') kinds = ['CARE_COMPLETION'];
  else if (key.includes('PATIENT_DECLINED')) kinds = ['PATIENT_DECLINE'];
  else if (key.includes('UNREACHABLE')) kinds = ['UNREACHABLE_STATUS'];
  else kinds = ['EXTERNAL_TRANSFER'];
  if (key.startsWith('CLOSE_')) kinds.push('CLINICIAN_SIGN_OFF');
  return kinds;
}

function assertOwnerMatches(
  row: { ownerUserId: string | null; ownerQueueRole: Role | null; ownerQueueProviderId: string | null },
  expected: { kind: 'USER' | 'QUEUE' | 'UNASSIGNED'; userId?: string; role?: Role; providerId?: string },
) {
  if (expected.kind === 'USER') {
    assert.equal(row.ownerUserId, expected.userId);
    assert.equal(row.ownerQueueRole, null);
    assert.equal(row.ownerQueueProviderId, null);
  } else if (expected.kind === 'QUEUE') {
    assert.equal(row.ownerUserId, null);
    assert.equal(row.ownerQueueRole, expected.role);
    assert.equal(row.ownerQueueProviderId, expected.providerId);
  } else {
    assert.equal(row.ownerUserId, null);
    assert.equal(row.ownerQueueRole, null);
    assert.equal(row.ownerQueueProviderId, null);
  }
}

async function user(role: Role, label: string, providerId: string | null) {
  return prisma.user.create({
    data: { email: `${label}-${suffix}@example.test`, name: `${label} ${suffix}`, role, providerId, passwordHash: 'test-hash' },
  });
}

async function makeCase(
  state: CaseState,
  withDraft: boolean,
  route: 'REFERRAL' | 'CONFIRMATION' | null,
  ownerUserId: string | null,
  caseProviderId = originId,
) {
  const row = await prisma.screeningCase.create({
    data: {
      patientId,
      originProviderId: caseProviderId,
      createdById: doctorOrigin,
      pathway: 'Synthetic adult screening pathway',
      screeningType: 'Comprehensive screening',
      resultCategory: 'Actionable finding',
      resultSummaryApproved: state === 'NEW' ? null : 'Clinician approved summary',
      recommendedNextStep: state === 'NEW' ? null : 'Follow-up next step',
      reviewDraftSummary: withDraft ? 'Draft approved summary' : null,
      reviewDraftNextStep: withDraft ? 'Draft next step' : null,
      reviewDraftUrgencyLabel: withDraft ? 'ROUTINE' : null,
      reviewRoute: route,
      intakeUrgency: 'ROUTINE',
      urgencyLabel: state === 'NEW' ? null : 'ROUTINE',
      state,
      ownerUserId,
      ownerQueueRole: null,
      ownerQueueProviderId: null,
      dueAt: new Date(now.getTime() + 2 * 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    },
  });
  return row;
}

async function approvedExplanations(caseId: string): Promise<[string, string]> {
  const common = {
    caseId,
    text: 'Approved patient explanation',
    source: ExplanationSource.TEMPLATE,
    status: ExplanationStatus.APPROVED,
    approvedBy: doctorOrigin,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  } as const;
  const en = await prisma.explanationDraft.create({ data: { ...common, language: 'EN' } });
  const ar = await prisma.explanationDraft.create({
    data: { ...common, language: 'AR', createdAt: new Date(now.getTime() + 1), updatedAt: new Date(now.getTime() + 1) },
  });
  return [en.id, ar.id];
}

async function seedReviewedSent(caseId: string) {
  await prisma.$transaction((tx) => appendEvent(tx, {
    caseId,
    type: CaseEventType.NOTIFICATION_SENT,
    actorType: ActorType.SYSTEM,
    payload: { templateKey: 'result_reviewed' },
  }, clock));
}

function actor(userId: string, role: Role, providerId: string | null): CaseActor {
  return { userId, role, providerId };
}

function request<K extends Exclude<TransitionKey, 'CREATE_CASE'>>(
  transitionKey: K,
  expectedState: CaseState,
  evidence: TransitionEvidenceByKey[K],
): TransitionRequest {
  return { transitionKey, expectedState, evidence } as unknown as TransitionRequest;
}

async function assertCase(
  id: string,
  state: CaseState,
  ownerRole: Role,
  providerId: string,
  durationMs: number,
  dueBase = now,
) {
  const row = await prisma.screeningCase.findUniqueOrThrow({ where: { id } });
  assert.equal(row.state, state);
  assert.equal(row.ownerQueueRole, ownerRole);
  assert.equal(row.ownerQueueProviderId, providerId);
  assert.equal(row.ownerUserId, null);
  assert.equal(row.dueAt?.toISOString(), new Date(dueBase.getTime() + durationMs).toISOString());
}

async function counts(caseId: string) {
  const [events, evidence, notifications, audits, referrals, appointments] = await Promise.all([
    prisma.caseEvent.count({ where: { caseId } }),
    prisma.evidence.count({ where: { caseId } }),
    prisma.notification.count({ where: { caseId } }),
    prisma.auditLog.count({ where: { entityId: caseId } }),
    prisma.referral.count({ where: { caseId } }),
    prisma.appointment.count({ where: { referral: { caseId } } }),
  ]);
  return { events, evidence, notifications, audits, referrals, appointments };
}

async function assertCounts(caseId: string, expected: Awaited<ReturnType<typeof counts>>) {
  assert.deepEqual(await counts(caseId), expected);
}

async function assertCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}
