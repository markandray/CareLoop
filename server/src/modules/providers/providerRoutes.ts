import { Router, type NextFunction, type Request, type Response } from 'express';
import { ProviderStaffDtoSchema, ProviderSummarySchema, UuidSchema } from '@careloop/shared';
import type { PrismaClient } from '@prisma/client';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { AppError } from '../../middleware/error/errorHandler';
import { record } from '../../core/audit';
import { withTransaction } from '../../core/withTransaction';
import type { Clock } from '../../core/clock';

export function createProviderRouter(prisma: PrismaClient, clock: Clock, authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', async (req, res, next) => {
    try {
      const providers = await withTransaction(prisma, async (tx) => {
        const rows = await tx.provider.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } });
        await record(tx, { actorType: 'USER', actorId: req.user!.id, action: 'PROVIDER_LIST_READ', entityType: 'Provider', entityId: req.user!.id }, clock);
        return rows;
      });
      res.status(200).json({ items: providers.map((provider) => ProviderSummarySchema.parse(provider)) });
    } catch (error) { next(error); }
  });
  router.get('/:id/staff', requireRole('DOCTOR', 'COORDINATOR', 'ADMIN'), async (req, res, next) => {
    try {
      const parsedId = UuidSchema.safeParse(req.params.id);
      if (!parsedId.success) throw AppError.notFound('Provider not found.');
      const users = await withTransaction(prisma, async (tx) => {
        const provider = await tx.provider.findUnique({ where: { id: parsedId.data }, select: { id: true } });
        if (!provider) throw AppError.notFound('Provider not found.');
        const rows = await tx.user.findMany({ where: { providerId: provider.id, role: { in: ['DOCTOR', 'COORDINATOR', 'ADMIN'] } }, select: { id: true, name: true, role: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
        await record(tx, { actorType: 'USER', actorId: req.user!.id, action: 'PROVIDER_STAFF_READ', entityType: 'Provider', entityId: provider.id }, clock);
        return rows;
      });
      res.status(200).json({ items: users.map((user) => ProviderStaffDtoSchema.parse(user)) });
    } catch (error) { next(error); }
  });
  return router;
}
