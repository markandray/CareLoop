import type { Request, Response, NextFunction } from 'express';
import type { z } from 'zod';
import { AppError } from '../error/errorHandler';

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message =
        result.error.errors[0]?.message ?? 'Invalid request body.';
      return next(AppError.validation(message, result.error.flatten()));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const message =
        result.error.errors[0]?.message ?? 'Invalid query parameters.';
      return next(AppError.validation(message, result.error.flatten()));
    }
    next();
  };
}

