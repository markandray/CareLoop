import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ActorType, type PrismaClient } from '@prisma/client';
import type { UserSession } from '@careloop/shared';
import type { Clock } from '../../core/clock';
import { record } from '../../core/audit';
import { withTransaction } from '../../core/withTransaction';
import { AppError } from '../../middleware/error/errorHandler';
import { isLoginRateLimited, recordLoginFailure } from './rateLimiter';
import type { TokenPayload } from '../../middleware/auth/authMiddleware';
import { realSystemTimeMs } from '../../core/realTime';

// Pre-computed dummy hash to ensure timing-insensitive comparison when user is not found
const DUMMY_HASH = bcrypt.hashSync('careloop_dummy_timing_mitigation_pass', 10);

export interface LoginResult {
  user: UserSession;
  token: string;
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
    private readonly jwtSecret: string,
  ) {}

  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<LoginResult> {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Check failed login rate limit (5 failures per 15 min per email+IP)
    if (isLoginRateLimited(normalizedEmail, ip)) {
      throw AppError.rateLimited(
        'Too many failed login attempts. Please try again later.',
      );
    }

    // 2. Fetch user
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // 3. Timing-safe password verification
    let passwordMatches = false;
    if (user) {
      passwordMatches = await bcrypt.compare(password, user.passwordHash);
    } else {
      // Execute dummy comparison to mitigate email enumeration via timing side-channels
      await bcrypt.compare(password, DUMMY_HASH);
    }

    if (!user || !passwordMatches) {
      // Record failure for rate limiting (failures only)
      recordLoginFailure(normalizedEmail, ip);

      // Record audit log using the core audit writer and injected clock
      await withTransaction(this.prisma, (tx) =>
        record(
          tx,
          {
            actorType: user ? ActorType.USER : ActorType.SYSTEM,
            actorId: user ? user.id : null,
            action: 'LOGIN_FAILED',
            entityType: 'User',
            entityId: user ? user.id : 'unknown',
          },
          this.clock,
        ),
      );

      // Return identical failure response shape and message
      throw AppError.unauthenticated('Invalid email or password.');
    }

    // 4. Successful login audit log
    await withTransaction(this.prisma, (tx) =>
      record(
        tx,
        {
          actorType: ActorType.USER,
          actorId: user.id,
          action: 'LOGIN_SUCCEEDED',
          entityType: 'User',
          entityId: user.id,
        },
        this.clock,
      ),
    );

    // 5. Issue session JWT
    // Code comment required by specification:
    // Real time vs demo clock: JWT iat/exp and session cookie expiry MUST use real system time,
    // NOT the demo clock, so that advancing the simulated demo clock during demonstrations
    // never logs active users out or truncates sessions prematurely.
    const tokenPayload: TokenPayload = {
      userId: user.id,
      role: user.role,
    };

    const token = jwt.sign(
      { ...tokenPayload, iat: Math.floor(realSystemTimeMs() / 1000) },
      this.jwtSecret,
      {
      expiresIn: '7d',
      },
    );

    const userSession: UserSession = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      providerId: user.providerId,
      language: user.language,
    };

    return { user: userSession, token };
  }

  async logout(user: UserSession): Promise<void> {
    // Record logout audit log via core audit writer
    await withTransaction(this.prisma, (tx) =>
      record(
        tx,
        {
          actorType: ActorType.USER,
          actorId: user.id,
          action: 'LOGOUT',
          entityType: 'User',
          entityId: user.id,
        },
        this.clock,
      ),
    );
  }
}

