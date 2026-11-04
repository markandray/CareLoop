import { ActorType, CaseEventType, type PrismaClient } from '@prisma/client';
import { AppointmentDtoSchema, RecordAttendanceRequestSchema, UuidSchema } from '@careloop/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Clock } from '../../core/clock';
import { appendEvent } from '../../core/eventLog';
import { record } from '../../core/audit';
import { withTransaction } from '../../core/withTransaction';
import { dueAtFor } from '../../config/workflowConfig';
import { AppError } from '../../middleware/error/errorHandler';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { validateBody } from '../../middleware/validate/validateRequest';

export function createAppointmentRouter(
  prisma: PrismaClient,
  clock: Clock,
  authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): Router {
  const router = Router();
  router.use(authenticate);
  router.post('/:id/attendance', requireRole('COORDINATOR'), (req, _res, next) => {
    if (req.body?.status === 'MISSED' && !req.body.delayReason) return next(new AppError(422, 'DELAY_REASON_REQUIRED', 'A delayReason is required when an appointment is missed.'));
    next();
  }, validateBody(RecordAttendanceRequestSchema), async (req, res, next) => {
    try {
      const parsedId = UuidSchema.safeParse(req.params.id);
      if (!parsedId.success) throw AppError.notFound('Appointment not found.');
      const result = await withTransaction(prisma, async (tx) => {
        const appointment = await tx.appointment.findUnique({ where: { id: parsedId.data }, select: { id: true, referralId: true, scheduledAt: true, status: true, location: true, delayReason: true, attendedAt: true, createdAt: true, updatedAt: true, referral: { select: { caseId: true, fromProviderId: true, toProviderId: true, screeningCase: { select: { state: true, patientId: true, urgencyLabel: true, intakeUrgency: true } } } } } });
        if (!appointment) throw AppError.notFound('Appointment not found.');
        if (req.user!.providerId !== appointment.referral.toProviderId) throw AppError.forbidden('Only the receiving provider coordinator may record attendance.');
        const now = clock.now();
        if (appointment.referral.fromProviderId !== appointment.referral.toProviderId) {
          const consent = await tx.consent.findFirst({ where: { patientId: appointment.referral.screeningCase.patientId, providerId: appointment.referral.toProviderId, scope: 'CROSS_PROVIDER_REFERRAL', grantedAt: { lte: now }, OR: [{ revokedAt: null }, { revokedAt: { gt: now } }] }, select: { id: true } });
          if (!consent) throw new AppError(403, 'CONSENT_REQUIRED', 'Active cross-provider consent is required.');
        }
        await tx.$queryRaw`SELECT "id" FROM "ScreeningCase" WHERE "id" = ${appointment.referral.caseId} FOR UPDATE`;
        const fresh = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id }, select: { status: true } });
        if (fresh.status !== 'SCHEDULED' || appointment.referral.screeningCase.state !== 'APPOINTMENT_SCHEDULED') throw AppError.conflict('Only a scheduled appointment in APPOINTMENT_SCHEDULED can record attendance.');
        const input = RecordAttendanceRequestSchema.parse(req.body);
        const updated = await tx.appointment.update({ where: { id: appointment.id }, data: { status: input.status, attendedAt: input.status === 'ATTENDED' ? now : null, delayReason: input.status === 'MISSED' ? input.delayReason : null, updatedAt: now } });
        await tx.screeningCase.update({ where: { id: appointment.referral.caseId }, data: { dueAt: dueAtFor('appointmentRecovery', appointment.referral.screeningCase.urgencyLabel ?? appointment.referral.screeningCase.intakeUrgency, now), updatedAt: now } });
        const event = await appendEvent(tx, { caseId: appointment.referral.caseId, type: input.status === 'ATTENDED' ? CaseEventType.APPOINTMENT_ATTENDED : CaseEventType.APPOINTMENT_MISSED, actorType: ActorType.USER, actorId: req.user!.id, payload: { appointmentId: appointment.id, ...(input.status === 'MISSED' ? { delayReason: input.delayReason, ...(input.note ? { note: input.note } : {}) } : {}) } }, clock);
        if (input.status === 'MISSED') await appendEvent(tx, { caseId: appointment.referral.caseId, type: CaseEventType.DELAY_REASON_RECORDED, actorType: ActorType.USER, actorId: req.user!.id, payload: { action: 'APPOINTMENT_MISSED', appointmentId: appointment.id, delayReason: input.delayReason } }, clock);
        await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: input.status === 'ATTENDED' ? 'APPOINTMENT_ATTENDED' : 'APPOINTMENT_MISSED', entityType: 'Appointment', entityId: appointment.id }, clock);
        const dto = AppointmentDtoSchema.parse({ ...updated, scheduledAt: updated.scheduledAt.toISOString(), attendedAt: updated.attendedAt?.toISOString() ?? null, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
        return { appointment: dto, event: { id: event.id, type: event.type, createdAt: event.createdAt.toISOString() } };
      });
      res.status(200).json(result);
    } catch (error) { next(error); }
  });
  return router;
}
