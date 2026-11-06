import { z } from 'zod';
import {
  type ApiErrorCode,
  ApiErrorSchema,
} from '@careloop/shared';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly status: number;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

type SessionExpiredHandler = () => void;
const sessionExpiredHandlers = new Set<SessionExpiredHandler>();

export function onSessionExpired(handler: SessionExpiredHandler): () => void {
  sessionExpiredHandlers.add(handler);
  return () => {
    sessionExpiredHandlers.delete(handler);
  };
}

export function triggerSessionExpired(): void {
  for (const handler of sessionExpiredHandlers) {
    try {
      handler();
    } catch {
      // Ignore handler errors during cleanup
    }
  }
}

export function parseApiError(status: number, data: unknown): ApiError {
  const result = ApiErrorSchema.safeParse(data);
  if (result.success) {
    return new ApiError(
      result.data.error.code,
      result.data.error.message,
      status,
      result.data.error.details
    );
  }

  // Fallback for non-envelope responses
  const fallbackCode: ApiErrorCode =
    status === 400
      ? 'VALIDATION_ERROR'
      : status === 401
        ? 'UNAUTHENTICATED'
        : status === 403
          ? 'FORBIDDEN'
          : status === 404
            ? 'NOT_FOUND'
            : status === 409
              ? 'CONFLICT'
              : status === 422
                ? 'EVIDENCE_MISSING'
                : status === 429
                  ? 'RATE_LIMITED'
                  : 'INTERNAL_ERROR';

  const message =
    typeof data === 'object' && data !== null && 'message' in data && typeof (data as { message: unknown }).message === 'string'
      ? (data as { message: string }).message
      : `HTTP ${status} error`;

  return new ApiError(fallbackCode, message, status);
}

export interface ApiFetchOptions<T> extends Omit<RequestInit, 'body'> {
  body?: unknown;
  schema?: z.ZodType<T>;
  skipAuthRedirect?: boolean;
}

export async function apiFetch<T>(
  url: string,
  options?: ApiFetchOptions<T>
): Promise<T> {
  if (!url.startsWith('/')) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `Relative URL required, received: ${url}`,
      400
    );
  }

  const headers = new Headers(options?.headers);
  headers.set('Accept', 'application/json');

  let body: string | undefined;
  if (options?.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body,
    credentials: 'same-origin',
  });

  if (response.status === 204) {
    if (options?.schema) {
      const parsed = options.schema.safeParse(undefined);
      if (!parsed.success) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Expected response content from schema, but received 204 No Content',
          204
        );
      }
      return parsed.data;
    }
    return undefined as T;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const error = parseApiError(response.status, json);

    if (response.status === 401 && !options?.skipAuthRedirect) {
      triggerSessionExpired();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    throw error;
  }

  if (options?.schema) {
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        'VALIDATION_ERROR',
        `Response failed schema validation: ${parsed.error.message}`,
        response.status,
        parsed.error.issues
      );
    }
    return parsed.data;
  }

  return json as T;
}
