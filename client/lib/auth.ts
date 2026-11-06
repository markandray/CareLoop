import type { Role } from '@careloop/shared';

export const ROLE_LANDING_ROUTES: Record<Role, string> = {
  PATIENT: '/patient',
  DOCTOR: '/doctor',
  COORDINATOR: '/coordinator',
  ADMIN: '/admin',
};

export const AUTH_COOKIE_NAME = 'careloop_session';

export function getRoleLandingRoute(role: Role): string {
  return ROLE_LANDING_ROUTES[role] ?? '/login';
}

export function isRoleAllowedOnPath(role: Role, pathname: string): boolean {
  if (pathname.startsWith('/patient')) return role === 'PATIENT';
  if (pathname.startsWith('/doctor')) return role === 'DOCTOR';
  if (pathname.startsWith('/coordinator')) return role === 'COORDINATOR';
  if (pathname.startsWith('/admin')) return role === 'ADMIN';
  return true;
}
