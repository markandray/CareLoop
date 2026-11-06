import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AuthMeResponseSchema } from '@careloop/shared';
import { AUTH_COOKIE_NAME, getRoleLandingRoute } from './lib/auth';

const PUBLIC_PREFIXES = ['/login', '/api', '/_next', '/favicon.ico'];
const ROLE_AREAS = new Set(['patient', 'doctor', 'coordinator', 'admin']);
const apiInternalUrl = process.env.API_INTERNAL_URL || 'http://localhost:4000';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix)) {
      return NextResponse.next();
    }
  }

  const hasSession = request.cookies.has(AUTH_COOKIE_NAME);
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Ask the API to validate the cookie and supply the current role. The
  // middleware only chooses a landing route; API authorization still protects data.
  try {
    const sessionResponse = await fetch(`${apiInternalUrl}/api/v1/auth/me`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
    if (!sessionResponse.ok) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const parsed = AuthMeResponseSchema.safeParse(await sessionResponse.json());
    if (!parsed.success) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const requestedArea = pathname.split('/')[1];
    if (ROLE_AREAS.has(requestedArea)) {
      const roleLanding = getRoleLandingRoute(parsed.data.user.role);
      if (requestedArea !== roleLanding.slice(1)) {
        return NextResponse.redirect(new URL(roleLanding, request.url));
      }
    }
  } catch {
    // Fail closed when the session authority cannot be reached.
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

