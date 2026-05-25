import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import { UserRole } from '../../../src/shared/types/common.types';

// ─── PBT: JWT lockout counter invariant ──────────────────────────────────────
describe('AuthService — PBT', () => {
  test('round-trip: JWT sign → verify → payload equality', () => {
    const secret = 'test-secret';
    fc.assert(
      fc.property(
        fc.record({
          userId:       fc.uuid(),
          tenantId:     fc.option(fc.uuid(), { nil: null }),
          role:         fc.constantFrom(...Object.values(UserRole)),
          email:        fc.emailAddress(),
          isFirstLogin: fc.boolean(),
        }),
        (payload) => {
          const token   = jwt.sign(payload, secret, { expiresIn: '1h' });
          const decoded = jwt.verify(token, secret) as typeof payload;
          expect(decoded.userId).toBe(payload.userId);
          expect(decoded.role).toBe(payload.role);
          expect(decoded.isFirstLogin).toBe(payload.isFirstLogin);
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });
});

// ─── Example-based: AuthService business logic ───────────────────────────────
// These tests use mocks to isolate the service from DB and email dependencies.

jest.mock('../../../src/modules/auth/auth.repository');
jest.mock('../../../src/shared/services/email.service');
jest.mock('../../../src/shared/services/audit.service');
jest.mock('../../../src/shared/middleware/token-denylist');

import { authRepository } from '../../../src/modules/auth/auth.repository';
import { emailService } from '../../../src/shared/services/email.service';
import { AuthService } from '../../../src/modules/auth/auth.service';
import bcrypt from 'bcryptjs';

const mockAuthRepo   = authRepository as jest.Mocked<typeof authRepository>;
const mockEmailSvc   = emailService   as jest.Mocked<typeof emailService>;

// Env vars are provided by tests/setup.ts (setupFiles) — no overrides needed here.

describe('AuthService — example-based', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService();
  });

  test('logout is idempotent — invalid token does not throw', async () => {
    await expect(service.logout('invalid-token')).resolves.toBeUndefined();
  });

  test('validateJWT throws UnauthorizedError for invalid token', () => {
    expect(() => service.validateJWT('bad-token')).toThrow('Invalid or expired token');
  });

  test('validateJWT returns payload for valid token', () => {
    const payload = { userId: 'u1', tenantId: 't1', role: UserRole.DOCTOR, email: 'doc@h.com', isFirstLogin: false };
    const token   = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '1h' }); // setup.ts provides JWT_SECRET
    const decoded = service.validateJWT(token);
    expect(decoded.userId).toBe('u1');
    expect(decoded.role).toBe(UserRole.DOCTOR);
  });

  test('changePassword returns a fresh JWT with isFirstLogin: false', async () => {
    const hashedCurrent = await bcrypt.hash('OldPass1!', 10);
    mockAuthRepo.findUserById.mockResolvedValue({
      _id:          { toString: () => 'u1' },
      email:        'doc@h.com',
      role:         UserRole.DOCTOR,
      tenantId:     't1',
      passwordHash: hashedCurrent,
      isFirstLogin: true,
    } as never);
    mockAuthRepo.recordPasswordChange.mockResolvedValue(undefined);

    const result = await service.changePassword('u1', 't1', 'OldPass1!', 'NewPass2@');

    expect(result).toHaveProperty('token');
    const decoded = service.validateJWT(result.token);
    expect(decoded.isFirstLogin).toBe(false);
    expect(decoded.userId).toBe('u1');
  });
});
