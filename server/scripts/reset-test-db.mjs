import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function databaseNameFromUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!databaseName) throw new Error('DATABASE_URL must include a database name.');
  return databaseName;
}

export function assertTestDatabaseUrl(databaseUrl) {
  const databaseName = databaseNameFromUrl(databaseUrl);
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refusing to reset database "${databaseName}": database name must end with _test.`);
  }
  return databaseName;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const databaseName = assertTestDatabaseUrl(process.env.DATABASE_URL ?? '');
    console.log(`Resetting test database "${databaseName}" with Prisma migrations.`);
    const result = spawnSync(
      'npx',
      ['prisma', 'migrate', 'reset', '--force', '--skip-seed'],
      { stdio: 'inherit', env: process.env },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Test database reset failed.');
    process.exitCode = 1;
  }
}
