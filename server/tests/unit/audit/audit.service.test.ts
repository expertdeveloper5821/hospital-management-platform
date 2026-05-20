jest.mock('../../../src/modules/audit/audit.repository');
jest.mock('../../../src/modules/notification/notification.service', () => ({
  notificationService: {
    sendToRole: jest.fn().mockResolvedValue(undefined),
  },
}));

import { auditRepository }    from '../../../src/modules/audit/audit.repository';
import { AuditService }       from '../../../src/modules/audit/audit.service';
import { IAuditLog }          from '../../../src/modules/audit/audit.model';
import { AuditLogEntry, AuditEntityType } from '../../../src/shared/types/common.types';

const mockRepo = auditRepository as jest.Mocked<typeof auditRepository>;

const BASE_ENTRY: AuditLogEntry = {
  entityType: AuditEntityType.PATIENT,
  entityId:   'pat-001',
  action:     'CREATE',
  userId:     'user-001',
  tenantId:   'tenant-001',
};

function makeAuditLog(overrides: Partial<IAuditLog> = {}): IAuditLog {
  return {
    auditId:    'audit-001',
    entityType: AuditEntityType.PATIENT,
    entityId:   'pat-001',
    action:     'CREATE',
    userId:     'user-001',
    tenantId:   'tenant-001',
    timestamp:  new Date(),
    ...overrides,
  } as unknown as IAuditLog;
}

let service: AuditService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new AuditService();
});

// ─── log() ────────────────────────────────────────────────────────────────────

describe('log', () => {
  test('saves entry via repository', async () => {
    mockRepo.save.mockResolvedValue(makeAuditLog());

    await service.log(BASE_ENTRY);

    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'PATIENT',
      entityId:   'pat-001',
      action:     'CREATE',
      userId:     'user-001',
      tenantId:   'tenant-001',
    }));
  });

  test('never throws when repository save fails (FR-14.5)', async () => {
    mockRepo.save.mockRejectedValue(new Error('DB unavailable'));

    await expect(service.log(BASE_ENTRY)).resolves.toBeUndefined();
  });

  test('never throws even when save throws a non-Error value', async () => {
    mockRepo.save.mockRejectedValue('string error');

    await expect(service.log(BASE_ENTRY)).resolves.toBeUndefined();
  });

  test('uses provided timestamp when present', async () => {
    const ts = new Date('2025-01-15T10:00:00Z');
    mockRepo.save.mockResolvedValue(makeAuditLog({ timestamp: ts }));

    await service.log({ ...BASE_ENTRY, timestamp: ts });

    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ timestamp: ts }));
  });

  test('works with null tenantId (SUPER_ADMIN cross-tenant action)', async () => {
    mockRepo.save.mockResolvedValue(makeAuditLog({ tenantId: null }));

    await expect(service.log({ ...BASE_ENTRY, tenantId: null })).resolves.toBeUndefined();
    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null }));
  });
});

// ─── queryLogs() ──────────────────────────────────────────────────────────────

describe('queryLogs', () => {
  test('delegates to repository with tenantId and filters', async () => {
    const paginated = {
      data: [makeAuditLog()], total: 1, page: 1, limit: 50, totalPages: 1,
    };
    mockRepo.query.mockResolvedValue(paginated);

    const result = await service.queryLogs('tenant-001', { entityType: 'PATIENT', page: 1 });

    expect(mockRepo.query).toHaveBeenCalledWith('tenant-001', { entityType: 'PATIENT', page: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  test('passes null tenantId for SUPER_ADMIN cross-tenant query', async () => {
    mockRepo.query.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 });

    await service.queryLogs(null, {});

    expect(mockRepo.query).toHaveBeenCalledWith(null, {});
  });

  test('returns empty paginated result when no logs match', async () => {
    mockRepo.query.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 });

    const result = await service.queryLogs('tenant-001', { entityId: 'does-not-exist' });

    expect(result.data).toHaveLength(0);
    expect(result.totalPages).toBe(0);
  });
});
