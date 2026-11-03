import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient, type Role } from '@prisma/client';
import { DatabaseClock } from '../../core/clock';
import { realSystemTimeMs } from '../../core/realTime';
import { validateEnv } from '../../config/env';
import { createApp } from '../../app';
import { resetRateLimiter } from './rateLimiter';
import { AUTH_COOKIE_NAME } from '../../middleware/auth/authMiddleware';

const TEST_SECRET =
  'careloop_test_jwt_secret_that_is_at_least_32_chars_long_for_tests';
const CLIENT_ORIGIN = 'http://localhost:3000';
const TEST_PASSWORD = 'ValidPassword123!';

const prisma = new PrismaClient();
const clock = new DatabaseClock(prisma.systemSetting);

let server: http.Server;
let baseUrl: string;

const testUsers: Record<Role, { email: string; id: string }> = {
  PATIENT: { email: 't101.patient@careloop.test', id: '' },
  DOCTOR: { email: 't101.doctor@careloop.test', id: '' },
  COORDINATOR: { email: 't101.coordinator@careloop.test', id: '' },
  ADMIN: { email: 't101.admin@careloop.test', id: '' },
};

before(async () => {
  await clock.initialize();

  // Create or upsert test users for all 4 roles
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  for (const role of ['PATIENT', 'DOCTOR', 'COORDINATOR', 'ADMIN'] as Role[]) {
    const email = testUsers[role].email;
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        role,
        name: `Test ${role}`,
        passwordHash,
      },
      create: {
        email,
        name: `Test ${role}`,
        role,
        passwordHash,
        language: 'EN',
      },
    });
    testUsers[role].id = user.id;
  }

  // Create an Express test app with explicit dependencies
  const app = createApp({
    prisma,
    clock,
    env: {
      NODE_ENV: 'test',
      SERVER_PORT: 0,
      DATABASE_URL: process.env.DATABASE_URL || '',
      JWT_SECRET: TEST_SECRET,
      CLIENT_ORIGIN,
      DEMO_PASSWORD: TEST_PASSWORD,
    },
  });

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(() => {
  resetRateLimiter();
});

describe('T-101 Auth and RBAC test suite', () => {
  test('1. login success: returns 200, user session, sets session cookie, and records audit log', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUsers.DOCTOR.email,
        password: TEST_PASSWORD,
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    assert.ok(body.user);
    assert.equal(body.user.email, testUsers.DOCTOR.email);
    assert.equal(body.user.role, 'DOCTOR');
    assert.equal(body.user.passwordHash, undefined);

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'set-cookie header must be present');
    assert.ok(setCookie.includes(AUTH_COOKIE_NAME));

    // Verify audit log record
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'LOGIN_SUCCEEDED',
        actorId: testUsers.DOCTOR.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(audit, 'LOGIN_SUCCEEDED audit log must be recorded');
    assert.equal(audit.entityType, 'User');
    assert.equal(audit.entityId, testUsers.DOCTOR.id);
  });

  test('2. identical failure for unknown email vs wrong password (shape, code, timing-safe)', async () => {
    // Unknown email
    const resUnknown = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent.user.12345@careloop.test',
        password: 'SomeRandomPassword999!',
      }),
    });

    assert.equal(resUnknown.status, 401);
    const bodyUnknown = await resUnknown.json();

    // Wrong password for existing user
    const resWrongPass = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUsers.DOCTOR.email,
        password: 'IncorrectPassword999!',
      }),
    });

    assert.equal(resWrongPass.status, 401);
    const bodyWrongPass = await resWrongPass.json();

    // Responses must be completely identical
    assert.deepEqual(bodyUnknown, {
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password.',
      },
    });
    assert.deepEqual(bodyUnknown, bodyWrongPass);

    // Verify audit logs for both failures
    const auditUnknown = await prisma.auditLog.findFirst({
      where: {
        action: 'LOGIN_FAILED',
        actorType: 'SYSTEM',
        entityId: 'unknown',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(auditUnknown, 'LOGIN_FAILED audit for unknown user must exist');

    const auditWrongPass = await prisma.auditLog.findFirst({
      where: {
        action: 'LOGIN_FAILED',
        actorId: testUsers.DOCTOR.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(auditWrongPass, 'LOGIN_FAILED audit for wrong password must exist');
  });

  test('3. cookie flags: httpOnly, SameSite=Strict, Path=/', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUsers.COORDINATOR.email,
        password: TEST_PASSWORD,
      }),
    });

    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(/httponly/i.test(setCookie), 'Cookie must be HttpOnly');
    assert.ok(/samesite=strict/i.test(setCookie), 'Cookie must be SameSite=Strict');
    assert.ok(/path=\//i.test(setCookie), 'Cookie path must be /');
  });

  test('4. /auth/me: returns user session when authenticated; 401 when not authenticated', async () => {
    // Unauthenticated call
    const unauthRes = await fetch(`${baseUrl}/api/v1/auth/me`);
    assert.equal(unauthRes.status, 401);
    const unauthBody = (await unauthRes.json()) as { error: { code: string } };
    assert.equal(unauthBody.error.code, 'UNAUTHENTICATED');

    // Authenticated call
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUsers.ADMIN.email,
        password: TEST_PASSWORD,
      }),
    });
    const cookie = loginRes.headers.get('set-cookie') || '';

    const authRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: cookie },
    });
    assert.equal(authRes.status, 200);
    const authBody = (await authRes.json()) as { user: Record<string, unknown> };
    assert.equal(authBody.user.email, testUsers.ADMIN.email);
    assert.equal(authBody.user.role, 'ADMIN');
    assert.equal(authBody.user.passwordHash, undefined);
  });

  test('5. logout clears the cookie and audits LOGOUT', async () => {
    // 1. Log in
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUsers.PATIENT.email,
        password: TEST_PASSWORD,
      }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.get('set-cookie') || '';

    // 2. Call logout
    const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(logoutRes.status, 204);

    const logoutCookie = logoutRes.headers.get('set-cookie') || '';
    assert.ok(
      /max-age=0/i.test(logoutCookie) || /expires=/i.test(logoutCookie),
      'Logout must clear the cookie',
    );

    // 3. Verify LOGOUT audit log
    const logoutAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'LOGOUT',
        actorId: testUsers.PATIENT.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(logoutAudit, 'LOGOUT audit log must be recorded');
  });

  test('6. requireRole matrix over all four roles on test routes', async () => {
    const roles: Role[] = ['PATIENT', 'DOCTOR', 'COORDINATOR', 'ADMIN'];

    // Collect session cookies for all four roles
    const cookies: Record<Role, string> = {
      PATIENT: '',
      DOCTOR: '',
      COORDINATOR: '',
      ADMIN: '',
    };

    for (const role of roles) {
      const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testUsers[role].email,
          password: TEST_PASSWORD,
        }),
      });
      assert.equal(loginRes.status, 200);
      cookies[role] = loginRes.headers.get('set-cookie') || '';
    }

    // Verify 4x4 matrix
    for (const callerRole of roles) {
      for (const targetRole of roles) {
        const routePath = `${baseUrl}/api/v1/test/roles/${targetRole.toLowerCase()}`;
        const res = await fetch(routePath, {
          headers: { Cookie: cookies[callerRole] },
        });

        if (callerRole === targetRole) {
          assert.equal(
            res.status,
            200,
            `Caller ${callerRole} should be ALLOWED on route for ${targetRole}`,
          );
        } else {
          assert.equal(
            res.status,
            403,
            `Caller ${callerRole} should be FORBIDDEN on route for ${targetRole}`,
          );
          const body = (await res.json()) as { error: { code: string } };
          assert.equal(body.error.code, 'FORBIDDEN');
        }
      }
    }
  });

  test('7. a token whose user was deleted is rejected (reloaded from DB)', async () => {
    // 1. Create temporary user with unique email
    const tempEmail = `temp.deleted.user.${realSystemTimeMs()}.${Math.random().toString(36).substring(2)}@careloop.test`;
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const tempUser = await prisma.user.create({
      data: {
        email: tempEmail,
        name: 'Temporary User',
        role: 'PATIENT',
        passwordHash,
        language: 'EN',
      },
    });

    // 2. Issue session token directly without creating AuditLog record (AuditLog has restrict on delete)
    const token = jwt.sign(
      { userId: tempUser.id, role: tempUser.role },
      TEST_SECRET,
      { expiresIn: '1h' },
    );
    const cookie = `${AUTH_COOKIE_NAME}=${token}; Path=/`;

    // 3. Verify /auth/me works before deletion
    const beforeRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: cookie },
    });
    assert.equal(beforeRes.status, 200);

    // 4. Delete user from PostgreSQL
    await prisma.user.delete({ where: { id: tempUser.id } });

    // 5. Subsequent request with same token must be rejected with 401
    const afterRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: cookie },
    });
    assert.equal(afterRes.status, 401);
    const afterBody = (await afterRes.json()) as { error: { code: string } };
    assert.equal(afterBody.error.code, 'UNAUTHENTICATED');
  });

  test('8. login rate limit: 5 failed attempts per 15 min per email+IP, then 429 RATE_LIMITED', async () => {
    const targetEmail = 'target.ratelimit@careloop.test';

    // 5 consecutive failures
    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          password: 'WrongPassword!',
        }),
      });
      assert.equal(res.status, 401, `Attempt ${i} should return 401`);
    }

    // 6th attempt should be blocked by rate limiter with HTTP 429 RATE_LIMITED
    const blockedRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: targetEmail,
        password: 'EvenCorrectPasswordBlockedNow!',
      }),
    });

    assert.equal(blockedRes.status, 429);
    const blockedBody = (await blockedRes.json()) as { error: { code: string } };
    assert.equal(blockedBody.error.code, 'RATE_LIMITED');
  });

  test('9. a cross-origin state-changing POST is rejected; matching origin and curl (no origin) allowed', async () => {
    // 1. Cross-origin POST with mismatched Origin header -> 403 FORBIDDEN
    const forbiddenRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://malicious-attacker.com',
      },
      body: JSON.stringify({
        email: testUsers.DOCTOR.email,
        password: TEST_PASSWORD,
      }),
    });
    assert.equal(forbiddenRes.status, 403);
    const forbiddenBody = (await forbiddenRes.json()) as { error: { code: string } };
    assert.equal(forbiddenBody.error.code, 'FORBIDDEN');

    // 2. Matching Origin header -> Allowed (proceeds to 200)
    const allowedRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: CLIENT_ORIGIN,
      },
      body: JSON.stringify({
        email: testUsers.DOCTOR.email,
        password: TEST_PASSWORD,
      }),
    });
    assert.equal(allowedRes.status, 200);

    // 3. No Origin header (such as curl) -> Allowed
    const curlRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: testUsers.DOCTOR.email,
        password: TEST_PASSWORD,
      }),
    });
    assert.equal(curlRes.status, 200);
  });

  test('10. the app refuses to start without JWT_SECRET (or when < 32 characters)', () => {
    // Missing JWT_SECRET
    assert.throws(
      () =>
        validateEnv({
          ...process.env,
          JWT_SECRET: '',
        }),
      /JWT_SECRET/,
      'Must refuse to start when JWT_SECRET is empty/missing',
    );

    // Short JWT_SECRET (< 32 chars)
    assert.throws(
      () =>
        validateEnv({
          ...process.env,
          JWT_SECRET: 'too_short_secret_under_32_chars',
        }),
      /at least 32 characters/,
      'Must refuse to start when JWT_SECRET is less than 32 characters',
    );

    const startup = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/server.ts'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 5_000,
        env: { ...process.env, JWT_SECRET: '' },
      },
    );
    assert.equal(startup.status, 1, 'server process must exit on invalid env');
    assert.match(`${startup.stderr}${startup.stdout}`, /JWT_SECRET/);
  });

  test('11. passwordHash never appears in any response', async () => {
    // 1. Check login response body
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUsers.ADMIN.email,
        password: TEST_PASSWORD,
      }),
    });
    const loginText = await loginRes.text();
    assert.ok(!loginText.includes('passwordHash'), 'login response must not leak passwordHash');
    const cookie = loginRes.headers.get('set-cookie') || '';

    // 2. Check /auth/me response body
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: cookie },
    });
    const meText = await meRes.text();
    assert.ok(!meText.includes('passwordHash'), '/auth/me response must not leak passwordHash');

    // 3. Check error response body
    const errRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUsers.ADMIN.email,
        password: 'wrong',
      }),
    });
    const errText = await errRes.text();
    assert.ok(!errText.includes('passwordHash'), 'error response must not leak passwordHash');
  });

  test('rejects non-JSON content type on write requests', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'email=test@careloop.local&password=123',
    });
    assert.equal(res.status, 415);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });
});
