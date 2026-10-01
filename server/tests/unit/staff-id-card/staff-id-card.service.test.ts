const mockConfig = {
  nodeEnv: 'test',
  staffVerification: { baseUrl: 'https://verify.test.example.com', rateLimitWindowMs: 900000, rateLimitMax: 30 },
};
jest.mock('../../../src/shared/config/env', () => ({ __esModule: true, default: mockConfig }));

jest.mock('../../../src/modules/staff-id-card/staff-id-card.repository', () => ({
  staffIdCardRepository: {
    replaceIssuedCard:           jest.fn(),
    findByVerificationTokenHash: jest.fn(),
  },
}));
jest.mock('../../../src/modules/user/user.repository', () => ({
  userRepository: { findById: jest.fn() },
}));
jest.mock('../../../src/modules/tenant/tenant.model', () => ({
  TenantModel: { findById: jest.fn() },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn().mockResolvedValue(undefined),
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.test/presigned'),
    deleteFile:      jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/modules/staff-id-card/staff-id-card.pdf', () => ({
  ...jest.requireActual('../../../src/modules/staff-id-card/staff-id-card.pdf'),
  buildStaffIdCardPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')),
}));

import { staffIdCardService, maskEmployeeId } from '../../../src/modules/staff-id-card/staff-id-card.service';
import { staffIdCardRepository } from '../../../src/modules/staff-id-card/staff-id-card.repository';
import { userRepository } from '../../../src/modules/user/user.repository';
import { TenantModel } from '../../../src/modules/tenant/tenant.model';
import { s3Service } from '../../../src/shared/services/s3.service';
import { auditService } from '../../../src/shared/services/audit.service';
import { buildStaffIdCardPdf } from '../../../src/modules/staff-id-card/staff-id-card.pdf';
import {
  generateVerificationToken,
  hashVerificationToken,
} from '../../../src/modules/staff-id-card/staff-id-card.token';

const repo   = staffIdCardRepository as jest.Mocked<typeof staffIdCardRepository>;
const users  = userRepository as jest.Mocked<typeof userRepository>;
const tenants = TenantModel as unknown as { findById: jest.Mock };
const s3     = s3Service as jest.Mocked<typeof s3Service>;
const pdf    = buildStaffIdCardPdf as jest.Mock;

const TENANT_ID = '65a000000000000000000001';
const USER_ID   = '65b0000000000000000000aa';

const activeUser = () => ({
  _id: USER_ID, tenantId: TENANT_ID, name: 'Nurse Joy', role: 'NURSE', isActive: true,
  email: 'joy@h.com', phone: '9999999999', departmentIds: ['d1'], profileImageUrl: null,
});

const tenantDoc = (status = 'ACTIVE') => ({
  _id: TENANT_ID, name: 'City Hospital Pvt Ltd', status, branding: { displayName: 'City Hospital' },
});

// TenantModel.findById is used both directly (generate) and chained with .select().lean() (verify).
function mockTenant(doc: unknown) {
  const chain = { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(doc) };
  tenants.findById.mockImplementation(() => Object.assign(Promise.resolve(doc), chain));
}

function tokenFromLastPdf(): string {
  const url: string = pdf.mock.calls[pdf.mock.calls.length - 1][0].verificationUrl;
  return url.split('#')[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.nodeEnv = 'test';
  mockConfig.staffVerification.baseUrl = 'https://verify.test.example.com';
  users.findById.mockResolvedValue(activeUser() as never);
  mockTenant(tenantDoc());
  repo.replaceIssuedCard.mockResolvedValue(null);
});

describe('StaffIdCardService.generate — token handling', () => {
  test('embeds a fresh token in the QR URL and stores ONLY its SHA-256 hash', async () => {
    const result = await staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1');

    const url = pdf.mock.calls[0][0].verificationUrl as string;
    expect(url).toMatch(/^https:\/\/verify\.test\.example\.com\/verify-staff#[A-Za-z0-9_-]{43}$/);
    const token = tokenFromLastPdf();

    const stored = repo.replaceIssuedCard.mock.calls[0][2];
    expect(stored.verificationTokenHash).toBe(hashVerificationToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);

    // Token never leaves the PDF: not in the API result, not in the audit log.
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify((auditService.log as jest.Mock).mock.calls)).not.toContain(token);
    expect(JSON.stringify((auditService.log as jest.Mock).mock.calls)).not.toContain(stored.verificationTokenHash);
  });

  test('QR URL carries no userId, tenantId or personal data', async () => {
    await staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1');
    const url = pdf.mock.calls[0][0].verificationUrl as string;
    for (const secret of [USER_ID, TENANT_ID, 'Nurse Joy', 'joy@h.com', '9999999999', 'NURSE']) {
      expect(url).not.toContain(secret);
    }
  });

  test('rotates the token on every regenerate', async () => {
    await staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1');
    const first = tokenFromLastPdf();
    await staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1');
    const second = tokenFromLastPdf();

    expect(second).not.toBe(first);
    expect(repo.replaceIssuedCard.mock.calls[1][2].verificationTokenHash)
      .not.toBe(repo.replaceIssuedCard.mock.calls[0][2].verificationTokenHash);
  });

  test('uploads a new unique S3 object per generation, before the DB write', async () => {
    const order: string[] = [];
    s3.uploadFile.mockImplementation(async () => { order.push('upload'); return undefined as never; });
    repo.replaceIssuedCard.mockImplementation(async () => { order.push('db'); return null; });

    await staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1');
    await staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1');

    expect(order).toEqual(['upload', 'db', 'upload', 'db']);
    const [k1, k2] = s3.uploadFile.mock.calls.map((c) => c[0]);
    expect(k1).not.toBe(k2);
    expect(repo.replaceIssuedCard.mock.calls[0][2].s3Key).toBe(k1);
    expect(repo.replaceIssuedCard.mock.calls[1][2].s3Key).toBe(k2);
  });

  test('deletes the superseded PDF and reports isNew=false on regenerate', async () => {
    repo.replaceIssuedCard.mockResolvedValue({ s3Key: 'tenants/t/staff-id-cards/u.pdf' } as never);
    const result = await staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1');
    expect(result.isNew).toBe(false);
    expect(s3.deleteFile).toHaveBeenCalledWith('tenants/t/staff-id-cards/u.pdf');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
  });

  test('first issue: isNew=true, nothing deleted', async () => {
    const result = await staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1');
    expect(result.isNew).toBe(true);
    expect(s3.deleteFile).not.toHaveBeenCalled();
  });

  test('upload failure → 502 and the DB (old valid card) is left untouched', async () => {
    s3.uploadFile.mockRejectedValueOnce(new Error('s3 down'));
    await expect(staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1'))
      .rejects.toMatchObject({ statusCode: 502 });
    expect(repo.replaceIssuedCard).not.toHaveBeenCalled();
  });

  test('DB write failure → the just-uploaded orphan PDF is removed', async () => {
    repo.replaceIssuedCard.mockRejectedValueOnce(new Error('db down'));
    await expect(staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1')).rejects.toThrow('db down');
    expect(s3.deleteFile).toHaveBeenCalledWith(s3.uploadFile.mock.calls[0][0]);
  });

  test('fails closed with no upload when STAFF_VERIFY_BASE_URL is unset', async () => {
    mockConfig.staffVerification.baseUrl = '';
    await expect(staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1'))
      .rejects.toMatchObject({ statusCode: 500 });
    expect(pdf).not.toHaveBeenCalled();
    expect(s3.uploadFile).not.toHaveBeenCalled();
  });

  test('fails closed on an http base URL in production', async () => {
    mockConfig.nodeEnv = 'production';
    mockConfig.staffVerification.baseUrl = 'http://hms.example.com';
    await expect(staffIdCardService.generate(TENANT_ID, USER_ID, 'admin1'))
      .rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('StaffIdCardService.verify', () => {
  const token = generateVerificationToken();
  const future = new Date(Date.now() + 86_400_000);
  const card = (overrides = {}) => ({
    tenantId: TENANT_ID, userId: USER_ID,
    issuedAt: new Date('2026-01-01T00:00:00Z'), expiresAt: future, ...overrides,
  });
  const NOT_VALID = { valid: false, status: 'INACTIVE' };

  test('valid card → exactly the allow-listed fields', async () => {
    repo.findByVerificationTokenHash.mockResolvedValue(card());
    const result = await staffIdCardService.verify(token);

    expect(result).toEqual({
      valid:        true,
      status:       'ACTIVE',
      name:         'Nurse Joy',
      employeeId:   maskEmployeeId(USER_ID),
      role:         'NURSE',
      hospitalName: 'City Hospital',
      issuedAt:     '2026-01-01',
      expiresAt:    future.toISOString().slice(0, 10),
    });
    const json = JSON.stringify(result);
    for (const leaked of [USER_ID, TENANT_ID, 'joy@h.com', '9999999999', 'd1', token, hashVerificationToken(token)]) {
      expect(json).not.toContain(leaked);
    }
  });

  test('looks up by token hash only, then scopes user read to the card tenantId', async () => {
    repo.findByVerificationTokenHash.mockResolvedValue(card());
    await staffIdCardService.verify(token);
    expect(repo.findByVerificationTokenHash).toHaveBeenCalledWith(hashVerificationToken(token));
    expect(users.findById).toHaveBeenCalledWith(TENANT_ID, USER_ID);
    expect(tenants.findById).toHaveBeenCalledWith(TENANT_ID);
  });

  test('falls back to tenant.name when no display name is branded', async () => {
    repo.findByVerificationTokenHash.mockResolvedValue(card());
    mockTenant({ ...tenantDoc(), branding: { displayName: '' } });
    expect(await staffIdCardService.verify(token)).toMatchObject({ hospitalName: 'City Hospital Pvt Ltd' });
  });

  test.each([
    ['malformed token',  'short'] as [string, unknown],
    ['non-string token', { $ne: null }] as [string, unknown],
    ['userId as token',  USER_ID] as [string, unknown],
  ])('%s → NOT_VALID without touching the DB', async (_l, value) => {
    expect(await staffIdCardService.verify(value)).toEqual(NOT_VALID);
    expect(repo.findByVerificationTokenHash).not.toHaveBeenCalled();
  });

  test('unknown / rotated token → NOT_VALID', async () => {
    repo.findByVerificationTokenHash.mockResolvedValue(null);
    expect(await staffIdCardService.verify(token)).toEqual(NOT_VALID);
  });

  test('expired card → NOT_VALID and user is never loaded', async () => {
    repo.findByVerificationTokenHash.mockResolvedValue(card({ expiresAt: new Date(Date.now() - 1000) }));
    expect(await staffIdCardService.verify(token)).toEqual(NOT_VALID);
    expect(users.findById).not.toHaveBeenCalled();
  });

  test('inactive user → NOT_VALID', async () => {
    repo.findByVerificationTokenHash.mockResolvedValue(card());
    users.findById.mockResolvedValue({ ...activeUser(), isActive: false } as never);
    expect(await staffIdCardService.verify(token)).toEqual(NOT_VALID);
  });

  test('user missing in the card tenant → NOT_VALID', async () => {
    repo.findByVerificationTokenHash.mockResolvedValue(card());
    users.findById.mockResolvedValue(null as never);
    expect(await staffIdCardService.verify(token)).toEqual(NOT_VALID);
  });

  test('user tenant mismatch → NOT_VALID', async () => {
    repo.findByVerificationTokenHash.mockResolvedValue(card());
    users.findById.mockResolvedValue({ ...activeUser(), tenantId: 'other' } as never);
    expect(await staffIdCardService.verify(token)).toEqual(NOT_VALID);
  });

  test.each(['INACTIVE', 'PENDING_VERIFICATION'])('tenant status %s → NOT_VALID', async (status) => {
    repo.findByVerificationTokenHash.mockResolvedValue(card());
    mockTenant(tenantDoc(status));
    expect(await staffIdCardService.verify(token)).toEqual(NOT_VALID);
  });

  test('tenant missing → NOT_VALID', async () => {
    repo.findByVerificationTokenHash.mockResolvedValue(card());
    mockTenant(null);
    expect(await staffIdCardService.verify(token)).toEqual(NOT_VALID);
  });
});

describe('maskEmployeeId', () => {
  test('shows only the last 6 characters', () => {
    expect(maskEmployeeId('507f1f77bcf86cd799439011')).toBe('••••439011');
    expect(maskEmployeeId('507f1f77bcf86cd799439011')).not.toContain('507f1f77bcf86cd7');
  });
});
