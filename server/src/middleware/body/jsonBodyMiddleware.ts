import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../error/errorHandler';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Rejects non-JSON content types on state-changing write requests.
 */
export function jsonBodyOnly(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (WRITE_METHODS.has(req.method)) {
    const contentType = req.headers['content-type'];
    const contentLength = req.headers['content-length'];
    const isChunked = req.headers['transfer-encoding'] === 'chunked';
    const hasBody =
      (contentLength !== undefined && contentLength !== '0') || isChunked;

    if (contentType) {
      // Must be application/json (or application/json; charset=utf-8)
      if (!req.is('application/json')) {
        return next(
          new AppError(
            415,
            'VALIDATION_ERROR',
            'Content-Type must be application/json.',
          ),
        );
      }
    } else if (hasBody) {
      return next(
        AppError.validation(
          'Content-Type application/json is required for request bodies.',
        ),
      );
    }
  }
  next();
}

