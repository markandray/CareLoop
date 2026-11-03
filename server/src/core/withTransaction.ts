import { Prisma, PrismaClient } from '@prisma/client';

/** Runs all writes in a service operation inside a single database transaction. */
export function withTransaction<T>(
  client: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(operation);
}
