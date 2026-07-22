// Mock all Mongoose models before importing the service
jest.mock('../../../src/modules/patient/patient.model');
jest.mock('../../../src/modules/opd/opd.model');
jest.mock('../../../src/modules/ipd/ipd.model');
jest.mock('../../../src/modules/ipd/bed.model');
jest.mock('../../../src/modules/lab/lab.model');
jest.mock('../../../src/modules/inventory/inventory.model');
jest.mock('../../../src/modules/payment/payment.model');
jest.mock('../../../src/modules/user/user.model');
jest.mock('../../../src/modules/audit/audit.model');

import { PatientModel }          from '../../../src/modules/patient/patient.model';
import { OPDVisitModel }         from '../../../src/modules/opd/opd.model';
import { IPDAdmissionModel }     from '../../../src/modules/ipd/ipd.model';
import { BedModel }              from '../../../src/modules/ipd/bed.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../../../src/modules/lab/lab.model';
import { InventoryItemModel }    from '../../../src/modules/inventory/inventory.model';
import { PaymentModel }          from '../../../src/modules/payment/payment.model';
import { UserModel }             from '../../../src/modules/user/user.model';
import { AuditLogModel }         from '../../../src/modules/audit/audit.model';
import { auditRepository }       from '../../../src/modules/audit/audit.repository';
import { DashboardService, clearDashboardCache } from '../../../src/modules/dashboard/dashboard.service';
import { UserRole }              from '../../../src/shared/types/common.types';

const TENANT = 'tenant-001';

function mockCount(model: unknown, value: number) {
  (model as jest.MockedClass<typeof PatientModel>).countDocuments = jest.fn().mockResolvedValue(value);
}

function mockAggregate(model: unknown, values: Record<string, unknown>[]) {
  (model as jest.MockedClass<typeof PaymentModel>).aggregate = jest.fn().mockResolvedValue(values);
}

function mockFind(model: unknown, values: unknown[]) {
  (model as { find: jest.Mock }).find = jest.fn().mockReturnValue({
    sort:  jest.fn().mockReturnThis(),
    skip:  jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean:  jest.fn().mockResolvedValue(values),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardService.getStats', () => {
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    clearDashboardCache();
    service = new DashboardService();

    // Default: all counts return 0 / empty arrays
    mockCount(PatientModel,           0);
    mockCount(OPDVisitModel,          0);
    mockCount(IPDAdmissionModel,      0);
    mockCount(PathologyRequestModel,  0);
    mockCount(RadiologyRequestModel,  0);
    mockCount(UserModel,              0);
    mockCount(BedModel,               0);
    mockCount(InventoryItemModel,     0);
    mockCount(PaymentModel,           0);
    mockCount(AuditLogModel,          0);
    mockAggregate(PaymentModel,       []);
    mockAggregate(OPDVisitModel,      []);
    mockAggregate(InventoryItemModel, []);
    mockFind(AuditLogModel,           []);

    // Recent activities now go through the audit repository — mock it directly.
    (auditRepository as unknown as { query: jest.Mock }).query = jest.fn()
      .mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
  });

  // ─── Role filtering ────────────────────────────────────────────────────────

  describe('role filtering — Admin sees all fields', () => {
    test('returns all permitted fields for ADMIN', async () => {
      mockCount(PatientModel, 50);
      mockCount(OPDVisitModel, 10);
      mockCount(IPDAdmissionModel, 5);
      mockCount(PathologyRequestModel, 3);
      mockCount(RadiologyRequestModel, 2);
      mockCount(UserModel, 20);
      // PaymentModel.aggregate: today, month, averageDaily, trend = 4 calls
      (PaymentModel.aggregate as jest.Mock)
        .mockResolvedValueOnce([{ total: 5000 }])   // today
        .mockResolvedValueOnce([{ total: 40000 }])  // month
        .mockResolvedValueOnce([{ total: 30000 }])  // averageDaily (30-day window)
        .mockResolvedValueOnce([]);                 // monthlyRevenueTrend
      mockAggregate(InventoryItemModel, [{ total: 4 }]);
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);

      expect(stats.totalPatients).toBe(50);
      expect(stats.todayOpdCount).toBe(10);
      expect(stats.activeIpdCount).toBe(5);
      expect(stats.pendingLabCount).toBe(5); // 3 + 2
      expect(stats.revenueToday).toBeDefined();
      expect(stats.revenueThisMonth).toBeDefined();
      expect(stats.lowStockCount).toBeDefined();
      expect(stats.totalActiveStaff).toBe(20);
      expect(stats.monthlyOpdTrend).toBeDefined();
      expect(stats.monthlyRevenueTrend).toBeDefined();
      expect(stats.lastUpdated).toBeTruthy();
    });
  });

  describe('patient counts exclude soft-deleted patients', () => {
    test('Total Patients and New Registrations query with isDeleted: { $ne: true }', async () => {
      await service.getStats(TENANT, UserRole.HOSPITAL_ADMIN, true, 'admin-1');
      // Every PatientModel.countDocuments call (total + today) must exclude deleted.
      const calls = (PatientModel.countDocuments as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const [filter] of calls) {
        expect(filter).toMatchObject({ tenantId: TENANT, isDeleted: { $ne: true } });
      }
    });

    test('lab counts (pending + reports today) exclude soft-deleted requests', async () => {
      await service.getStats(TENANT, UserRole.HOSPITAL_ADMIN, true, 'admin-1');
      for (const model of [PathologyRequestModel, RadiologyRequestModel]) {
        const calls = (model.countDocuments as jest.Mock).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const [filter] of calls) {
          expect(filter).toMatchObject({ tenantId: TENANT, isDeleted: { $ne: true } });
        }
      }
    });
  });

  describe('role filtering — Receptionist sees limited fields', () => {
    test('returns patient and OPD stats for RECEPTIONIST', async () => {
      mockCount(PatientModel, 15);
      mockCount(OPDVisitModel, 3);

      const stats = await service.getStats(TENANT, UserRole.RECEPTIONIST, true);

      expect(stats.totalPatients).toBe(15);
      expect(stats.todayOpdCount).toBe(3);
      expect(stats.activeIpdCount).toBeUndefined();
      expect(stats.pendingLabCount).toBeUndefined();
      expect(stats.revenueToday).toBeUndefined();
      expect(stats.revenueThisMonth).toBeUndefined();
      expect(stats.lowStockCount).toBeUndefined();
      expect(stats.totalActiveStaff).toBeUndefined();
      expect(stats.monthlyOpdTrend).toBeUndefined();
      expect(stats.monthlyRevenueTrend).toBeUndefined();
    });
  });

  describe('role filtering — Doctor sees clinical fields only', () => {
    test('omits revenue and staff fields for DOCTOR', async () => {
      mockCount(PatientModel, 8);
      mockCount(OPDVisitModel, 2);
      mockCount(IPDAdmissionModel, 1);
      mockCount(PathologyRequestModel, 1);
      mockCount(RadiologyRequestModel, 0);
      mockAggregate(OPDVisitModel, []);

      const stats = await service.getStats(TENANT, UserRole.DOCTOR, true);

      expect(stats.totalPatients).toBe(8);
      expect(stats.todayOpdCount).toBe(2);
      expect(stats.activeIpdCount).toBe(1);
      expect(stats.pendingLabCount).toBe(1);
      expect(stats.monthlyOpdTrend).toBeDefined();
      expect(stats.revenueToday).toBeUndefined();
      expect(stats.revenueThisMonth).toBeUndefined();
      expect(stats.lowStockCount).toBeUndefined();
      expect(stats.totalActiveStaff).toBeUndefined();
      expect(stats.monthlyRevenueTrend).toBeUndefined();
    });
  });

  describe('role filtering — Nurse', () => {
    test('returns patients, OPD, and IPD counts for NURSE', async () => {
      mockCount(PatientModel, 12);
      mockCount(OPDVisitModel, 4);
      mockCount(IPDAdmissionModel, 6);

      const stats = await service.getStats(TENANT, UserRole.NURSE, true);

      expect(stats.totalPatients).toBe(12);
      expect(stats.todayOpdCount).toBe(4);
      expect(stats.activeIpdCount).toBe(6);
      expect(stats.pendingLabCount).toBeUndefined();
      expect(stats.revenueToday).toBeUndefined();
    });
  });

  describe('role filtering — Staff sees no fields', () => {
    test('returns only lastUpdated for STAFF role', async () => {
      const stats = await service.getStats(TENANT, UserRole.STAFF, true);

      expect(stats.lastUpdated).toBeTruthy();
      expect(stats.totalPatients).toBeUndefined();
      expect(stats.todayOpdCount).toBeUndefined();
    });
  });

  // ─── Aggregation correctness ───────────────────────────────────────────────

  describe('pendingLabCount combines pathology + radiology', () => {
    test('sums both pending counts', async () => {
      mockCount(PathologyRequestModel, 7);
      mockCount(RadiologyRequestModel, 3);
      (PaymentModel.aggregate as jest.Mock).mockResolvedValue([]);
      mockAggregate(InventoryItemModel, []);
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);
      expect(stats.pendingLabCount).toBe(10);
    });
  });

  describe('revenue summary uses aggregate results', () => {
    test('returns 0 when no payments exist', async () => {
      (PaymentModel.aggregate as jest.Mock).mockResolvedValue([]);
      mockAggregate(InventoryItemModel, []);
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);
      expect(stats.revenueToday).toBe(0);
      expect(stats.revenueThisMonth).toBe(0);
    });

    test('returns aggregated amount when payments exist', async () => {
      // aggregate called 4x: today, month, averageDaily, trend
      (PaymentModel.aggregate as jest.Mock)
        .mockResolvedValueOnce([{ total: 2500 }])
        .mockResolvedValueOnce([{ total: 18000 }])
        .mockResolvedValueOnce([{ total: 15000 }])
        .mockResolvedValueOnce([]);
      mockAggregate(InventoryItemModel, []);
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);
      expect(stats.revenueToday).toBe(2500);
      expect(stats.revenueThisMonth).toBe(18000);
    });
  });

  describe('monthlyOpdTrend — continuous 30-day series', () => {
    // Local-timezone day key, matching the service (which buckets in server TZ).
    const localKey = (offset: number) => {
      const t = new Date();
      const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    test('returns 30 points ending today, zero-filling days with no activity', async () => {
      (PaymentModel.aggregate as jest.Mock).mockResolvedValue([]);
      mockAggregate(InventoryItemModel, []);

      // Aggregation now emits _id as a YYYY-MM-DD string ($dateToString in server TZ).
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([
        { _id: localKey(3), count: 5 },   // 3 days ago
        { _id: localKey(0), count: 2 },   // today
      ]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);
      const trend = stats.monthlyOpdTrend!;

      expect(trend).toHaveLength(30);
      expect(trend[trend.length - 1]).toEqual({ date: localKey(0), count: 2 }); // today included
      expect(trend[trend.length - 4]).toEqual({ date: localKey(3), count: 5 }); // 3 days ago
      expect(trend[0]).toEqual({ date: localKey(29), count: 0 });               // empty day zero-filled
      expect(trend.reduce((s, p) => s + p.count, 0)).toBe(7);                   // only real data counts
    });

    test('returns an empty array when there is no activity (clean empty state)', async () => {
      (PaymentModel.aggregate as jest.Mock).mockResolvedValue([]);
      mockAggregate(InventoryItemModel, []);
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);
      expect(stats.monthlyOpdTrend).toEqual([]);
    });
  });

  // ─── Cache behaviour ───────────────────────────────────────────────────────

  describe('cache hit/miss', () => {
    test('second call with same tenant+role hits cache and skips DB', async () => {
      mockCount(PatientModel, 10);
      mockCount(OPDVisitModel, 2);

      await service.getStats(TENANT, UserRole.RECEPTIONIST, true); // populate cache
      const callsAfterFirst = (PatientModel.countDocuments as jest.Mock).mock.calls.length;

      await service.getStats(TENANT, UserRole.RECEPTIONIST);       // should hit cache
      const callsAfterSecond = (PatientModel.countDocuments as jest.Mock).mock.calls.length;

      expect(callsAfterSecond).toBe(callsAfterFirst); // no extra calls on cache hit
    });

    test('bypass=true skips cache', async () => {
      mockCount(PatientModel, 5);
      mockCount(OPDVisitModel, 1);

      await service.getStats(TENANT, UserRole.RECEPTIONIST);       // populate cache
      const callsAfterFirst = (PatientModel.countDocuments as jest.Mock).mock.calls.length;

      await service.getStats(TENANT, UserRole.RECEPTIONIST, true); // bypass
      const callsAfterSecond = (PatientModel.countDocuments as jest.Mock).mock.calls.length;

      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);   // new DB calls made
    });

    test('different roles get separate cache entries', async () => {
      mockCount(PatientModel, 5);
      mockCount(OPDVisitModel, 1);
      mockCount(IPDAdmissionModel, 0);

      await service.getStats(TENANT, UserRole.RECEPTIONIST, true);
      await service.getStats(TENANT, UserRole.NURSE, true);

      // Each role populates its own cache key — PatientModel called at least twice
      expect((PatientModel.countDocuments as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Recent Activities role-based scoping ────────────────────────────────────
  describe('recent activities — role-based scoping', () => {
    const auditQuery = () => auditRepository.query as jest.Mock;

    test('HOSPITAL_ADMIN queries all activity for the tenant (no userId filter)', async () => {
      await service.getStats(TENANT, UserRole.HOSPITAL_ADMIN, true, 'admin-1');
      const [tenantArg, filters] = auditQuery().mock.calls[0];
      expect(tenantArg).toBe(TENANT);
      expect(filters).not.toHaveProperty('userId');
    });

    test('a non-admin role is restricted to its own userId', async () => {
      await service.getStats(TENANT, UserRole.DOCTOR, true, 'doc-1');
      expect(auditQuery()).toHaveBeenCalledWith(TENANT, expect.objectContaining({ userId: 'doc-1' }));
    });

    test('fail closed: a non-admin role WITHOUT a userId never falls back to tenant-wide activity', async () => {
      await service.getStats(TENANT, UserRole.DOCTOR, true); // userId omitted
      const filters = auditQuery().mock.calls[0][1];
      // Must be scoped (has a userId sentinel), never the tenant-wide (no-userId) query.
      expect(filters).toHaveProperty('userId');
    });

    test('two users of the same role do not share cached activity', async () => {
      // Doctor A caches, then Doctor B (same role, different user) must query fresh
      // with its own userId — never served Doctor A's cached feed.
      await service.getStats(TENANT, UserRole.DOCTOR, false, 'doc-A');
      auditQuery().mockClear();

      await service.getStats(TENANT, UserRole.DOCTOR, false, 'doc-B');
      expect(auditQuery()).toHaveBeenCalledWith(TENANT, expect.objectContaining({ userId: 'doc-B' }));
      expect(auditQuery()).not.toHaveBeenCalledWith(TENANT, expect.objectContaining({ userId: 'doc-A' }));
    });

    test('same user hits cache on the second call (no new activity query)', async () => {
      await service.getStats(TENANT, UserRole.DOCTOR, false, 'doc-1');
      auditQuery().mockClear();

      await service.getStats(TENANT, UserRole.DOCTOR, false, 'doc-1'); // cached
      expect(auditQuery()).not.toHaveBeenCalled();
    });
  });
});
