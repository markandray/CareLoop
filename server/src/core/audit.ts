import { ActorType, Prisma } from '@prisma/client';
import type { Clock } from './clock';
import { assertActor } from './actor';

export interface RecordAuditInput {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
}

/** Appends one immutable audit row using the caller's transaction and clock. */
export function record(
  tx: Prisma.TransactionClient,
  input: RecordAuditInput,
  clock: Clock,
): Promise<Prisma.AuditLogGetPayload<object>> {
  assertActor(input.actorType, input.actorId);
  return tx.auditLog.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      createdAt: clock.now(),
    },
  });
}
