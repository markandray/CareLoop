import { Router, type NextFunction, type Request, type Response } from 'express';
import { CursorQuerySchema, ProviderCursorPageSchema, ProviderStaffCursorPageSchema, UuidSchema } from '@careloop/shared';
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
      const query = CursorQuerySchema.parse(req.query);
      const position = query.cursor ? decodeCursor(query.cursor) : undefined;
      const providers = await withTransaction(prisma, async (tx) => {
        const rows = await tx.provider.findMany({
          where: position ? { OR: [{ name: { gt: position.name } }, { name: position.name, id: { gt: position.id } }] } : {},
          select: { id: true, name: true, type: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: query.limit + 1,
        });
        await record(tx, { actorType: 'USER', actorId: req.user!.id, action: 'PROVIDER_LIST_READ', entityType: 'Provider', entityId: req.user!.id }, clock);
        return rows;
      });
      const hasMore = providers.length > query.limit;
      const items = hasMore ? providers.slice(0, query.limit) : providers;
      const last = items.at(-1);
      res.status(200).json(ProviderCursorPageSchema.parse({
        items, nextCursor: hasMore && last ? encodeCursor(last.name, last.id) : null, updatedAt: clock.now().toISOString(),
      }));
    } catch (error) { next(error); }
  });
  router.get('/:id/staff', requireRole('DOCTOR', 'COORDINATOR', 'ADMIN'), async (req, res, next) => {
    try {
      const query = CursorQuerySchema.parse(req.query);
      const position = query.cursor ? decodeCursor(query.cursor) : undefined;
      const parsedId = UuidSchema.safeParse(req.params.id);
      if (!parsedId.success) throw AppError.notFound('Provider not found.');
      const users = await withTransaction(prisma, async (tx) => {
        const provider = await tx.provider.findUnique({ where: { id: parsedId.data }, select: { id: true } });
        if (!provider) throw AppError.notFound('Provider not found.');
        const rows = await tx.user.findMany({
          where: {
            providerId: provider.id, role: { in: ['DOCTOR', 'COORDINATOR', 'ADMIN'] },
            ...(position ? { OR: [{ name: { gt: position.name } }, { name: position.name, id: { gt: position.id } }] } : {}),
          },
          select: { id: true, name: true, role: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: query.limit + 1,
        });
        await record(tx, { actorType: 'USER', actorId: req.user!.id, action: 'PROVIDER_STAFF_READ', entityType: 'Provider', entityId: provider.id }, clock);
        return rows;
      });
      const hasMore = users.length > query.limit;
      const items = hasMore ? users.slice(0, query.limit) : users;
      const last = items.at(-1);
      res.status(200).json(ProviderStaffCursorPageSchema.parse({
        items, nextCursor: hasMore && last ? encodeCursor(last.name, last.id) : null, updatedAt: clock.now().toISOString(),
      }));
    } catch (error) { next(error); }
  });
  return router;
}

function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify({ name, id })).toString('base64url');
}

function decodeCursor(cursor: string): { name: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { name?: unknown; id?: unknown };
    if (typeof parsed.name !== 'string' || typeof parsed.id !== 'string') throw new Error();
    return { name: parsed.name, id: parsed.id };
  } catch {
    throw AppError.validation('Invalid provider cursor.');
  }
}
