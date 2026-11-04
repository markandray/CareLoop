import {
  ActorType,
  CaseEventType,
  NotificationStatus,
  type NotificationTemplateKey,
  type Prisma,
} from '@prisma/client';
import type { Clock } from '../../core/clock';
import { appendEvent } from '../../core/eventLog';

export interface NotificationActor {
  actorType: ActorType;
  actorId?: string | null;
}

/** Creates an outbox row; all templates except result_reviewed are immediately sent. */
export async function queueNotification(
  tx: Prisma.TransactionClient,
  clock: Clock,
  input: { caseId: string; templateKey: NotificationTemplateKey; actor: NotificationActor },
) {
  const patient = await tx.screeningCase.findUniqueOrThrow({
    where: { id: input.caseId },
    select: {
      patientId: true,
      patient: { select: { userId: true, preferredLanguage: true, preferredChannel: true } },
    },
  });
  const queued = await tx.notification.create({
    data: {
      caseId: input.caseId,
      userId: patient.patient.userId,
      channel: patient.patient.preferredChannel,
      language: patient.patient.preferredLanguage,
      templateKey: input.templateKey,
      status: NotificationStatus.QUEUED,
      createdAt: clock.now(),
    },
  });
  if (input.templateKey === 'result_reviewed') return queued;
  return sendNotification(tx, clock, queued.id, input.actor);
}

/** Marks a queued notification sent and appends its timeline event atomically. */
export async function sendNotification(
  tx: Prisma.TransactionClient,
  clock: Clock,
  notificationId: string,
  actor: NotificationActor,
) {
  const notification = await tx.notification.findUniqueOrThrow({
    where: { id: notificationId },
    select: { id: true, caseId: true, templateKey: true, status: true },
  });
  const sentAt = clock.now();
  const sent = await tx.notification.update({
    where: { id: notification.id },
    data: { status: NotificationStatus.SENT, sentAt },
  });
  await tx.screeningCase.updateMany({
    where: { id: notification.caseId, notifiedAt: null },
    data: { notifiedAt: sentAt },
  });
  await appendEvent(tx, {
    caseId: notification.caseId,
    type: CaseEventType.NOTIFICATION_SENT,
    actorType: actor.actorType,
    actorId: actor.actorId,
    payload: { templateKey: notification.templateKey },
  }, clock);
  return sent;
}
