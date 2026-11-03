import { Router, type Request, type Response, type NextFunction } from 'express';
import { LoginRequestSchema } from '@careloop/shared';
import { validateBody } from '../../middleware/validate/validateRequest';
import { AUTH_COOKIE_NAME } from '../../middleware/auth/authMiddleware';
import type { AuthService } from './authService';
import type { Env } from '../../config/env';

export function createAuthRouter(
  authService: AuthService,
  authMiddleware: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
  env: Env,
): Router {
  const router = Router();

  // POST /auth/login
  router.post(
    '/login',
    validateBody(LoginRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { email, password } = req.body;
        const ip =
          req.ip ||
          req.socket.remoteAddress ||
          (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          '127.0.0.1';

        const { user, token } = await authService.login(email, password, ip);

        // Session cookie configured per specification:
        // httpOnly: true, SameSite=Strict, Secure in production, 7 days maxAge
        res.cookie(AUTH_COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: env.NODE_ENV === 'production',
          maxAge: 7 * 24 * 60 * 60 * 1000,
          path: '/',
        });

        res.status(200).json({ user });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /auth/logout
  router.post(
    '/logout',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (req.user) {
          await authService.logout(req.user);
        }

        res.clearCookie(AUTH_COOKIE_NAME, {
          httpOnly: true,
          sameSite: 'strict',
          secure: env.NODE_ENV === 'production',
          path: '/',
        });

        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /auth/me
  router.get(
    '/me',
    authMiddleware,
    (req: Request, res: Response) => {
      res.status(200).json({ user: req.user });
    },
  );

  return router;
}

