import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '../../core/clock';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { AppError } from '../../middleware/error/errorHandler';
import { getCase } from '../cases/caseService';
import { caseVisibility } from '../cases/caseVisibility';

export function createReferralRouter(prisma: PrismaClient, clock: Clock, authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void): Router {
  const router = Router();
  router.use(authenticate);
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
