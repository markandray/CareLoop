import { describe, expect, it } from 'vitest';
import type { Role } from '@careloop/shared';
import {
  ROLE_LANDING_ROUTES,
  getRoleLandingRoute,
  isRoleAllowedOnPath,
} from '../lib/auth';

describe('Role to route mapping and access control', () => {
  it('maps each role to its designated landing route', () => {
    expect(ROLE_LANDING_ROUTES.PATIENT).toBe('/patient');
    expect(ROLE_LANDING_ROUTES.DOCTOR).toBe('/doctor');
    expect(ROLE_LANDING_ROUTES.COORDINATOR).toBe('/coordinator');
    expect(ROLE_LANDING_ROUTES.ADMIN).toBe('/admin');
  });

  it('getRoleLandingRoute returns correct route for each role', () => {
    expect(getRoleLandingRoute('PATIENT')).toBe('/patient');
    expect(getRoleLandingRoute('DOCTOR')).toBe('/doctor');
    expect(getRoleLandingRoute('COORDINATOR')).toBe('/coordinator');
    expect(getRoleLandingRoute('ADMIN')).toBe('/admin');
  });

  const roles: Role[] = ['PATIENT', 'DOCTOR', 'COORDINATOR', 'ADMIN'];

  roles.forEach((role) => {
    it(`${role} is only allowed on their own path and disallowed on others`, () => {
      const ownRoute = ROLE_LANDING_ROUTES[role];
      expect(isRoleAllowedOnPath(role, ownRoute)).toBe(true);

      const otherRoles = roles.filter((r) => r !== role);
      for (const otherRole of otherRoles) {
        const otherRoute = ROLE_LANDING_ROUTES[otherRole];
        expect(
          isRoleAllowedOnPath(role, otherRoute),
          `${role} must NOT be allowed on ${otherRoute}`
        ).toBe(false);
      }
    });
  });
});

