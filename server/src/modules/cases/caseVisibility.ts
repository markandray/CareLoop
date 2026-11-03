import type { Prisma, Role } from '@prisma/client';

export interface CaseActor {
  userId: string;
  role: Role;
  providerId: string | null;
}

/**
 * Returns the database scope for case reads. Admin scope grants visibility only;
 * callers must still authorize any write separately. Receiving-provider case
 * access through referral packets is deferred to T-201.
 */
export function caseVisibility(
  actor: CaseActor,
): Prisma.ScreeningCaseWhereInput {
  switch (actor.role) {
    case 'PATIENT':
      return { patient: { is: { userId: actor.userId } } };
    case 'DOCTOR':
    case 'COORDINATOR':
      // Missing provider affiliation must fail closed and match no case.
      return {
        originProviderId:
          actor.providerId ?? '00000000-0000-0000-0000-000000000000',
      };
    case 'ADMIN':
      return {};
  }
}
