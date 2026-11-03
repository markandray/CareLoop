import { ActorType } from '@prisma/client';

export function assertActor(
  actorType: ActorType,
  actorId: string | null | undefined,
): void {
  if (actorType === ActorType.USER && !actorId) {
    throw new TypeError('actorId is required when actorType is USER.');
  }
}
