import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../error/errorHandler';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Checks Origin header on state-changing requests.
 * Requests without an Origin header (e.g. curl, server-to-server) are allowed.
 * If Origin is present, it must exactly equal the configured CLIENT_ORIGIN.
 */
export function createOriginMiddleware(clientOrigin: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (STATE_CHANGING_METHODS.has(req.method)) {
      const origin = req.headers['origin'];
      if (origin && origin !== clientOrigin) {
        return next(
          AppError.forbidden('Cross-origin state-changing request forbidden.'),
        );
      }
    }
    next();
  };
}

