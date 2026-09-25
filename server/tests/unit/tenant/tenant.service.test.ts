jest.mock('../../../src/modules/tenant/tenant.repository');
jest.mock('../../../src/shared/services/email.service');
jest.mock('../../../src/shared/services/s3.service');
jest.mock('../../../src/shared/services/audit.service');
jest.mock('../../../src/shared/config/tenant-cache');

import { PDFDocument } from 'pdf-lib';
import { tenantRepository } from '../../../src/modules/tenant/tenant.repository';
import { emailService } from '../../../src/shared/services/email.service';
import { s3Service } from '../../../src/shared/services/s3.service';
import { tenantCache } from '../../../src/shared/config/tenant-cache';
import { TenantService } from '../../../src/modules/tenant/tenant.service';
import { TenantStatus } from '../../../src/shared/types/common.types';
import { A4_WIDTH_PT, A4_HEIGHT_PT } from '../../../src/shared/services/parcha-template.service';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/shared/middleware/error-handler';

const mockRepo      = tenantRepository as jest.Mocked<typeof tenantRepository>;
const mockEmailSvc  = emailService     as jest.Mocked<typeof emailService>;
const mockS3        = s3Service        as jest.Mocked<typeof s3Service>;
const mockCache     = tenantCache      as jest.Mocked<typeof tenantCache>;

async function makePdf(pageSizes: [number, number][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const size of pageSizes) doc.addPage(size);
  return Buffer.from(await doc.save());
}

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
      { name: 'Hospital A', adminEmail: 'admin@h.com', onboardingDocuments: { registrationCertificate: 'k1', gstNumber: 'GST1', panCard: 'k2', addressLine: '123 Test Street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' } },
      'sa-1',
    );
    expect(result.status).toBe(TenantStatus.PENDING_VERIFICATION);
  });

  test('createTenant throws ConflictError when adminEmail already exists', async () => {
    mockRepo.findByAdminEmail.mockResolvedValue({ _id: 'tid0', status: TenantStatus.ACTIVE, toString: () => 'tid0' } as never);

    await expect(
      service.createTenant(
        { name: 'Hospital B', adminEmail: 'Admin@H.com ', onboardingDocuments: { registrationCertificate: 'k1', gstNumber: 'GST1', panCard: 'k2', addressLine: '123 Test Street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' } },
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
      { name: 'Hospital A', adminEmail: '  Admin@H.com  ', onboardingDocuments: { registrationCertificate: 'k1', gstNumber: 'GST1', panCard: 'k2', addressLine: '123 Test Street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' } },
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

  // ── Parcha template ──────────────────────────────────────────────────────────
  describe('uploadParchaTemplate', () => {
    test('rejects a multi-page PDF before ever uploading to S3', async () => {
      mockRepo.findById.mockResolvedValue({ _id: 'tid1', branding: { parchaTemplateUrl: null }, toString: () => 'tid1' } as never);
      const twoPagePdf = await makePdf([[A4_WIDTH_PT, A4_HEIGHT_PT], [A4_WIDTH_PT, A4_HEIGHT_PT]]);

      await expect(
        service.uploadParchaTemplate('tid1', twoPagePdf, 'application/pdf', 'admin-1'),
      ).rejects.toThrow(ValidationError);
      expect(mockS3.uploadFile).not.toHaveBeenCalled();
      expect(mockRepo.updateParchaTemplate).not.toHaveBeenCalled();
    });

    test('rejects a non-A4 PDF before ever uploading to S3', async () => {
      mockRepo.findById.mockResolvedValue({ _id: 'tid1', branding: { parchaTemplateUrl: null }, toString: () => 'tid1' } as never);
      const letterPdf = await makePdf([[612, 792]]);

      await expect(
        service.uploadParchaTemplate('tid1', letterPdf, 'application/pdf', 'admin-1'),
      ).rejects.toThrow(ValidationError);
      expect(mockS3.uploadFile).not.toHaveBeenCalled();
    });

    test('accepts a valid single-page A4 PDF and stores it', async () => {
      mockRepo.findById.mockResolvedValue({ _id: 'tid1', branding: { parchaTemplateUrl: null }, toString: () => 'tid1' } as never);
      mockS3.uploadFile.mockResolvedValue('tenants/tid1/parcha-template/template.pdf');
      const validPdf = await makePdf([[A4_WIDTH_PT, A4_HEIGHT_PT]]);

      await service.uploadParchaTemplate('tid1', validPdf, 'application/pdf', 'admin-1');

      expect(mockS3.uploadFile).toHaveBeenCalledWith(
        'tenants/tid1/parcha-template/template.pdf', validPdf, 'application/pdf',
      );
      expect(mockRepo.updateParchaTemplate).toHaveBeenCalledWith('tid1', 'tenants/tid1/parcha-template/template.pdf');
    });

    test('still accepts a PNG/JPEG template without PDF validation', async () => {
      mockRepo.findById.mockResolvedValue({ _id: 'tid1', branding: { parchaTemplateUrl: null }, toString: () => 'tid1' } as never);
      mockS3.uploadFile.mockResolvedValue('tenants/tid1/parcha-template/template.png');
      const imageBuffer = Buffer.from('not-really-a-png-but-validation-only-applies-to-pdf');

      await expect(
        service.uploadParchaTemplate('tid1', imageBuffer, 'image/png', 'admin-1'),
      ).resolves.toBeUndefined();
      expect(mockS3.uploadFile).toHaveBeenCalledWith(
        'tenants/tid1/parcha-template/template.png', imageBuffer, 'image/png',
      );
    });
  });

  // ── OPD settings ────────────────────────────────────────────────────────────
  describe('getOpdSettings / updateOpdSettings', () => {
    test('getOpdSettings falls back to the default (15 days) when unset', async () => {
      mockRepo.findById.mockResolvedValue({ _id: 'tid1', opdSettings: undefined, toString: () => 'tid1' } as never);

      const result = await service.getOpdSettings('tid1');

      expect(result).toEqual({ validityDays: 15 });
    });

    test('getOpdSettings returns the tenant-configured value when set', async () => {
      mockRepo.findById.mockResolvedValue({ _id: 'tid1', opdSettings: { validityDays: 30 }, toString: () => 'tid1' } as never);

      const result = await service.getOpdSettings('tid1');

      expect(result).toEqual({ validityDays: 30 });
    });

    test('getOpdSettings throws NotFoundError for an unknown tenant', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.getOpdSettings('unknown')).rejects.toThrow(NotFoundError);
    });

    test('updateOpdSettings persists the new value and writes an audit log', async () => {
      mockRepo.findById.mockResolvedValue({ _id: 'tid1', opdSettings: { validityDays: 15 }, toString: () => 'tid1' } as never);
      mockRepo.updateOpdValidityDays.mockResolvedValue(undefined);

      const result = await service.updateOpdSettings('tid1', 30, 'admin-1');

      expect(result).toEqual({ validityDays: 30 });
      expect(mockRepo.updateOpdValidityDays).toHaveBeenCalledWith('tid1', 30);
    });

    test('updateOpdSettings throws NotFoundError for an unknown tenant', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.updateOpdSettings('unknown', 30, 'admin-1')).rejects.toThrow(NotFoundError);
    });
  });
});
