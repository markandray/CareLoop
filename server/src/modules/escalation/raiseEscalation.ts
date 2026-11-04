import { ActorType, CaseEventType, EscalationLevel, Prisma } from '@prisma/client';
import type { Clock } from '../../core/clock';
import { appendEvent } from '../../core/eventLog';

const levelOrder: Record<EscalationLevel, number> = {
  LEVEL_0: 0,
  LEVEL_1: 1,
  LEVEL_2: 2,
  LEVEL_3: 3,
};

/** Raises the escalation overlay without lowering an existing level. */
export async function raiseEscalation(
  tx: Prisma.TransactionClient,
  input: { caseId: string; level: EscalationLevel; reason: string; now: Date },
  clock: Clock,
): Promise<boolean> {
  const row = await tx.screeningCase.findUnique({
    where: { id: input.caseId },
    select: { state: true, escalationLevel: true },
  });
  if (!row || row.state === 'CLOSED' || levelOrder[row.escalationLevel] >= levelOrder[input.level]) {
    return false;
  }
  await tx.screeningCase.update({
    where: { id: input.caseId },
    data: { escalationLevel: input.level, escalatedAt: input.now, updatedAt: input.now },
  });
  await appendEvent(tx, {
    caseId: input.caseId,
    type: CaseEventType.ESCALATION_RAISED,
    actorType: ActorType.SYSTEM,
    payload: { level: input.level, reason: input.reason },
  }, clock);
  return true;
}
