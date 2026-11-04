import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  CaseEventType,
  ActorType,
  ConsentScope,
  type PrismaClient,
} from '@prisma/client';
import {
  CaseTransitionResponseSchema,
  CreateCaseRequestSchema,
  CaseListQuerySchema,
  CursorQuerySchema,
  TransitionRequestSchema,
  ConfirmUnderstandingRequestSchema,
  ConsentRequestNotificationRequestSchema,
  GenerateExplanationsRequestSchema,
  ReviewDraftRequestSchema,
  type TransitionRequest,
} from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { validateBody, validateQuery } from '../../middleware/validate/validateRequest';
import { projectStaffCaseEvent } from './caseProjection';
import { createCase, getCase, listCaseEvents, listCases } from './caseService';
import { executeTransition } from './transitionService';
import type { CaseActor } from './caseVisibility';
import { withTransaction } from '../../core/withTransaction';
import { appendEvent } from '../../core/eventLog';
import { record } from '../../core/audit';
import { AppError } from '../../middleware/error/errorHandler';
import { queueNotification } from '../notifications/notificationService';
import { toNotificationDto } from '../notifications/notificationRoutes';
import { hashExplanationInput } from '../explanation/provider';
import { CaseState } from '@prisma/client';
import { caseVisibility } from './caseVisibility';
import { TemplateExplanationProvider } from '../explanation/provider';
import { generateValidatedExplanation } from '../explanation/validator';

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

  router.put('/:id/review-draft', requireRole('DOCTOR'), validateBody(ReviewDraftRequestSchema), async (req, res, next) => {
    try {
      const now = clock.now();
      const fields = ReviewDraftRequestSchema.parse(req.body);
      const result = await withTransaction(prisma, async (tx) => {
        const row = await tx.screeningCase.findFirst({ where: { AND: [{ id: caseIdParam(req), originProviderId: req.user!.providerId ?? '00000000-0000-0000-0000-000000000000' }, caseVisibility(toCaseActor(req), now)] } });
        if (!row) throw AppError.notFound('Case not found.');
        if (row.state !== CaseState.NEW) throw new AppError(409, 'INVALID_TRANSITION', 'Review drafts can only be changed while the case is NEW.');
        await tx.screeningCase.update({ where: { id: row.id }, data: {
          reviewDraftResultCategoryCode: fields.resultCategoryCode,
          reviewDraftNextStepCode: fields.nextStepCode,
          reviewDraftUrgencyLabel: fields.urgencyLabel,
          reviewRoute: fields.route,
          reviewDraftDoctorNote: fields.doctorNote ?? null,
          updatedAt: now,
        } });
        await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'REVIEW_DRAFT_SAVED', entityType: 'ScreeningCase', entityId: row.id }, clock);
        return { ...fields, inputHash: hashExplanationInput(fields), updatedAt: now.toISOString() };
      });
      res.status(200).json({ reviewDraft: result });
    } catch (error) { next(error); }
  });

  router.post('/:id/explanations/generate', requireRole('DOCTOR'), validateBody(GenerateExplanationsRequestSchema), async (req, res, next) => {
    try {
      const now = clock.now();
      const caseId = caseIdParam(req);
      const result = await withTransaction(prisma, async (tx) => {
        const row = await tx.screeningCase.findFirst({ where: { AND: [{ id: caseId, originProviderId: req.user!.providerId ?? '00000000-0000-0000-0000-000000000000' }, caseVisibility(toCaseActor(req), now)] } });
        if (!row) throw AppError.notFound('Case not found.');
        const fields = ReviewDraftRequestSchema.safeParse({
          resultCategoryCode: row.reviewDraftResultCategoryCode,
          nextStepCode: row.reviewDraftNextStepCode,
          urgencyLabel: row.reviewDraftUrgencyLabel,
          route: row.reviewRoute,
          ...(row.reviewDraftDoctorNote ? { doctorNote: row.reviewDraftDoctorNote } : {}),
        });
        if (!fields.success) throw new AppError(422, 'EVIDENCE_MISSING', 'A complete review draft is required.');
        const inputHash = hashExplanationInput(fields.data);
        const existing = await tx.explanationDraft.findMany({ where: { caseId, inputHash, language: { in: ['EN', 'AR'] } }, orderBy: { createdAt: 'asc' } });
        const currentLanguages = new Set(existing.map((item) => item.language));
        if (!currentLanguages.has('EN') || !currentLanguages.has('AR')) {
          const provider = new TemplateExplanationProvider();
          const outputs = (['EN', 'AR'] as const).map((language) => generateValidatedExplanation(provider, fields.data, language).output);
          await tx.explanationDraft.createMany({ data: outputs.filter((output) => !currentLanguages.has(output.language)).map((output) => ({
            caseId, language: output.language, source: 'TEMPLATE', status: 'DRAFT', inputHash, text: JSON.stringify(output), createdAt: now, updatedAt: now,
          })) });
          await appendEvent(tx, { caseId, type: CaseEventType.EXPLANATION_GENERATED, actorType: ActorType.USER, actorId: req.user!.id, payload: { inputHash, languages: ['EN', 'AR'] } }, clock);
          await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'EXPLANATION_GENERATED', entityType: 'ScreeningCase', entityId: caseId }, clock);
        }
        return tx.explanationDraft.findMany({ where: { caseId, inputHash, language: { in: ['EN', 'AR'] } }, orderBy: { language: 'asc' } });
      });
      res.status(200).json({ explanations: result.map((item) => ({ id: item.id, language: item.language, text: item.text, source: item.source, status: item.status, approvedBy: item.approvedBy, approvedAt: item.approvedAt?.toISOString() ?? null, updatedAt: item.updatedAt.toISOString(), inputHash: item.inputHash, current: true, reviewNotice: item.language === 'AR' ? 'UNREVIEWED_TRANSLATION' : 'NONE', doctorNoteSection: null })) });
    } catch (error) { next(error); }
  });

  router.post('/:id/understanding', requireRole('PATIENT'), validateBody(ConfirmUnderstandingRequestSchema), async (req, res, next) => {
    try {
      const caseId = caseIdParam(req);
      const result = await withTransaction(prisma, async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ScreeningCase" WHERE "id" = ${caseId} FOR UPDATE`;
        const caseRecord = await tx.screeningCase.findFirst({ where: { id: caseId, patient: { is: { userId: req.user!.id } } }, select: { id: true, state: true, understandingConfirmedAt: true } });
        if (!caseRecord) throw AppError.notFound('Case not found.');
        const explanation = await tx.explanationDraft.findFirst({ where: { id: req.body.explanationId, caseId, status: 'APPROVED' }, select: { id: true } });
        if (!explanation) throw AppError.validation('An approved explanation for this case is required.');
        if (caseRecord.understandingConfirmedAt) throw AppError.conflict('Understanding has already been confirmed.');
        const now = clock.now();
        await tx.screeningCase.update({ where: { id: caseId }, data: { understandingConfirmedAt: now } });
        const event = await appendEvent(tx, { caseId, type: CaseEventType.UNDERSTANDING_CONFIRMED, actorType: ActorType.USER, actorId: req.user!.id, payload: { explanationId: explanation.id } }, clock);
        await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'UNDERSTANDING_CONFIRMED', entityType: 'ScreeningCase', entityId: caseId }, clock);
        return { eventId: event.id };
      });
      const patientCase = await getCase({ prisma, clock }, toCaseActor(req), caseId);
      const event = 'events' in patientCase ? patientCase.events.find((item) => item.id === result.eventId) : undefined;
      if (!event) throw AppError.internal('Understanding event projection was not available.');
      res.status(200).json({ case: patientCase, event });
    } catch (error) { next(error); }
  });

  router.post('/:id/consent-requests', requireRole('DOCTOR', 'COORDINATOR'), validateBody(ConsentRequestNotificationRequestSchema), async (req, res, next) => {
    try {
      const caseId = caseIdParam(req);
      const notification = await withTransaction(prisma, async (tx) => {
        const caseRecord = await tx.screeningCase.findFirst({ where: { id: caseId, originProviderId: req.user!.providerId ?? '00000000-0000-0000-0000-000000000000' }, select: { id: true, patientId: true } });
        if (!caseRecord) throw AppError.notFound('Case not found.');
        const provider = await tx.provider.findUnique({ where: { id: req.body.providerId }, select: { id: true } });
        if (!provider) throw AppError.notFound('Provider not found.');
        if (await tx.consent.findFirst({ where: { patientId: caseRecord.patientId, providerId: provider.id, scope: ConsentScope.CROSS_PROVIDER_REFERRAL, OR: [{ revokedAt: null }, { revokedAt: { gt: clock.now() } }] }, select: { id: true } })) {
          throw AppError.conflict('Active consent already exists for this provider.');
        }
        const created = await queueNotification(tx, clock, { caseId, templateKey: 'consent_needed', actor: { actorType: ActorType.USER, actorId: req.user!.id } });
        await record(tx, { actorType: ActorType.USER, actorId: req.user!.id, action: 'CONSENT_REQUESTED', entityType: 'Notification', entityId: created.id }, clock);
        return created;
      });
      res.status(201).json(toNotificationDto(notification));
    } catch (error) { next(error); }
  });

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
