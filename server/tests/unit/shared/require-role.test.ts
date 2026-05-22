import * as fc from 'fast-check';
import { UserRole } from '../../../src/shared/types/common.types';

// ─── Generators ───────────────────────────────────────────────────────────────
const userRoleArb    = fc.constantFrom(...Object.values(UserRole));
const roleSubsetArb  = fc.array(userRoleArb, { minLength: 1, maxLength: 6 }).map((arr) => [...new Set(arr)]);

// ─── Pure role-check logic (extracted for testability) ───────────────────────
function hasRole(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(userRole);
}

// ─── PBT: Idempotency — calling the check twice = same result ─────────────────
describe('requireRole — PBT', () => {
  test('idempotent: hasRole(role, allowed) called twice returns same result', () => {
    fc.assert(
      fc.property(userRoleArb, roleSubsetArb, (role, allowed) => {
        const first  = hasRole(role, allowed);
        const second = hasRole(role, allowed);
        expect(first).toBe(second);
      }),
      { numRuns: 200, seed: 42 },
    );
  });

  test('invariant: if role is in allowed list, result is always true', () => {
    fc.assert(
      fc.property(userRoleArb, (role) => {
        expect(hasRole(role, [role])).toBe(true);
      }),
      { numRuns: 100, seed: 42 },
    );
  });

  test('invariant: if allowed list is empty, result is always false', () => {
    fc.assert(
      fc.property(userRoleArb, (role) => {
        expect(hasRole(role, [])).toBe(false);
      }),
      { numRuns: 100, seed: 42 },
    );
  });
});

// ─── Example-based tests ──────────────────────────────────────────────────────
describe('requireRole — example-based', () => {
  test('DOCTOR allowed when DOCTOR is in list', () => {
    expect(hasRole(UserRole.DOCTOR, [UserRole.DOCTOR, UserRole.MANAGER])).toBe(true);
  });

  test('STAFF denied when only DOCTOR and MANAGER allowed', () => {
    expect(hasRole(UserRole.STAFF, [UserRole.DOCTOR, UserRole.MANAGER])).toBe(false);
  });

  test('SUPER_ADMIN allowed when SUPER_ADMIN in list', () => {
    expect(hasRole(UserRole.SUPER_ADMIN, [UserRole.SUPER_ADMIN])).toBe(true);
  });
});
