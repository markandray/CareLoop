import { spawnSync } from 'node:child_process';

export function databaseNameFromUrl(value) {
  try {
    const name = new URL(value).pathname.replace(/^\//, '').split('/')[0];
    if (!name) throw new Error();
    return name;
  } catch {
    throw new Error('DATABASE_URL must contain a database name.');
  }
}

export function assertDemoResetAllowed(env = process.env) {
  if (env.ALLOW_DEMO_RESET !== 'true' || env.NODE_ENV === 'production') {
    throw new Error('Refusing demo reset. Set ALLOW_DEMO_RESET=true in local development to enable destructive reset.');
  }
  return databaseNameFromUrl(env.DATABASE_URL ?? '');
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1]?.endsWith('demo-reset.mjs')) {
  try {
    const database = assertDemoResetAllowed();
    console.log(`About to destroy all data in development database "${database}".`);
    run('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed']);
    run('npm', ['run', 'seed']);
    run('npm', ['run', 'seed:demo']);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
