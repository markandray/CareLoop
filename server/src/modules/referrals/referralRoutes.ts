import { ActorType, CaseEventType, type PrismaClient } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { AppointmentDtoSchema, CursorQuerySchema, makeCursorPageSchema, ReferralDtoSchema, RejectReferralRequestSchema, UuidSchema } from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { dueAtFor } from '../../config/workflowConfig';
import { withTransaction } from '../../core/withTransaction';
import { appendEvent } from '../../core/eventLog';
import { record } from '../../core/audit';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { validateBody, validateQuery } from '../../middleware/validate/validateRequest';
import { AppError } from '../../middleware/error/errorHandler';
import { getCase } from '../cases/caseService';
import { caseVisibility } from '../cases/caseVisibility';
import { z } from 'zod';

export function createReferralRouter(prisma: PrismaClient, clock: Clock, authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/:id/appointments', validateQuery(CursorQuerySchema), async (req, res, next) => {
    try {
      const id = uuidParam(req.params.id);
      const page = CursorQuerySchema.parse(req.query);
      const position = page.cursor ? decodeCursor(page.cursor) : undefined;
      const result = await withTransaction(prisma, async (tx) => {
        const referral = await tx.referral.findFirst({ where: { id, screeningCase: { is: caseVisibility({ userId: req.user!.id, role: req.user!.role, providerId: req.user!.providerId }, clock.now()) } }, select: { id: true, caseId: true, fromProviderId: true, toProviderId: true } });
        if (!referral) throw AppError.notFound('Referral not found.');
        const rows = await tx.appointment.findMany({ where: { referralId: id, ...(position ? { OR: [{ createdAt: { lt: position.createdAt } }, { createdAt: position.createdAt, id: { lt: position.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.limit + 1 });
        await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'APPOINTMENT_LIST_READ', entityType: 'Referral', entityId: id }, clock);
        return rows;
      });
      res.status(200).json(pageResponse(result, page.limit, clock.now(), AppointmentDtoSchema));
    } catch (error) { next(error); }
  });
  router.post('/:id/reject', requireRole('DOCTOR', 'COORDINATOR'), validateBody(RejectReferralRequestSchema), async (req, res, next) => {
    try {
      const id = uuidParam(req.params.id);
      const result = await withTransaction(prisma, async (tx) => {
        const found = await tx.referral.findUnique({ where: { id }, select: { id: true, caseId: true, fromProviderId: true, toProviderId: true, status: true, screeningCase: { select: { patientId: true, state: true, intakeUrgency: true } } } });
        if (!found) throw AppError.notFound('Referral not found.');
        if (req.user!.providerId !== found.toProviderId) throw AppError.forbidden('Only the receiving provider may reject this referral.');
        if (found.fromProviderId !== found.toProviderId) {
          const now = clock.now();
          const consent = await tx.consent.findFirst({ where: { patientId: found.screeningCase.patientId, providerId: found.toProviderId, scope: 'CROSS_PROVIDER_REFERRAL', grantedAt: { lte: now }, OR: [{ revokedAt: null }, { revokedAt: { gt: now } }] }, select: { id: true } });
          if (!consent) throw new AppError(403, 'CONSENT_REQUIRED', 'Active cross-provider consent is required.');
        }
        await tx.$queryRaw`SELECT "id" FROM "ScreeningCase" WHERE "id" = ${found.caseId} FOR UPDATE`;
        const referral = await tx.referral.findUniqueOrThrow({ where: { id }, select: { status: true } });
        if (referral.status !== 'PENDING' || found.screeningCase.state !== 'REFERRAL_PENDING') throw AppError.conflict('Only a pending referral can be rejected.');
        const now = clock.now();
        const updated = await tx.referral.update({ where: { id }, data: { status: 'REJECTED', rejectionReason: req.body.rejectionReason, respondedAt: now, updatedAt: now } });
        await tx.screeningCase.update({ where: { id: found.caseId }, data: { ownerUserId: null, ownerQueueRole: 'COORDINATOR', ownerQueueProviderId: found.fromProviderId, dueAt: dueAtFor('rejectedReferralReassign', found.screeningCase.intakeUrgency, now), updatedAt: now } });
        const event = await appendEvent(tx, { caseId: found.caseId, type: CaseEventType.REFERRAL_REJECTED, actorType: ActorType.USER, actorId: req.user!.id, payload: { referralId: id, rejectionReason: req.body.rejectionReason, ...(req.body.note ? { note: req.body.note } : {}) } }, clock);
        await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'REFERRAL_REJECTED', entityType: 'Referral', entityId: id }, clock);
        return { referral: ReferralDtoSchema.parse({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(), respondedAt: updated.respondedAt?.toISOString() ?? null }), event: { id: event.id, type: event.type, createdAt: event.createdAt } };
      });
      res.status(200).json(result);
    } catch (error) { next(error); }
  });
  router.get('/:id/packet', requireRole('DOCTOR', 'COORDINATOR'), async (req, res, next) => {
    try {
      const referralId = Array.isArray(req.params.id) ? req.params.id[0] ?? '' : req.params.id;
      const now = clock.now();
      const referral = await prisma.referral.findFirst({
        where: {
          id: referralId,
          status: { not: 'SUPERSEDED' },
          screeningCase: { is: { AND: [caseVisibility({ userId: req.user!.id, role: req.user!.role, providerId: req.user!.providerId }, now)] } },
        },
        select: { id: true, caseId: true, toProviderId: true },
      });
      if (!referral || referral.toProviderId !== req.user!.providerId) throw AppError.notFound('Referral packet not found.');
      const projected = await getCase({ prisma, clock }, {
        userId: req.user!.id, role: req.user!.role, providerId: req.user!.providerId,
      }, referral.caseId);
      if (!('referralId' in projected) || projected.referralId !== referral.id) throw AppError.notFound('Referral packet not found.');
      res.status(200).json(projected);
    } catch (error) { next(error); }
  });
  return router;
}

function uuidParam(value: string | string[] | undefined): string {
  const parsed = UuidSchema.safeParse(Array.isArray(value) ? value[0] : value);
  if (!parsed.success) throw AppError.notFound('Referral not found.');
  return parsed.data;
}

function pageResponse<T extends z.ZodTypeAny>(rows: Array<Record<string, unknown>>, limit: number, now: Date, itemSchema: T) {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map((row) => itemSchema.parse({ ...row, createdAt: (row.createdAt as Date).toISOString(), updatedAt: (row.updatedAt as Date).toISOString(), scheduledAt: row.scheduledAt instanceof Date ? row.scheduledAt.toISOString() : row.scheduledAt }));
  const last = pageRows[pageRows.length - 1];
  return makeCursorPageSchema(itemSchema).parse({ items, nextCursor: hasMore && last ? encodeCursor(last.createdAt as Date, last.id as string) : null, updatedAt: now.toISOString() });
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt: string; id: string };
    const createdAt = new Date(decoded.createdAt);
    if (!decoded.id || Number.isNaN(createdAt.getTime())) throw new Error('invalid');
    return { createdAt, id: decoded.id };
  } catch { throw AppError.validation('Invalid pagination cursor.'); }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}
