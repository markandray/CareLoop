import { ConsentScope, ReferralStatus, type Prisma, type Role } from '@prisma/client';

export interface CaseActor {
  userId: string;
  role: Role;
  providerId: string | null;
}

/**
 * Returns the database scope for case reads. Admin scope grants visibility only;
 * callers must still authorize any write separately. Receiving-provider scope
 * requires a current referral and active cross-provider consent.
 */
export function caseVisibility(
  actor: CaseActor,
  now: Date,
): Prisma.ScreeningCaseWhereInput {
  switch (actor.role) {
    case 'PATIENT':
      return { patient: { is: { userId: actor.userId } } };
    case 'DOCTOR':
    case 'COORDINATOR':
      // Missing provider affiliation must fail closed and match no case.
      {
        const providerId =
          actor.providerId ?? '00000000-0000-0000-0000-000000000000';
        return {
          OR: [
            { originProviderId: providerId },
            {
              AND: [
                {
                  referrals: {
                    some: {
                      toProviderId: providerId,
                      status: { not: ReferralStatus.SUPERSEDED },
                    },
                  },
                },
                {
                  patient: {
                    is: {
                      consents: {
                        some: {
                          providerId,
                          scope: ConsentScope.CROSS_PROVIDER_REFERRAL,
                          grantedAt: { lte: now },
                          OR: [{ revokedAt: null }, { revokedAt: { gt: now } }],
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        };
      }
    case 'ADMIN':
      return {};
  }
}
