import { describe, expect, it } from 'vitest';
import { en } from '../lib/i18n/en';
import { ar } from '../lib/i18n/ar';

describe('i18n dictionary parity', () => {
  it('every key in en.ts exists in ar.ts and has non-empty text', () => {
    const enKeys = Object.keys(en);
    expect(enKeys.length).toBeGreaterThan(0);

    for (const key of enKeys) {
      expect(
        key in ar,
        `Key "${key}" from en.ts missing in ar.ts`
      ).toBe(true);

      const arValue = ar[key as keyof typeof ar];
      expect(
        typeof arValue === 'string' && arValue.trim().length > 0,
        `Key "${key}" in ar.ts must not be empty`
      ).toBe(true);
    }
  });

  it('every key in ar.ts exists in en.ts and has non-empty text', () => {
    const arKeys = Object.keys(ar);
    expect(arKeys.length).toBeGreaterThan(0);

    for (const key of arKeys) {
      expect(
        key in en,
        `Key "${key}" from ar.ts missing in en.ts`
      ).toBe(true);

      const enValue = en[key as keyof typeof en];
      expect(
        typeof enValue === 'string' && enValue.trim().length > 0,
        `Key "${key}" in en.ts must not be empty`
      ).toBe(true);
    }
  });

  it('key counts match exactly between en.ts and ar.ts', () => {
    expect(Object.keys(en).length).toBe(Object.keys(ar).length);
  });
});

