import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  JWT_SECRET: z
    .string({
      required_error:
        'JWT_SECRET is required and must be at least 32 characters long.',
    })
    .min(32, 'JWT_SECRET must be at least 32 characters long.'),
  CLIENT_ORIGIN: z
    .string()
    .min(1, 'CLIENT_ORIGIN is required.')
    .default('http://localhost:3000'),
  DEMO_PASSWORD: z
    .string()
    .min(8, 'DEMO_PASSWORD must be at least 8 characters long.')
    .default('CareLoopDemo2026!'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(
  rawEnv: Record<string, string | undefined> = process.env,
): Env {
  const parsed = EnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${issues}`);
  }
  return parsed.data;
}

// Evaluated at startup: the application refuses to start without valid environment configuration
let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = validateEnv(process.env);
  }
  return cachedEnv;
}

export const env: Env = (function initEnv(): Env {
  // If NODE_ENV is test and JWT_SECRET is not provided, do not crash on module load of test files
  // that specifically test validateEnv failure; but allow regular initialization
  if (
    process.env.NODE_ENV === 'test' &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  ) {
    // In test environment without explicit JWT_SECRET, provide a safe test fallback so other imports succeed,
    // while unit tests can call validateEnv() directly to test refusal to start.
    process.env.JWT_SECRET =
      'careloop_local_test_jwt_secret_must_be_at_least_32_chars_long';
  }
  return getEnv();
})();

