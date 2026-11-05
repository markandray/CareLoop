import { ActorType, CaseEventType, EscalationLevel, Prisma } from '@prisma/client';
import type { Clock } from '../../core/clock';
import { appendEvent } from '../../core/eventLog';

const levelOrder: Record<EscalationLevel, number> = {
  LEVEL_0: 0,
  LEVEL_1: 1,
  LEVEL_2: 2,
  LEVEL_3: 3,
};

type EscalationInput = { caseId: string; level: EscalationLevel; reason: string; now: Date; state?: import('@prisma/client').CaseState };

/** Raises one escalation, or a locked sweep batch, without lowering an existing level. */
export function raiseEscalation(tx: Prisma.TransactionClient, input: EscalationInput, clock: Clock): Promise<boolean>;
export function raiseEscalation(tx: Prisma.TransactionClient, input: EscalationInput[], clock: Clock): Promise<string[]>;
export async function raiseEscalation(
  tx: Prisma.TransactionClient,
  input: EscalationInput | EscalationInput[],
  clock: Clock,
): Promise<boolean | string[]> {
  if (Array.isArray(input)) return raiseEscalationBatch(tx, input);
  const lowerLevels = (Object.keys(levelOrder) as EscalationLevel[]).filter((level) => levelOrder[level] < levelOrder[input.level]);
  const update = await tx.screeningCase.updateMany({
    where: { id: input.caseId, state: { not: 'CLOSED' }, escalationLevel: { in: lowerLevels } },
    data: { escalationLevel: input.level, escalatedAt: input.now, updatedAt: input.now },
  });
  if (update.count === 0) return false;
  await appendEvent(tx, {
    caseId: input.caseId,
    type: CaseEventType.ESCALATION_RAISED,
    actorType: ActorType.SYSTEM,
    payload: { level: input.level, reason: input.reason },
  }, clock);
  return true;
}

async function raiseEscalationBatch(tx: Prisma.TransactionClient, items: EscalationInput[]): Promise<string[]> {
  const raised: string[] = [];
  for (const level of ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const) {
    const group = items.filter((item) => item.level === level);
    if (!group.length) continue;
    const lowerLevels = (Object.keys(levelOrder) as EscalationLevel[]).filter((candidate) => levelOrder[candidate] < levelOrder[level]);
    const update = await tx.screeningCase.updateMany({
      where: { id: { in: group.map((item) => item.caseId) }, state: { not: 'CLOSED' }, escalationLevel: { in: lowerLevels } },
      data: { escalationLevel: level, escalatedAt: group[0]!.now, updatedAt: group[0]!.now },
    });
    if (update.count === 0) continue;
    const committed = group.slice(0, update.count);
    await tx.caseEvent.createMany({ data: committed.map((item) => ({
      caseId: item.caseId, type: CaseEventType.ESCALATION_RAISED, actorType: ActorType.SYSTEM,
      fromState: item.state ?? null, toState: item.state ?? null,
      payload: { level, reason: item.reason }, createdAt: item.now,
    })) });
    await tx.auditLog.createMany({ data: committed.map((item) => ({
      actorType: ActorType.SYSTEM, actorId: null, action: 'ESCALATION_RAISED',
      entityType: 'ScreeningCase', entityId: item.caseId, createdAt: item.now,
    })) });
    raised.push(...committed.map((item) => item.caseId));
  }
  return raised;
}
