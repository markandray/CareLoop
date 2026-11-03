import type { ErrorRequestHandler } from 'express';
import type { ApiErrorCode } from '@careloop/shared';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static unauthenticated(message = 'Authentication required.'): AppError {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }

  static forbidden(message = 'Access forbidden.'): AppError {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found.'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static validation(message = 'Validation failed.', details?: unknown): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }

  static rateLimited(
    message = 'Too many requests. Please try again later.',
  ): AppError {
    return new AppError(429, 'RATE_LIMITED', message);
  }

  static conflict(message = 'Conflict.'): AppError {
    return new AppError(409, 'CONFLICT', message);
  }

  static internal(message = 'Internal server error.'): AppError {
    return new AppError(500, 'INTERNAL_ERROR', message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
  }

  // Handle body-parser / express.json syntax parsing errors
  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status?: number }).status === 400 &&
    'body' in err
  ) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Malformed JSON payload.',
      },
    });
  }

  // Unhandled / unexpected errors
  console.error('Unhandled server error:', err);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error.',
    },
  });
};
