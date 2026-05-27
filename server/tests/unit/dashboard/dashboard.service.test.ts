// Mock all Mongoose models before importing the service
jest.mock('../../../src/modules/patient/patient.model');
jest.mock('../../../src/modules/opd/opd.model');
jest.mock('../../../src/modules/ipd/ipd.model');
jest.mock('../../../src/modules/lab/lab.model');
jest.mock('../../../src/modules/inventory/inventory.model');
jest.mock('../../../src/modules/payment/payment.model');
jest.mock('../../../src/modules/user/user.model');

import { PatientModel }          from '../../../src/modules/patient/patient.model';
import { OPDVisitModel }         from '../../../src/modules/opd/opd.model';
import { IPDAdmissionModel }     from '../../../src/modules/ipd/ipd.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../../../src/modules/lab/lab.model';
import { InventoryItemModel }    from '../../../src/modules/inventory/inventory.model';
import { PaymentModel }          from '../../../src/modules/payment/payment.model';
import { UserModel }             from '../../../src/modules/user/user.model';
import { DashboardService, clearDashboardCache } from '../../../src/modules/dashboard/dashboard.service';
import { UserRole }              from '../../../src/shared/types/common.types';

const TENANT = 'tenant-001';

// ─── helpers to set up countDocuments / aggregate mocks ───────────────────────

function mockCount(model: unknown, value: number) {
  (model as jest.MockedClass<typeof PatientModel>).countDocuments = jest.fn().mockResolvedValue(value);
}

function mockAggregate(model: unknown, values: Record<string, unknown>[]) {
  (model as jest.MockedClass<typeof PaymentModel>).aggregate = jest.fn().mockResolvedValue(values);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardService.getStats', () => {
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    clearDashboardCache();
    service = new DashboardService();

    // Default: all counts return 0 / empty arrays
    mockCount(PatientModel, 0);
    mockCount(OPDVisitModel, 0);
    mockCount(IPDAdmissionModel, 0);
    mockCount(PathologyRequestModel, 0);
    mockCount(RadiologyRequestModel, 0);
    mockCount(UserModel, 0);
    mockAggregate(PaymentModel, []);
    mockAggregate(OPDVisitModel, []);
    mockAggregate(InventoryItemModel, []);
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
      // PaymentModel.aggregate is called 3 times for ADMIN:
      //   1) getRevenueSummary → today, 2) getRevenueSummary → month, 3) getMonthlyRevenueTrend
      (PaymentModel.aggregate as jest.Mock)
        .mockResolvedValueOnce([{ total: 5000 }])
        .mockResolvedValueOnce([{ total: 40000 }])
        .mockResolvedValueOnce([]);
      mockAggregate(InventoryItemModel, [{ total: 4 }]);
      // OPDVisitModel.aggregate is called once for getMonthlyOpdTrend
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

  describe('role filtering — Receptionist sees limited fields', () => {
    test('returns only totalPatients and todayOpdCount for RECEPTIONIST', async () => {
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
    test('returns patients, OPD, and IPD counts only for NURSE', async () => {
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
      mockCount(PatientModel, 0);
      mockCount(OPDVisitModel, 0);
      mockCount(IPDAdmissionModel, 0);
      mockCount(PathologyRequestModel, 7);
      mockCount(RadiologyRequestModel, 3);
      mockCount(UserModel, 0);
      // 3 PaymentModel.aggregate calls for ADMIN (today, month, trend)
      (PaymentModel.aggregate as jest.Mock).mockResolvedValue([]);
      mockAggregate(InventoryItemModel, []);
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);
      expect(stats.pendingLabCount).toBe(10);
    });
  });

  describe('revenue summary uses aggregate results', () => {
    test('returns 0 when no payments exist', async () => {
      mockCount(PatientModel, 0);
      mockCount(OPDVisitModel, 0);
      mockCount(IPDAdmissionModel, 0);
      mockCount(PathologyRequestModel, 0);
      mockCount(RadiologyRequestModel, 0);
      mockCount(UserModel, 0);
      (PaymentModel.aggregate as jest.Mock).mockResolvedValue([]);
      mockAggregate(InventoryItemModel, []);
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);
      expect(stats.revenueToday).toBe(0);
      expect(stats.revenueThisMonth).toBe(0);
    });

    test('returns aggregated amount when payments exist', async () => {
      mockCount(PatientModel, 0);
      mockCount(OPDVisitModel, 0);
      mockCount(IPDAdmissionModel, 0);
      mockCount(PathologyRequestModel, 0);
      mockCount(RadiologyRequestModel, 0);
      mockCount(UserModel, 0);
      // aggregate is called 3x for ADMIN: today revenue, month revenue, revenue trend
      (PaymentModel.aggregate as jest.Mock)
        .mockResolvedValueOnce([{ total: 2500 }])
        .mockResolvedValueOnce([{ total: 18000 }])
        .mockResolvedValueOnce([]);
      mockAggregate(InventoryItemModel, []);
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);
      expect(stats.revenueToday).toBe(2500);
      expect(stats.revenueThisMonth).toBe(18000);
    });
  });

  describe('monthlyOpdTrend formats date correctly', () => {
    test('formats aggregate result into TrendPoint array', async () => {
      mockCount(PatientModel, 0);
      mockCount(OPDVisitModel, 0);
      mockCount(IPDAdmissionModel, 0);
      mockCount(PathologyRequestModel, 0);
      mockCount(RadiologyRequestModel, 0);
      mockCount(UserModel, 0);
      // 3 PaymentModel.aggregate calls for ADMIN (today, month, trend)
      (PaymentModel.aggregate as jest.Mock).mockResolvedValue([]);
      mockAggregate(InventoryItemModel, []);
      // OPDVisitModel.aggregate is called for the trend
      (OPDVisitModel.aggregate as jest.Mock).mockResolvedValue([
        { _id: { year: 2026, month: 5, day: 1 }, count: 3 },
        { _id: { year: 2026, month: 5, day: 2 }, count: 7 },
      ]);

      const stats = await service.getStats(TENANT, UserRole.ADMIN, true);
      expect(stats.monthlyOpdTrend).toEqual([
        { date: '2026-05-01', count: 3 },
        { date: '2026-05-02', count: 7 },
      ]);
    });
  });

  // ─── Cache behaviour ───────────────────────────────────────────────────────

  describe('cache hit/miss', () => {
    test('second call with same tenant+role hits cache and skips DB', async () => {
      mockCount(PatientModel, 10);
      mockCount(OPDVisitModel, 2);

      await service.getStats(TENANT, UserRole.RECEPTIONIST, true); // populate cache
      await service.getStats(TENANT, UserRole.RECEPTIONIST);       // should hit cache

      // countDocuments should only have been called on the first (bypass) pass
      expect(PatientModel.countDocuments).toHaveBeenCalledTimes(1);
    });

    test('bypass=true skips cache', async () => {
      mockCount(PatientModel, 5);
      mockCount(OPDVisitModel, 1);

      await service.getStats(TENANT, UserRole.RECEPTIONIST);       // populate cache
      await service.getStats(TENANT, UserRole.RECEPTIONIST, true); // bypass

      // countDocuments called twice: once warm, once forced
      expect(PatientModel.countDocuments).toHaveBeenCalledTimes(2);
    });

    test('different roles get separate cache entries', async () => {
      mockCount(PatientModel, 5);
      mockCount(OPDVisitModel, 1);
      mockCount(IPDAdmissionModel, 0);

      await service.getStats(TENANT, UserRole.RECEPTIONIST, true);
      await service.getStats(TENANT, UserRole.NURSE, true);

      // Each role populates its own cache key — PatientModel called twice
      expect(PatientModel.countDocuments).toHaveBeenCalledTimes(2);
    });
  });
});
