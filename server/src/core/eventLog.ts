import { ActorType, CaseEventType, CaseState, Prisma } from '@prisma/client';
import type { Clock } from './clock';
import { assertActor } from './actor';

export interface AppendEventInput {
  caseId: string;
  type: CaseEventType;
  actorType: ActorType;
  actorId?: string | null;
  fromState?: CaseState | null;
  toState?: CaseState | null;
  payload?: Prisma.InputJsonValue | null;
}

/** Appends one immutable event using the caller's transaction and injected clock. */
export function appendEvent(
  tx: Prisma.TransactionClient,
  input: AppendEventInput,
  clock: Clock,
): Promise<Prisma.CaseEventGetPayload<object>> {
  assertActor(input.actorType, input.actorId);
  return tx.caseEvent.create({
    data: {
      caseId: input.caseId,
      type: input.type,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      fromState: input.fromState ?? null,
      toState: input.toState ?? null,
      payload: input.payload ?? Prisma.JsonNull,
      createdAt: clock.now(),
    },
  });
}
