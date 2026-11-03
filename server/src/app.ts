import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { RoleSchema, type Role } from '@careloop/shared';

import { getEnv, type Env } from './config/env';
import { DatabaseClock, type Clock } from './core/clock';
import { errorHandler, AppError } from './middleware/error/errorHandler';
import { jsonBodyOnly } from './middleware/body/jsonBodyMiddleware';
import { createOriginMiddleware } from './middleware/origin/originMiddleware';
import { createAuthMiddleware } from './middleware/auth/authMiddleware';
import { requireRole } from './middleware/role/roleMiddleware';
import { AuthService } from './modules/auth/authService';
import { createAuthRouter } from './modules/auth/authRoutes';

export interface AppContext {
  prisma: PrismaClient;
  clock: Clock;
  env: Env;
  authService: AuthService;
  authenticate: ReturnType<typeof createAuthMiddleware>;
}

export function createApp(
  customContext?: Partial<AppContext>,
  customTestRoutes?: (router: Router, ctx: AppContext) => void,
): Express {
  const env = customContext?.env ?? getEnv();
  const prisma = customContext?.prisma ?? new PrismaClient();
  const clock =
    customContext?.clock ?? new DatabaseClock(prisma.systemSetting);

  const authService =
    customContext?.authService ??
    new AuthService(prisma, clock, env.JWT_SECRET);
  const authenticate =
    customContext?.authenticate ??
    createAuthMiddleware(prisma, env.JWT_SECRET);

  const ctx: AppContext = {
    prisma,
    clock,
    env,
    authService,
    authenticate,
  };

  const app = express();

  // Security headers
  app.use(helmet());

  // Cookie parsing
  app.use(cookieParser());

  // Check Origin on state-changing requests
  app.use(createOriginMiddleware(env.CLIENT_ORIGIN));

  // Reject non-JSON content types on write requests
  app.use(jsonBodyOnly);

  // Parse JSON bodies
  app.use(express.json());

  // Health endpoint unchanged
  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'OK' });
  });

  // API v1 router
  const apiV1Router = express.Router();

  // Auth routes mounted under /api/v1/auth
  apiV1Router.use(
    '/auth',
    createAuthRouter(authService, authenticate, env),
  );

  // Development/test-only routes for verifying requireRole matrix and auth behaviors
  if (env.NODE_ENV !== 'production') {
    // Matrix test routes: /api/v1/test/roles/:role
    for (const role of RoleSchema.options) {
      apiV1Router.get(
        `/test/roles/${role.toLowerCase()}`,
        authenticate,
        requireRole(role as Role),
        (req, res) => {
          res.status(200).json({
            status: 'ALLOWED',
            role,
            userRole: req.user?.role,
          });
        },
      );
    }

    if (customTestRoutes) {
      customTestRoutes(apiV1Router, ctx);
    }
  }

  app.use('/api/v1', apiV1Router);

  // Unknown route handler under /api/v1
  app.use('/api/v1', (_req, _res, next) => {
    next(AppError.notFound('API endpoint not found.'));
  });

  // Central error handler
  app.use(errorHandler);

  return app;
}

// Default application instance for server startup
const defaultPrisma = new PrismaClient();
export const clock = new DatabaseClock(defaultPrisma.systemSetting);
export const app = createApp({ prisma: defaultPrisma, clock });

export default app;
