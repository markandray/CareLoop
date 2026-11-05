import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AttentionListQuerySchema, CaseIdSchema } from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { validateQuery } from '../../middleware/validate/validateRequest';
import { AppError } from '../../middleware/error/errorHandler';
import { getAttention, listAttention } from './attentionService';

export function createAttentionRouter(prisma: PrismaClient, clock: Clock, authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/attention/cases', requireRole('DOCTOR', 'COORDINATOR', 'ADMIN'), validateQuery(AttentionListQuerySchema), async (req, res, next) => {
    try {
      const actor = { userId: req.user!.id, role: req.user!.role, providerId: req.user!.providerId };
      res.status(200).json(await listAttention({ prisma, clock }, actor, AttentionListQuerySchema.parse(req.query)));
    } catch (error) { next(error); }
  });
  router.get('/cases/:id/attention', requireRole('DOCTOR', 'COORDINATOR', 'ADMIN'), async (req, res, next) => {
    try {
      const id = CaseIdSchema.safeParse(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      if (!id.success) throw AppError.notFound('Case not found.');
      const actor = { userId: req.user!.id, role: req.user!.role, providerId: req.user!.providerId };
      res.status(200).json(await getAttention({ prisma, clock }, actor, id.data));
    } catch (error) { next(error); }
  });
  return router;
}
