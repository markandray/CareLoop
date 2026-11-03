import { describe, expect, it } from 'vitest';
import { ApiErrorCodeSchema } from '../src';

describe('API error codes contract', () => {
  it('includes RATE_LIMITED among the supported API error codes', () => {
    expect(ApiErrorCodeSchema.options).toContain('RATE_LIMITED');
    const result = ApiErrorCodeSchema.safeParse('RATE_LIMITED');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('RATE_LIMITED');
    }
  });
});

