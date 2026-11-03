import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  CaseEventType,
  type PrismaClient,
} from '@prisma/client';
import {
  CaseTransitionResponseSchema,
  CreateCaseRequestSchema,
  CaseListQuerySchema,
  CursorQuerySchema,
  TransitionRequestSchema,
  type TransitionRequest,
} from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { validateBody, validateQuery } from '../../middleware/validate/validateRequest';
import { projectStaffCaseEvent } from './caseProjection';
import { createCase, getCase, listCaseEvents, listCases } from './caseService';
import { executeTransition } from './transitionService';
import type { CaseActor } from './caseVisibility';

export function createCaseRouter(
  prisma: PrismaClient,
  clock: Clock,
  authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): Router {
  const router = Router();
  router.use(authenticate);

  router.post(
    '/',
    requireRole('DOCTOR', 'ADMIN'),
    validateBody(CreateCaseRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const actor = toCaseActor(req);
        const createdCase = await createCase(
          { prisma, clock },
          actor,
          req.body.evidence,
        );
        const eventRecord = await prisma.caseEvent.findFirstOrThrow({
          where: { caseId: createdCase.id, type: CaseEventType.CASE_CREATED },
          include: { actor: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const response = CaseTransitionResponseSchema.parse({
          case: createdCase,
          event: projectStaffCaseEvent(eventRecord),
        });
        res.status(201).json(response);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:id/transitions',
    requireRole('DOCTOR', 'COORDINATOR'),
    validateBody(TransitionRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const response = await executeTransition(
          { prisma, clock },
          toCaseActor(req),
          caseIdParam(req),
          TransitionRequestSchema.parse(req.body) as TransitionRequest,
        );
        res.status(200).json(CaseTransitionResponseSchema.parse(response));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/',
    validateQuery(CaseListQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const page = await listCases(
          { prisma, clock },
          toCaseActor(req),
          CaseListQuerySchema.parse(req.query),
        );
        res.status(200).json(page);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:id/events',
    validateQuery(CursorQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const page = await listCaseEvents(
          { prisma, clock },
          toCaseActor(req),
          caseIdParam(req),
          CursorQuerySchema.parse(req.query),
        );
        res.status(200).json(page);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getCase(
        { prisma, clock },
        toCaseActor(req),
        caseIdParam(req),
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function caseIdParam(req: Request): string {
  const value = req.params.id;
  return Array.isArray(value) ? value[0] ?? '' : value;
}

function toCaseActor(req: Request): CaseActor {
  if (!req.user) throw new Error('Authenticated case route has no user.');
  return {
    userId: req.user.id,
    role: req.user.role,
    providerId: req.user.providerId,
  };
}
