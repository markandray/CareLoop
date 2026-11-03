import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import type { Role, UserSession } from '@careloop/shared';
import { AppError } from '../error/errorHandler';

export const AUTH_COOKIE_NAME = 'careloop_session';

export interface TokenPayload {
  userId: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserSession;
    }
  }
}

/**
 * Verifies the session JWT cookie and reloads the authenticated user from PostgreSQL
 * on every request so role changes and deleted users take effect immediately.
 */
export function createAuthMiddleware(
  prisma: PrismaClient,
  jwtSecret: string,
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token = req.cookies?.[AUTH_COOKIE_NAME];
      if (!token) {
        throw AppError.unauthenticated('Authentication required.');
      }

      let payload: TokenPayload;
      try {
        payload = jwt.verify(token, jwtSecret) as TokenPayload;
      } catch {
        throw AppError.unauthenticated('Invalid or expired session token.');
      }

      if (!payload?.userId) {
        throw AppError.unauthenticated('Invalid session token payload.');
      }

      // Reload user from the database on every request so role changes and deleted users apply immediately
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          providerId: true,
          language: true,
        },
      });

      if (!user) {
        throw AppError.unauthenticated('User account no longer exists.');
      }

      // Spec note: The User model currently lacks an isActive or deactivatedAt column.
      // Immediate de-authorization is guaranteed for deleted records via this database lookup.

      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        providerId: user.providerId,
        language: user.language,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
