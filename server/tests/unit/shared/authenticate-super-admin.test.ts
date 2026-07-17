import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { authenticateSuperAdmin } from '../../../src/shared/middleware/authenticate-super-admin';
import { ForbiddenError } from '../../../src/shared/middleware/error-handler';
import { UserRole } from '../../../src/shared/types/common.types';

jest.mock('../../../src/shared/middleware/authenticate-jwt', () => ({
  authenticateJWT: jest.fn((req, _res, next) => {
    req.user = req.mockUser;
    next();
  }),
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));

describe('authenticateSuperAdmin', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('allows SUPER_ADMIN requests through the dedicated middleware', () => {
    const req = {
      mockUser: {
        userId: 'sa-1',
        tenantId: null,
        role: UserRole.SUPER_ADMIN,
        email: 'sa@hms.com',
        isFirstLogin: false,
      },
      path: '/api/tenants/tenant-1/reactivate',
      method: 'PATCH',
    } as unknown as Request & { mockUser: unknown };
    const next = jest.fn();

    authenticateSuperAdmin(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('rejects non-SUPER_ADMIN users', () => {
    const req = {
      mockUser: {
        userId: 'ha-1',
        tenantId: 'tenant-1',
        role: UserRole.HOSPITAL_ADMIN,
        email: 'admin@hms.com',
        isFirstLogin: false,
      },
      path: '/api/tenants/tenant-1/reactivate',
      method: 'PATCH',
    } as unknown as Request & { mockUser: unknown };
    const next = jest.fn();

    authenticateSuperAdmin(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  test('tenant reactivation route is wired to authenticateSuperAdmin', () => {
    const routeSource = fs.readFileSync(
      path.join(__dirname, '../../../src/modules/tenant/tenant.routes.ts'),
      'utf8',
    );

    expect(routeSource).toContain("router.patch('/:tenantId/reactivate',   authenticateSuperAdmin, reactivateTenant);");
  });
});
