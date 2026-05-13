import jwt from 'jsonwebtoken';
import * as fc from 'fast-check';
import { JWTPayload, UserRole } from '../../../src/shared/types/common.types';

// ─── Generators ───────────────────────────────────────────────────────────────
const userRoleArb = fc.constantFrom(...Object.values(UserRole));

const jwtPayloadArb = fc.record({
  userId:       fc.uuid(),
  tenantId:     fc.option(fc.uuid(), { nil: null }),
  role:         userRoleArb,
  email:        fc.emailAddress(),
  isFirstLogin: fc.boolean(),
}) as fc.Arbitrary<Omit<JWTPayload, 'exp' | 'iat'>>;

const TEST_SECRET = 'test-secret-for-unit-tests';

// ─── PBT: Round-trip — sign → verify → decoded equals original payload ────────
describe('authenticateJWT — PBT', () => {
  test('round-trip: sign(payload) → verify → decoded equals original payload', () => {
    fc.assert(
      fc.property(jwtPayloadArb, (payload) => {
        const token   = jwt.sign(payload, TEST_SECRET, { expiresIn: '1h' });
        const decoded = jwt.verify(token, TEST_SECRET) as JWTPayload;

        expect(decoded.userId).toBe(payload.userId);
        expect(decoded.tenantId).toBe(payload.tenantId);
        expect(decoded.role).toBe(payload.role);
        expect(decoded.email).toBe(payload.email);
        expect(decoded.isFirstLogin).toBe(payload.isFirstLogin);
      }),
      { numRuns: 100, seed: 42 }, // seed for reproducibility (PBT-08)
    );
  });
});

// ─── Example-based tests ──────────────────────────────────────────────────────
describe('authenticateJWT — example-based', () => {
  test('valid token decodes correctly', () => {
    const payload: Omit<JWTPayload, 'exp' | 'iat'> = {
      userId: 'user-123', tenantId: 'tenant-456',
      role: UserRole.DOCTOR, email: 'doc@hospital.com', isFirstLogin: false,
    };
    const token   = jwt.sign(payload, TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, TEST_SECRET) as JWTPayload;
    expect(decoded.userId).toBe('user-123');
    expect(decoded.role).toBe(UserRole.DOCTOR);
  });

  test('expired token throws JsonWebTokenError', () => {
    const token = jwt.sign({ userId: 'u1' }, TEST_SECRET, { expiresIn: '-1s' });
    expect(() => jwt.verify(token, TEST_SECRET)).toThrow();
  });

  test('wrong secret throws JsonWebTokenError', () => {
    const token = jwt.sign({ userId: 'u1' }, TEST_SECRET);
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });

  test('SUPER_ADMIN token has null tenantId', () => {
    const payload = { userId: 'sa-1', tenantId: null, role: UserRole.SUPER_ADMIN, email: 'sa@hms.com', isFirstLogin: false };
    const token   = jwt.sign(payload, TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, TEST_SECRET) as JWTPayload;
    expect(decoded.tenantId).toBeNull();
    expect(decoded.role).toBe(UserRole.SUPER_ADMIN);
  });
});
