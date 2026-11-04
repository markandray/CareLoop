import { ActorType, CaseEventType, type PrismaClient } from '@prisma/client';
import { ContactAttemptDtoSchema, ContactAttemptRequestSchema, CursorQuerySchema, makeCursorPageSchema, UuidSchema } from '@careloop/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Clock } from '../../core/clock';
import { appendEvent } from '../../core/eventLog';
import { record } from '../../core/audit';
import { withTransaction } from '../../core/withTransaction';
import { AppError } from '../../middleware/error/errorHandler';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { validateBody, validateQuery } from '../../middleware/validate/validateRequest';
import { queueNotification } from '../notifications/notificationService';
import { raiseEscalation } from '../escalation/raiseEscalation';
import { workflowConfig } from '../../config/workflowConfig';

export function createContactAttemptRouter(
  prisma: PrismaClient,
  clock: Clock,
  authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): Router {
  const router = Router();
  router.use(authenticate, requireRole('COORDINATOR'));

  router.post('/:id/contact-attempts', validateBody(ContactAttemptRequestSchema), async (req, res, next) => {
    try {
      const parsed = UuidSchema.safeParse(req.params.id);
      if (!parsed.success) throw AppError.notFound('Case not found.');
      const result = await withTransaction(prisma, async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ScreeningCase" WHERE "id" = ${parsed.data} FOR UPDATE`;
        const caseRecord = await tx.screeningCase.findUnique({ where: { id: parsed.data }, select: { id: true, state: true, patientId: true, originProviderId: true } });
        if (!caseRecord || caseRecord.state === 'CLOSED') throw AppError.notFound('Open case not found.');
        const now = clock.now();
        const isOrigin = req.user!.providerId === caseRecord.originProviderId;
        const referrals = await tx.referral.findMany({ where: { caseId: caseRecord.id, status: { not: 'SUPERSEDED' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, fromProviderId: true, toProviderId: true, status: true } });
        const currentReferral = referrals[0] ?? null;
        const isLiveReceiving = Boolean(currentReferral && currentReferral.toProviderId === req.user!.providerId && ['PENDING', 'ACCEPTED'].includes(currentReferral.status));
        if (!isOrigin && !isLiveReceiving) throw AppError.notFound('Open case not found.');
        if (isLiveReceiving && currentReferral && currentReferral.fromProviderId !== currentReferral.toProviderId) {
          const consent = await tx.consent.findFirst({ where: { patientId: caseRecord.patientId, providerId: currentReferral.toProviderId, scope: 'CROSS_PROVIDER_REFERRAL', grantedAt: { lte: now }, OR: [{ revokedAt: null }, { revokedAt: { gt: now } }] }, select: { id: true } });
          if (!consent) throw new AppError(403, 'CONSENT_REQUIRED', 'Active cross-provider consent is required.');
        }
        const currentAppointment = caseRecord.state === 'APPOINTMENT_SCHEDULED' && currentReferral
          ? await tx.appointment.findFirst({ where: { referralId: currentReferral.id, status: { in: ['SCHEDULED', 'MISSED'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } })
          : null;
        const input = ContactAttemptRequestSchema.parse(req.body);
        const attempt = await tx.contactAttempt.create({ data: {
          caseId: caseRecord.id,
          byUserId: req.user!.id,
          milestoneState: caseRecord.state,
          referralId: currentReferral?.id ?? null,
          appointmentId: currentAppointment?.id ?? null,
          channel: input.channel,
          outcome: input.outcome,
          delayReason: input.delayReason ?? null,
          notes: input.notes ?? null,
          createdAt: now,
        } });
        await appendEvent(tx, { caseId: caseRecord.id, type: CaseEventType.CONTACT_ATTEMPT_LOGGED, actorType: ActorType.USER, actorId: req.user!.id, payload: { contactAttemptId: attempt.id, milestoneState: attempt.milestoneState, referralId: attempt.referralId, appointmentId: attempt.appointmentId, channel: attempt.channel, outcome: attempt.outcome, delayReason: attempt.delayReason } }, clock);
        if (input.outcome === 'FAILED' || input.outcome === 'NO_ANSWER') {
          await queueNotification(tx, clock, { caseId: caseRecord.id, templateKey: 'unreachable_retry', actor: { actorType: ActorType.USER, actorId: req.user!.id } });
          const failedCount = await tx.contactAttempt.count({ where: { caseId: caseRecord.id, milestoneState: caseRecord.state, referralId: currentReferral?.id ?? null, appointmentId: currentAppointment?.id ?? null, outcome: { in: ['FAILED', 'NO_ANSWER'] } } });
          if (failedCount === workflowConfig.thresholds.failedContactAttempts) await raiseEscalation(tx, { caseId: caseRecord.id, level: 'LEVEL_2', reason: 'Three failed contact attempts for the current workflow milestone.', now }, clock);
        }
        await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'CONTACT_ATTEMPT_LOGGED', entityType: 'ContactAttempt', entityId: attempt.id }, clock);
        return contactAttemptDto(attempt);
      });
      res.status(201).json({ contactAttempt: result });
    } catch (error) { next(error); }
  });

  router.get('/:id/contact-attempts', validateQuery(CursorQuerySchema), async (req, res, next) => {
    try {
      const parsed = UuidSchema.safeParse(req.params.id);
      if (!parsed.success) throw AppError.notFound('Case not found.');
      const query = CursorQuerySchema.parse(req.query);
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
      const result = await withTransaction(prisma, async (tx) => {
        const caseRecord = await tx.screeningCase.findUnique({ where: { id: parsed.data }, select: { id: true, originProviderId: true } });
        if (!caseRecord) throw AppError.notFound('Case not found.');
        const isOrigin = req.user!.providerId === caseRecord.originProviderId;
        if (!isOrigin) {
          const live = await tx.referral.findFirst({ where: { caseId: caseRecord.id, toProviderId: req.user!.providerId ?? '00000000-0000-0000-0000-000000000000', status: { in: ['PENDING', 'ACCEPTED'] } }, select: { id: true } });
          if (!live) throw AppError.notFound('Case not found.');
        }
        const rows = await tx.contactAttempt.findMany({ where: { caseId: caseRecord.id, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
        await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'CONTACT_ATTEMPT_LIST_READ', entityType: 'ScreeningCase', entityId: caseRecord.id }, clock);
        return rows;
      });
      const hasMore = result.length > query.limit;
      const rows = hasMore ? result.slice(0, query.limit) : result;
      const items = rows.map(contactAttemptDto);
      const last = rows[rows.length - 1];
      res.status(200).json(makeCursorPageSchema(ContactAttemptDtoSchema).parse({ items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null, updatedAt: clock.now().toISOString() }));
    } catch (error) { next(error); }
  });

  return router;
}

function contactAttemptDto(row: { id: string; caseId: string; byUserId: string; milestoneState: 'NEW' | 'CLINICIAN_REVIEWED' | 'CONFIRMATION_PENDING' | 'REFERRAL_PENDING' | 'REFERRAL_ACCEPTED' | 'APPOINTMENT_SCHEDULED' | 'CARE_STARTED' | 'CLOSED'; referralId: string | null; appointmentId: string | null; channel: 'PHONE' | 'SMS' | 'EMAIL' | 'PORTAL'; outcome: 'REACHED' | 'NO_ANSWER' | 'FAILED'; delayReason: 'PATIENT_UNREACHABLE' | 'PROVIDER_DELAY' | 'NO_SLOT_AVAILABLE' | 'APPOINTMENT_RESCHEDULED' | 'PATIENT_DECLINED' | 'DOCUMENTATION_PENDING' | 'TRANSPORT_OR_LOGISTICS' | 'OTHER' | null; notes: string | null; createdAt: Date }) {
  return ContactAttemptDtoSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt: string; id: string };
    const createdAt = new Date(value.createdAt);
    if (!value.id || Number.isNaN(createdAt.getTime())) throw new Error('invalid');
    return { createdAt, id: value.id };
  } catch { throw AppError.validation('Invalid pagination cursor.'); }
}
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}
