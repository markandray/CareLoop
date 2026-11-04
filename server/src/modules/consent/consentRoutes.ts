import { Router, type NextFunction, type Request, type Response } from 'express';
import { GrantConsentRequestSchema, UuidSchema } from '@careloop/shared';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '../../core/clock';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { validateBody } from '../../middleware/validate/validateRequest';
import { AppError } from '../../middleware/error/errorHandler';
import { grantConsent, listConsents, revokeConsent } from './consentService';

export function createConsentRouter(prisma: PrismaClient, clock: Clock, authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void): Router {
  const router = Router();
  router.use(authenticate, requireRole('PATIENT'));
  router.get('/me/consents', async (req, res, next) => {
    try { res.status(200).json(await listConsents({ prisma, clock }, req.user!.id, req.query)); }
    catch (error) { next(error); }
  });
  router.post('/me/consents', validateBody(GrantConsentRequestSchema), async (req, res, next) => {
    try { res.status(201).json({ consent: await grantConsent({ prisma, clock }, req.user!.id, req.body) }); }
    catch (error) { next(error); }
  });
  router.post('/me/consents/:id/revoke', async (req, res, next) => {
    try {
      const id = UuidSchema.safeParse(req.params.id);
      if (!id.success) throw AppError.notFound('Consent not found.');
      res.status(200).json({ consent: await revokeConsent({ prisma, clock }, req.user!.id, id.data) });
    } catch (error) { next(error); }
  });
  return router;
}
