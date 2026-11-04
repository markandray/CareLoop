import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  ActorType,
  CaseEventType,
  NotificationStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  AcknowledgeNotificationRequestSchema,
  CursorQuerySchema,
  makeCursorPageSchema,
  NotificationDtoSchema,
  NotificationTemplateKeySchema,
  UuidSchema,
} from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { record } from '../../core/audit';
import { appendEvent } from '../../core/eventLog';
import { withTransaction } from '../../core/withTransaction';
import { AppError } from '../../middleware/error/errorHandler';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { caseVisibility } from '../cases/caseVisibility';
import { getNotificationTemplate } from './templateCatalog';
import { sendNotification } from './notificationService';

export function createNotificationRouter(
  prisma: PrismaClient,
  clock: Clock,
  authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', async (req, res, next) => {
    try {
      const query = CursorQuerySchema.parse(req.query);
      const position = query.cursor ? decodeCursor(query.cursor) : undefined;
      const actor = req.user!;
      const rows = await withTransaction(prisma, async (tx) => {
        const visibility = caseVisibility({ userId: actor.id, role: actor.role, providerId: actor.providerId }, clock.now());
        const where: Prisma.NotificationWhereInput = {
          screeningCase: { is: visibility },
          ...(actor.role === 'PATIENT' ? { userId: actor.id } : {}),
          ...(position ? { OR: [
            { createdAt: { lt: position.createdAt } },
            { createdAt: position.createdAt, id: { lt: position.id } },
          ] } : {}),
        };
        const found = await tx.notification.findMany({
          where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
          select: { id: true, caseId: true, channel: true, language: true, templateKey: true, status: true, createdAt: true, sentAt: true },
        });
        await record(tx, { actorType: ActorType.USER, actorId: actor.id, action: 'NOTIFICATION_LIST_READ', entityType: 'Notification', entityId: actor.id }, clock);
        return found;
      });
      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map(toNotificationDto);
      const last = rows[query.limit - 1];
      res.status(200).json(makeCursorPageSchema(NotificationDtoSchema).parse({
        items,
        nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        updatedAt: clock.now().toISOString(),
      }));
    } catch (error) { next(error); }
  });

  router.post('/:id/dispatch', requireRole('COORDINATOR'), async (req, res, next) => {
    try {
      const id = parseNotificationId(req.params.id);
      const result = await withTransaction(prisma, async (tx) => {
        const notification = await tx.notification.findFirst({
          where: { id, screeningCase: { is: { originProviderId: req.user!.providerId ?? '00000000-0000-0000-0000-000000000000' } } },
          select: { id: true, caseId: true, userId: true, templateKey: true, status: true },
        });
        if (!notification) throw AppError.notFound('Notification not found.');
        if (notification.templateKey !== 'result_reviewed') throw AppError.conflict('Only result_reviewed notifications may be dispatched manually.');
        if (notification.status === NotificationStatus.SENT) throw AppError.conflict('Notification has already been sent.');
        const approved = await tx.explanationDraft.findFirst({ where: { caseId: notification.caseId, status: 'APPROVED' }, select: { id: true } });
        if (!approved) throw new AppError(422, 'EVIDENCE_MISSING', 'An approved explanation is required before dispatch.');
        await tx.$queryRaw`SELECT "id" FROM "ScreeningCase" WHERE "id" = ${notification.caseId} FOR UPDATE`;
        // Recheck after locking the case so simultaneous dispatches cannot both succeed.
        const current = await tx.notification.findUniqueOrThrow({ where: { id }, select: { status: true } });
        if (current.status === NotificationStatus.SENT) throw AppError.conflict('Notification has already been sent.');
        const sent = await sendNotification(tx, clock, id, { actorType: ActorType.USER, actorId: req.user!.id });
        const audit = await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'NOTIFICATION_DISPATCHED', entityType: 'Notification', entityId: id }, clock);
        const event = await tx.caseEvent.findFirstOrThrow({ where: { caseId: notification.caseId, type: CaseEventType.NOTIFICATION_SENT, payload: { path: ['templateKey'], equals: 'result_reviewed' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        return { notification: toNotificationDto({ ...sent, caseId: notification.caseId }), event: { id: event.id, type: event.type, createdAt: event.createdAt, auditId: audit.id } };
      });
      res.status(200).json(result);
    } catch (error) { next(error); }
  });

  router.post('/:id/acknowledge', requireRole('PATIENT'), validateAcknowledge, async (req, res, next) => {
    try {
      const id = parseNotificationId(req.params.id);
      const result = await withTransaction(prisma, async (tx) => {
        const notification = await tx.notification.findFirst({ where: { id, userId: req.user!.id }, select: { id: true, caseId: true, status: true } });
        if (!notification) throw AppError.notFound('Notification not found.');
        if (notification.status !== NotificationStatus.SENT) throw AppError.conflict('Notification has not been sent.');
        await tx.$queryRaw`SELECT "id" FROM "ScreeningCase" WHERE "id" = ${notification.caseId} FOR UPDATE`;
        const caseRecord = await tx.screeningCase.findUniqueOrThrow({ where: { id: notification.caseId }, select: { patientId: true, acknowledgedAt: true, patient: { select: { userId: true } } } });
        if (caseRecord.patient.userId !== req.user!.id) throw AppError.notFound('Notification not found.');
        if (caseRecord.acknowledgedAt) throw AppError.conflict('Case notification has already been acknowledged.');
        const now = clock.now();
        await tx.screeningCase.update({ where: { id: notification.caseId }, data: { acknowledgedAt: now } });
        const event = await appendEvent(tx, { caseId: notification.caseId, type: CaseEventType.NOTIFICATION_ACKNOWLEDGED, actorType: ActorType.USER, actorId: req.user!.id, payload: { notificationId: id } }, clock);
        await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'NOTIFICATION_ACKNOWLEDGED', entityType: 'Notification', entityId: id }, clock);
        return { acknowledgedAt: now.toISOString(), event: { id: event.id, type: event.type, createdAt: event.createdAt.toISOString() } };
      });
      res.status(200).json(result);
    } catch (error) { next(error); }
  });
  return router;
}

export function toNotificationDto(row: { id: string; caseId: string; channel: 'PHONE' | 'SMS' | 'EMAIL' | 'PORTAL'; language: 'EN' | 'AR' | 'OTHER'; templateKey: (typeof NotificationTemplateKeySchema.options)[number]; status: 'QUEUED' | 'SENT'; createdAt: Date; sentAt: Date | null }) {
  const template = getNotificationTemplate(row.templateKey, row.language);
  return NotificationDtoSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), sentAt: row.sentAt?.toISOString() ?? null, text: template.text, clinicallyReviewed: template.clinicallyReviewed });
}

function parseNotificationId(value: string | string[]): string {
  const parsed = UuidSchema.safeParse(Array.isArray(value) ? value[0] : value);
  if (!parsed.success) throw AppError.notFound('Notification not found.');
  return parsed.data;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    if (typeof value.createdAt !== 'string' || typeof value.id !== 'string') throw new Error();
    const createdAt = new Date(value.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error();
    return { createdAt, id: value.id };
  } catch { throw AppError.validation('Invalid notification cursor.'); }
}

function validateAcknowledge(req: Request, _res: Response, next: NextFunction): void {
  const parsed = AcknowledgeNotificationRequestSchema.safeParse(req.body);
  if (!parsed.success) return next(AppError.validation('Acknowledgement request must be empty.', parsed.error.flatten()));
  next();
}
