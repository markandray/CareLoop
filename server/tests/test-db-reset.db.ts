import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTestDatabaseUrl } from '../scripts/reset-test-db.mjs';

test('test database reset guard refuses the careloop database', () => {
  assert.throws(
    () => assertTestDatabaseUrl('postgresql://user:pass@localhost:5432/careloop?schema=public'),
    /Refusing to reset database "careloop": database name must end with _test\./,
  );
});

test('test database reset guard accepts a database name ending in _test', () => {
  assert.equal(
    assertTestDatabaseUrl('postgresql://user:pass@localhost:5432/careloop_test?schema=public'),
    'careloop_test',
  );
});
