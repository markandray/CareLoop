import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDemoResetAllowed, databaseNameFromUrl } from '../scripts/demo-reset.mjs';

test('demo reset guard refuses without ALLOW_DEMO_RESET', () => {
  assert.throws(() => assertDemoResetAllowed({ ALLOW_DEMO_RESET: 'false', NODE_ENV: 'development', DATABASE_URL: 'postgresql://user:pass@db:5432/careloop' }), /Refusing demo reset/);
});

test('demo reset guard refuses production even if explicitly enabled', () => {
  assert.throws(() => assertDemoResetAllowed({ ALLOW_DEMO_RESET: 'true', NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:pass@db:5432/careloop' }), /Refusing demo reset/);
});

test('demo reset reports the configured database name', () => {
  assert.equal(databaseNameFromUrl('postgresql://user:pass@db:5432/careloop_dev?schema=public'), 'careloop_dev');
});
