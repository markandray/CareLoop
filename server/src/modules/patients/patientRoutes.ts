import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { PatientSearchPageSchema, PatientSearchQuerySchema } from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { record } from '../../core/audit';
import { withTransaction } from '../../core/withTransaction';
import { AppError } from '../../middleware/error/errorHandler';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { validateQuery } from '../../middleware/validate/validateRequest';

export function createPatientRouter(prisma: PrismaClient, clock: Clock, authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', requireRole('DOCTOR', 'ADMIN'), validateQuery(PatientSearchQuerySchema), async (req, res, next) => {
    try {
      const query = PatientSearchQuerySchema.parse(req.query);
      const position = query.cursor ? decodeCursor(query.cursor) : undefined;
      const rows = await withTransaction(prisma, async (tx) => {
        const items = await tx.patient.findMany({
          where: {
            AND: [
              { OR: [
                { user: { name: { contains: query.query, mode: 'insensitive' } } },
                { syntheticMrn: { startsWith: query.query, mode: 'insensitive' } },
              ] },
              ...(position ? [{ OR: [
                { user: { name: { gt: position.displayName } } },
                { user: { name: position.displayName }, id: { gt: position.id } },
              ] }] : []),
            ],
          },
          select: { id: true, syntheticMrn: true, preferredLanguage: true, user: { select: { name: true } } },
          orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }],
          take: query.limit + 1,
        });
        // Search terms can contain personal identifiers, so the audit records the actor, not the term.
        await record(tx, { actorType: 'USER', actorId: req.user!.id, action: 'PATIENT_SEARCH', entityType: 'Patient', entityId: req.user!.id }, clock);
        return items;
      });
      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map((row) => ({ id: row.id, displayName: row.user.name, syntheticMrn: row.syntheticMrn, preferredLanguage: row.preferredLanguage }));
      const last = items.at(-1);
      res.status(200).json(PatientSearchPageSchema.parse({ items, nextCursor: hasMore && last ? encodeCursor(last.displayName, last.id) : null, updatedAt: clock.now().toISOString() }));
    } catch (error) { next(error); }
  });
  return router;
}

function encodeCursor(displayName: string, id: string): string {
  return Buffer.from(JSON.stringify({ displayName, id })).toString('base64url');
}

function decodeCursor(cursor: string): { displayName: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { displayName?: unknown; id?: unknown };
    if (typeof parsed.displayName !== 'string' || typeof parsed.id !== 'string') throw new Error();
    return { displayName: parsed.displayName, id: parsed.id };
  } catch {
    throw AppError.validation('Invalid patient search cursor.');
  }
}
