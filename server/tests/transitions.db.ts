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
import type { TransitionEvidenceByKey, TransitionKey, TransitionRequest } from '@careloop/shared';
import type { Clock } from '../src/core/clock';
import { appendEvent } from '../src/core/eventLog';
import { executeTransition, type TransitionServiceDependencies } from '../src/modules/cases/transitionService';
import { getCase } from '../src/modules/cases/caseService';
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
  assert.equal(await prisma.notification.count({ where: { caseId: item.id, status: 'QUEUED' } }), 6);
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

async function provider(label: string) {
  return prisma.provider.create({ data: { name: `T105 ${label} ${suffix}`, type: ProviderType.HOSPITAL } });
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
