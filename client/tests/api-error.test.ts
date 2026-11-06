import { describe, expect, it } from 'vitest';
import {
  type ApiErrorCode,
  ApiErrorCodeSchema,
} from '@careloop/shared';
import { ApiError, parseApiError } from '../lib/api';

describe('ApiError parsing', () => {
  const allCodes = ApiErrorCodeSchema.options;

  it('contains all 11 shared API error codes', () => {
    expect(allCodes).toHaveLength(11);
  });

  allCodes.forEach((code: ApiErrorCode) => {
    it(`correctly parses error envelope for ${code}`, () => {
      const payload = {
        error: {
          code,
          message: `Sample message for ${code}`,
          details: { sampleField: 'test-value' },
        },
      };

      const statusMap: Record<ApiErrorCode, number> = {
        INVALID_TRANSITION: 409,
        EVIDENCE_MISSING: 422,
        FORBIDDEN: 403,
        CONSENT_REQUIRED: 403,
        NOT_FOUND: 404,
        VALIDATION_ERROR: 400,
        UNAUTHENTICATED: 401,
        DELAY_REASON_REQUIRED: 422,
        RATE_LIMITED: 429,
        CONFLICT: 409,
        INTERNAL_ERROR: 500,
      };

      const expectedStatus = statusMap[code] ?? 400;
      const apiError = parseApiError(expectedStatus, payload);

      expect(apiError).toBeInstanceOf(ApiError);
      expect(apiError.code).toBe(code);
      expect(apiError.message).toBe(`Sample message for ${code}`);
      expect(apiError.status).toBe(expectedStatus);
      expect(apiError.details).toEqual({ sampleField: 'test-value' });
    });
  });

  it('falls back to status code mapping for non-envelope responses', () => {
    const error401 = parseApiError(401, { message: 'Unauthorized access' });
    expect(error401.code).toBe('UNAUTHENTICATED');
    expect(error401.status).toBe(401);
    expect(error401.message).toBe('Unauthorized access');

    const error429 = parseApiError(429, null);
    expect(error429.code).toBe('RATE_LIMITED');
    expect(error429.status).toBe(429);

    const error500 = parseApiError(500, 'Internal Server Error');
    expect(error500.code).toBe('INTERNAL_ERROR');
    expect(error500.status).toBe(500);
  });
});

