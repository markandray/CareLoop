import { ActorType, CaseEventType, CaseState, type PrismaClient, type Role } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { AdvanceDemoClockRequestSchema, AssignOwnerRequestSchema, CaseTransitionResponseSchema, DemoClockDtoSchema, ResolveEscalationRequestSchema } from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { appendEvent } from '../../core/eventLog';
import { record } from '../../core/audit';
import { withTransaction } from '../../core/withTransaction';
import { workflowConfig } from '../../config/workflowConfig';
import type { Env } from '../../config/env';
import { AppError } from '../../middleware/error/errorHandler';
import { requireRole } from '../../middleware/role/roleMiddleware';
import { validateBody } from '../../middleware/validate/validateRequest';
import { caseVisibility } from '../cases/caseVisibility';
import { getCase } from '../cases/caseService';
import { projectStaffCaseEvent } from '../cases/caseProjection';
import { runEscalationSweep } from './escalationService';

const levelOrder = { LEVEL_0: 0, LEVEL_1: 1, LEVEL_2: 2, LEVEL_3: 3 } as const;
const slaForState: Partial<Record<CaseState, keyof typeof workflowConfig.slaMs>> = {
  NEW: 'reviewAfterNew', CLINICIAN_REVIEWED: 'notificationDispatch', CONFIRMATION_PENDING: 'confirmatoryResult',
  REFERRAL_PENDING: 'referralAcceptance', REFERRAL_ACCEPTED: 'appointmentScheduling',
  APPOINTMENT_SCHEDULED: 'appointmentAttendanceGrace', CARE_STARTED: 'defaultFollowUpInterval',
};

export function createEscalationRouter(prisma: PrismaClient, clock: Clock, env: Env, authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void> | void): Router {
  const router = Router();
  router.use(authenticate);

  router.post('/cases/:id/escalation/resolve', requireRole('DOCTOR', 'COORDINATOR'), validateBody(ResolveEscalationRequestSchema), async (req, res, next) => {
    try {
      const actor = { userId: req.user!.id, role: req.user!.role, providerId: req.user!.providerId };
      const id = req.params.id as string;
      const body = ResolveEscalationRequestSchema.parse(req.body);
      const result = await withTransaction(prisma, async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ScreeningCase" WHERE "id" = ${id} FOR UPDATE`;
        const now = clock.now();
        const row = await tx.screeningCase.findFirst({ where: { AND: [{ id }, caseVisibility(actor, now)] } });
        if (!row) throw AppError.notFound('Case not found.');
        if (actor.providerId && actor.providerId !== row.originProviderId) {
          const liveReferral = await tx.referral.findFirst({ where: { caseId: id, toProviderId: actor.providerId, status: { in: ['PENDING', 'ACCEPTED'] } }, select: { id: true } });
          if (!liveReferral) throw AppError.notFound('Case not found.');
        }
        if (row.escalationLevel === 'LEVEL_0') throw AppError.conflict('Case is not escalated.');
        if (levelOrder[row.escalationLevel] >= 2 && actor.role !== 'DOCTOR') throw AppError.forbidden('A doctor must resolve level two or three escalation.');
        const overdue = row.dueAt !== null && row.dueAt.getTime() < now.getTime();
        if (overdue && !body.delayReason) throw new AppError(422, 'DELAY_REASON_REQUIRED', 'A delay reason is required for an overdue case.');
        const slaKey = slaForState[row.state];
        const dueAt = slaKey ? new Date(now.getTime() + workflowConfig.slaMs[slaKey][row.urgencyLabel ?? row.intakeUrgency]) : row.dueAt;
        await tx.screeningCase.update({ where: { id }, data: { escalationLevel: 'LEVEL_0', escalatedAt: null, dueAt, updatedAt: now } });
        const event = await appendEvent(tx, { caseId: id, type: CaseEventType.ESCALATION_CLEARED, actorType: ActorType.USER, actorId: actor.userId, fromState: row.state, toState: row.state, payload: { previousLevel: row.escalationLevel, actionPlan: body.actionPlan } }, clock);
        if (body.delayReason) await appendEvent(tx, { caseId: id, type: CaseEventType.DELAY_REASON_RECORDED, actorType: ActorType.USER, actorId: actor.userId, fromState: row.state, toState: row.state, payload: { reason: body.delayReason, transitionKey: 'RESOLVE_ESCALATION', overdueDurationMs: Math.max(0, now.getTime() - (row.dueAt?.getTime() ?? now.getTime())) } }, clock);
        await record(tx, { actorType: ActorType.USER, actorId: actor.userId, action: 'ESCALATION_CLEARED', entityType: 'ScreeningCase', entityId: id }, clock);
        return event;
      });
      const event = await prisma.caseEvent.findUniqueOrThrow({ where: { id: result.id }, include: { actor: true } });
      const updatedCase = await getCase({ prisma, clock }, actor, id);
      res.status(200).json(CaseTransitionResponseSchema.parse({ case: updatedCase, event: projectStaffCaseEvent(event) }));
    } catch (error) { next(error); }
  });

  router.put('/cases/:id/owner', requireRole('COORDINATOR', 'ADMIN'), validateBody(AssignOwnerRequestSchema), async (req, res, next) => {
    try {
      const actor = { userId: req.user!.id, role: req.user!.role, providerId: req.user!.providerId };
      const id = req.params.id as string;
      const { userId } = AssignOwnerRequestSchema.parse(req.body);
      const result = await withTransaction(prisma, async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ScreeningCase" WHERE "id" = ${id} FOR UPDATE`;
        const now = clock.now();
        const row = await tx.screeningCase.findFirst({ where: { AND: [{ id }, caseVisibility(actor, now)] } });
        if (!row) throw AppError.notFound('Case not found.');
        if (row.state === 'CLOSED') throw AppError.conflict('Closed cases cannot be assigned.');
        const referral = await tx.referral.findFirst({ where: { caseId: id, status: { not: 'SUPERSEDED' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { fromProviderId: true, toProviderId: true, status: true } });
        const currentOwner = row.ownerUserId ? await tx.user.findUnique({ where: { id: row.ownerUserId }, select: { providerId: true } }) : null;
        const receivingTask = referral && ['REFERRAL_ACCEPTED', 'APPOINTMENT_SCHEDULED', 'CARE_STARTED'].includes(row.state)
          ? referral.toProviderId
          : row.state === 'REFERRAL_PENDING' && referral?.status === 'PENDING' ? referral.toProviderId : null;
        const taskProviderId = row.ownerQueueProviderId ?? currentOwner?.providerId ?? receivingTask ?? row.originProviderId;
        const coordinatorCanAssign = actor.role === 'COORDINATOR' && (actor.providerId === row.originProviderId || (actor.providerId === taskProviderId && row.ownerQueueProviderId === taskProviderId && referral?.toProviderId === taskProviderId && ['PENDING', 'ACCEPTED'].includes(referral.status)));
        if (actor.role !== 'ADMIN' && !coordinatorCanAssign) throw AppError.forbidden('A coordinator for the task provider or an admin must assign this case.');
        const expectedRole: Role = ['NEW', 'CONFIRMATION_PENDING', 'CARE_STARTED'].includes(row.state) ? 'DOCTOR' : 'COORDINATOR';
        const target = await tx.user.findFirst({ where: { id: userId, providerId: taskProviderId, role: expectedRole }, select: { id: true } });
        if (!target) throw AppError.validation('The assignee must have the expected role at the task provider.');
        await tx.screeningCase.update({ where: { id }, data: { ownerUserId: userId, ownerQueueRole: null, ownerQueueProviderId: null, updatedAt: now } });
        const event = await appendEvent(tx, { caseId: id, type: CaseEventType.OWNER_ASSIGNED, actorType: ActorType.USER, actorId: actor.userId, fromState: row.state, toState: row.state, payload: { ownerUserId: userId, assignedByAdmin: actor.role === 'ADMIN' } }, clock);
        await record(tx, { actorType: ActorType.USER, actorId: actor.userId, action: 'OWNER_ASSIGNED', entityType: 'ScreeningCase', entityId: id }, clock);
        return event;
      });
      const event = await prisma.caseEvent.findUniqueOrThrow({ where: { id: result.id }, include: { actor: true } });
      res.status(200).json(CaseTransitionResponseSchema.parse({ case: await getCase({ prisma, clock }, actor, id), event: projectStaffCaseEvent(event) }));
    } catch (error) { next(error); }
  });

  const demoEnabled = env.NODE_ENV !== 'production' && env.DEMO_CONTROLS_ENABLED !== false;
  router.get('/demo/clock', async (req, res, next) => {
    try {
      if (!demoEnabled) throw AppError.notFound('Demo controls are disabled.');
      const setting = await prisma.systemSetting.findUnique({ where: { key: 'demoClockOffsetMs' }, select: { value: true } });
      const offsetMs = typeof setting?.value === 'number' ? setting.value : 0;
      await recordAudit(prisma, req.user!.id, 'DEMO_CLOCK_READ', clock);
      res.status(200).json(DemoClockDtoSchema.parse({ now: clock.now().toISOString(), offsetMs, isSimulated: offsetMs !== 0 }));
    } catch (error) { next(error); }
  });
  router.post('/demo/clock/advance', requireRole('ADMIN'), validateBody(AdvanceDemoClockRequestSchema), async (req, res, next) => {
    try {
      if (!demoEnabled) throw AppError.notFound('Demo controls are disabled.');
      const { amount, unit } = AdvanceDemoClockRequestSchema.parse(req.body);
      const factor = unit === 'MINUTES' ? 60_000 : unit === 'HOURS' ? 3_600_000 : 86_400_000;
      if (amount * factor > 30 * 86_400_000) throw AppError.validation('Clock advance cannot exceed 30 days per call.');
      const now = await clock.advance(amount, unit.toLowerCase() as 'minutes' | 'hours' | 'days');
      await recordAudit(prisma, req.user!.id, 'DEMO_CLOCK_ADVANCED', clock);
      const escalationsRaised = await runEscalationSweep({ prisma, clock });
      res.status(200).json({ now: now.toISOString(), escalationsRaised: escalationsRaised ?? 0 });
    } catch (error) { next(error); }
  });
  router.post('/demo/clock/reset', requireRole('ADMIN'), async (req, res, next) => {
    try {
      if (!demoEnabled) throw AppError.notFound('Demo controls are disabled.');
      const now = await clock.reset();
      await recordAudit(prisma, req.user!.id, 'DEMO_CLOCK_RESET', clock);
      res.status(200).json({ now: now.toISOString() });
    } catch (error) { next(error); }
  });
  return router;
}

async function recordAudit(prisma: PrismaClient, actorId: string, action: string, clock: Clock): Promise<void> {
  await withTransaction(prisma, (tx) => record(tx, { actorType: ActorType.USER, actorId, action, entityType: 'SystemSetting', entityId: 'demoClockOffsetMs' }, clock).then(() => undefined));
}
