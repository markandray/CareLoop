import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@careloop/shared';
import { AppError } from '../error/errorHandler';

/**
 * Ensures the authenticated user possesses one of the required roles.
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(AppError.unauthenticated('Authentication required.'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        AppError.forbidden(
          `Access forbidden for role ${req.user.role}. Required: ${allowedRoles.join(', ')}.`,
        ),
      );
    }

    next();
  };
}

