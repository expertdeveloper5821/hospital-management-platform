jest.mock('../../../src/modules/tenant/tenant.repository');
jest.mock('../../../src/shared/services/email.service');
jest.mock('../../../src/shared/services/s3.service');
jest.mock('../../../src/shared/services/audit.service');
jest.mock('../../../src/shared/config/tenant-cache');

import { tenantRepository } from '../../../src/modules/tenant/tenant.repository';
import { emailService } from '../../../src/shared/services/email.service';
import { tenantCache } from '../../../src/shared/config/tenant-cache';
import { TenantService } from '../../../src/modules/tenant/tenant.service';
import { TenantStatus } from '../../../src/shared/types/common.types';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/shared/middleware/error-handler';

const mockRepo      = tenantRepository as jest.Mocked<typeof tenantRepository>;
const mockEmailSvc  = emailService     as jest.Mocked<typeof emailService>;
const mockCache     = tenantCache      as jest.Mocked<typeof tenantCache>;

process.env.JWT_SECRET         = 'test-secret';
process.env.INVITE_JWT_SECRET  = 'test-invite-secret';
process.env.INVITE_JWT_EXPIRY  = '48h';
process.env.FRONTEND_URL       = 'http://localhost:3001';

describe('TenantService — example-based', () => {
  let service: TenantService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TenantService();
  });

  test('createTenant sets status to PENDING_VERIFICATION', async () => {
    const mockTenant = { _id: 'tid1', name: 'Hospital A', status: TenantStatus.PENDING_VERIFICATION, toString: () => 'tid1' };
    mockRepo.save.mockResolvedValue(mockTenant as never);

    const result = await service.createTenant(
      { name: 'Hospital A', adminEmail: 'admin@h.com', onboardingDocuments: { registrationCertificate: 'k1', gstNumber: 'GST1', panCard: 'k2', addressLine: '123 Test Street', city: 'Mumbai', state: 'Maharashtra' } },
      'sa-1',
    );
    expect(result.status).toBe(TenantStatus.PENDING_VERIFICATION);
  });

  test('createTenant throws ConflictError when adminEmail already exists', async () => {
    mockRepo.findByAdminEmail.mockResolvedValue({ _id: 'tid0', status: TenantStatus.ACTIVE, toString: () => 'tid0' } as never);

    await expect(
      service.createTenant(
        { name: 'Hospital B', adminEmail: 'Admin@H.com ', onboardingDocuments: { registrationCertificate: 'k1', gstNumber: 'GST1', panCard: 'k2', addressLine: '123 Test Street', city: 'Mumbai', state: 'Maharashtra' } },
        'sa-1',
      ),
    ).rejects.toThrow(ConflictError);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  test('createTenant normalizes email casing/whitespace before duplicate lookup', async () => {
    mockRepo.findByAdminEmail.mockResolvedValue(null);
    const mockTenant = { _id: 'tid1', name: 'Hospital A', status: TenantStatus.PENDING_VERIFICATION, toString: () => 'tid1' };
    mockRepo.save.mockResolvedValue(mockTenant as never);

    await service.createTenant(
      { name: 'Hospital A', adminEmail: '  Admin@H.com  ', onboardingDocuments: { registrationCertificate: 'k1', gstNumber: 'GST1', panCard: 'k2', addressLine: '123 Test Street', city: 'Mumbai', state: 'Maharashtra' } },
      'sa-1',
    );
    expect(mockRepo.findByAdminEmail).toHaveBeenCalledWith('admin@h.com');
  });

  test('reactivateTenant sets status back to ACTIVE and invalidates cache', async () => {
    mockRepo.findById.mockResolvedValue({ _id: 'tid1', status: TenantStatus.INACTIVE, toString: () => 'tid1' } as never);
    mockRepo.updateStatus.mockResolvedValue(undefined);

    await service.reactivateTenant('tid1', 'sa-1');
    expect(mockRepo.updateStatus).toHaveBeenCalledWith('tid1', TenantStatus.ACTIVE);
    expect(mockCache.invalidate).toHaveBeenCalledWith('tid1');
  });

  test('reactivateTenant throws ConflictError if tenant is not INACTIVE', async () => {
    mockRepo.findById.mockResolvedValue({ _id: 'tid1', status: TenantStatus.ACTIVE, toString: () => 'tid1' } as never);
    await expect(service.reactivateTenant('tid1', 'sa-1')).rejects.toThrow(ConflictError);
  });

  test('reactivateTenant throws NotFoundError for unknown tenant', async () => {
    mockRepo.findById.mockResolvedValue(null);
    await expect(service.reactivateTenant('unknown', 'sa-1')).rejects.toThrow(NotFoundError);
  });

  test('approveTenant throws ConflictError if already ACTIVE', async () => {
    mockRepo.findById.mockResolvedValue({ _id: 'tid1', status: TenantStatus.ACTIVE, toString: () => 'tid1' } as never);
    await expect(service.approveTenant('tid1', 'sa-1')).rejects.toThrow(ConflictError);
  });

  test('approveTenant sends invite email on success', async () => {
    mockRepo.findById.mockResolvedValue({ _id: 'tid1', status: TenantStatus.PENDING_VERIFICATION, adminEmail: 'admin@h.com', toString: () => 'tid1' } as never);
    mockRepo.updateStatus.mockResolvedValue(undefined);
    mockRepo.saveInviteToken.mockResolvedValue(undefined);
    mockEmailSvc.sendInviteEmail.mockResolvedValue(undefined);

    await service.approveTenant('tid1', 'sa-1');
    expect(mockEmailSvc.sendInviteEmail).toHaveBeenCalledWith('admin@h.com', expect.stringContaining('/setup?token='));
  });

  test('deactivateTenant invalidates tenant cache', async () => {
    mockRepo.findById.mockResolvedValue({ _id: 'tid1', status: TenantStatus.ACTIVE, toString: () => 'tid1' } as never);
    mockRepo.updateStatus.mockResolvedValue(undefined);

    await service.deactivateTenant('tid1', 'sa-1');
    expect(mockCache.invalidate).toHaveBeenCalledWith('tid1');
  });

  test('approveTenant throws NotFoundError for unknown tenant', async () => {
    mockRepo.findById.mockResolvedValue(null);
    await expect(service.approveTenant('unknown', 'sa-1')).rejects.toThrow(NotFoundError);
  });

  test('updateBranding rejects logo > 2MB', async () => {
    mockRepo.findById.mockResolvedValue({ _id: 'tid1', branding: {}, toString: () => 'tid1' } as never);
    const bigBuffer = Buffer.alloc(3 * 1024 * 1024); // 3 MB
    await expect(
      service.updateBranding('tid1', {}, bigBuffer, 'image/jpeg', 'admin-1'),
    ).rejects.toThrow(ValidationError);
  });
});
