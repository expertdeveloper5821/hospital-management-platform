import { PatientModel }          from '../patient/patient.model';
import { OPDVisitModel }         from '../opd/opd.model';
import { IPDAdmissionModel }     from '../ipd/ipd.model';
import { BedModel }              from '../ipd/bed.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../lab/lab.model';
import { InventoryItemModel }    from '../inventory/inventory.model';
import { PaymentModel }          from '../payment/payment.model';
import { UserModel }             from '../user/user.model';
import { AuditLogModel }         from '../audit/audit.model';
import { AppError }              from '../../shared/middleware/error-handler';
import config                    from '../../shared/config/env';
import {
  DashboardStats,
  RecentActivity,
  ROLE_FIELD_ACCESS,
  TrendPoint,
  RevenueTrendPoint,
} from './dashboard.types';
import { UserRole }              from '../../shared/types/common.types';
import { PaymentStatus }         from '../payment/payment.types';
import { LabRequestStatus }      from '../lab/lab.types';

// ─── In-memory TTL cache (keyed by tenantId+role) ────────────────────────────

interface CacheEntry {
  stats:     DashboardStats;
  expiresAt: number;
}

const statsCache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string, role: UserRole): string {
  return `${tenantId}:${role}`;
}

function getFromCache(tenantId: string, role: UserRole): DashboardStats | null {
  const entry = statsCache.get(cacheKey(tenantId, role));
  if (!entry || Date.now() > entry.expiresAt) {
    statsCache.delete(cacheKey(tenantId, role));
    return null;
  }
  return entry.stats;
}

function setInCache(tenantId: string, role: UserRole, stats: DashboardStats): void {
  statsCache.set(cacheKey(tenantId, role), {
    stats,
    expiresAt: Date.now() + config.dashboard.cacheTtlSeconds * 1000,
  });
}

export function clearDashboardCache(): void {
  statsCache.clear();
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayRange(): { start: Date; end: Date } {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

function monthRange(): { start: Date; end: Date } {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function last30DaysStart(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Aggregation functions ────────────────────────────────────────────────────

async function getTotalPatients(tenantId: string): Promise<number> {
  return (await PatientModel.countDocuments({ tenantId })) ?? 0;
}

async function getTodayOpdCount(tenantId: string): Promise<number> {
  const { start, end } = todayRange();
  return OPDVisitModel.countDocuments({ tenantId, visitDate: { $gte: start, $lte: end } });
}

async function getActiveIpdCount(tenantId: string): Promise<number> {
  return IPDAdmissionModel.countDocuments({ tenantId, status: 'ADMITTED' });
}

async function getAdmissionsToday(tenantId: string): Promise<number> {
  const { start, end } = todayRange();
  return IPDAdmissionModel.countDocuments({ tenantId, admissionDate: { $gte: start, $lte: end } });
}

async function getNewRegistrationsToday(tenantId: string): Promise<number> {
  const { start, end } = todayRange();
  return PatientModel.countDocuments({ tenantId, createdAt: { $gte: start, $lte: end } });
}

async function getPendingLabCount(tenantId: string): Promise<number> {
  const [path, rad] = await Promise.all([
    PathologyRequestModel.countDocuments({ tenantId, status: LabRequestStatus.PENDING }),
    RadiologyRequestModel.countDocuments({ tenantId, status: LabRequestStatus.PENDING }),
  ]);
  return (path ?? 0) + (rad ?? 0);
}

async function getLabReportsToday(tenantId: string): Promise<number> {
  const { start, end } = todayRange();
  const [path, rad] = await Promise.all([
    PathologyRequestModel.countDocuments({ tenantId, status: LabRequestStatus.COMPLETED, updatedAt: { $gte: start, $lte: end } }),
    RadiologyRequestModel.countDocuments({ tenantId, status: LabRequestStatus.COMPLETED, updatedAt: { $gte: start, $lte: end } }),
  ]);
  return (path ?? 0) + (rad ?? 0);
}

async function getRevenueSummary(tenantId: string): Promise<{ today: number; month: number }> {
  const { start: todayStart, end: todayEnd } = todayRange();
  const { start: monthStart, end: monthEnd } = monthRange();

  const [todayResult, monthResult] = await Promise.all([
    PaymentModel.aggregate([
      { $match: { tenantId, status: PaymentStatus.COMPLETED, createdAt: { $gte: todayStart, $lte: todayEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    PaymentModel.aggregate([
      { $match: { tenantId, status: PaymentStatus.COMPLETED, createdAt: { $gte: monthStart, $lte: monthEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  return {
    today: todayResult[0]?.total ?? 0,
    month: monthResult[0]?.total ?? 0,
  };
}

async function getAverageDailyRevenue(tenantId: string): Promise<number> {
  const since = last30DaysStart();
  const result = await PaymentModel.aggregate([
    { $match: { tenantId, status: PaymentStatus.COMPLETED, createdAt: { $gte: since } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return Math.round((result[0]?.total ?? 0) / 30);
}

async function getPendingPaymentsCount(tenantId: string): Promise<number> {
  return PaymentModel.countDocuments({ tenantId, status: PaymentStatus.PENDING });
}

async function getLowStockCount(tenantId: string): Promise<number> {
  const result = await InventoryItemModel.aggregate([
    {
      $match: {
        tenantId,
        isDeleted: { $ne: true },
        $expr: { $and: [{ $gt: ['$lowStockThreshold', 0] }, { $lt: ['$quantity', '$lowStockThreshold'] }] },
      },
    },
    { $count: 'total' },
  ]);
  return result[0]?.total ?? 0;
}

async function getOutOfStockCount(tenantId: string): Promise<number> {
  return InventoryItemModel.countDocuments({ tenantId, isDeleted: { $ne: true }, quantity: 0 });
}

async function getTotalInventoryItems(tenantId: string): Promise<number> {
  return InventoryItemModel.countDocuments({ tenantId, isDeleted: { $ne: true } });
}

async function getTotalActiveStaff(tenantId: string): Promise<number> {
  return UserModel.countDocuments({ tenantId, isActive: true });
}

async function getBedStats(tenantId: string): Promise<{ total: number; occupied: number }> {
  const [total, occupied] = await Promise.all([
    BedModel.countDocuments({ tenantId }),
    BedModel.countDocuments({ tenantId, isOccupied: true }),
  ]);
  return { total, occupied };
}

async function getMonthlyOpdTrend(tenantId: string): Promise<TrendPoint[]> {
  const since = last30DaysStart();
  const results = await OPDVisitModel.aggregate([
    { $match: { tenantId, visitDate: { $gte: since } } },
    {
      $group: {
        _id: { year: { $year: '$visitDate' }, month: { $month: '$visitDate' }, day: { $dayOfMonth: '$visitDate' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
  ]);
  return results.map((r) => ({
    date:  `${r._id.year}-${String(r._id.month).padStart(2, '0')}-${String(r._id.day).padStart(2, '0')}`,
    count: r.count,
  }));
}

async function getMonthlyRevenueTrend(tenantId: string): Promise<RevenueTrendPoint[]> {
  const since = last30DaysStart();
  const results = await PaymentModel.aggregate([
    { $match: { tenantId, status: PaymentStatus.COMPLETED, createdAt: { $gte: since } } },
    {
      $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } },
        amount: { $sum: '$amount' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
  ]);
  return results.map((r) => ({
    date:   `${r._id.year}-${String(r._id.month).padStart(2, '0')}-${String(r._id.day).padStart(2, '0')}`,
    amount: r.amount,
  }));
}

async function getRecentActivities(tenantId: string): Promise<RecentActivity[]> {
  const logs = await AuditLogModel.find({ tenantId })
    .sort({ timestamp: -1 })
    .limit(10)
    .lean();
  return logs.map((l) => ({
    entityType: l.entityType,
    entityId:   l.entityId,
    action:     l.action,
    timestamp:  l.timestamp.toISOString(),
  }));
}

// ─── DashboardService ─────────────────────────────────────────────────────────

export class DashboardService {
  async getStats(
    tenantId:    string,
    role:        UserRole,
    bypassCache: boolean = false,
  ): Promise<DashboardStats> {
    if (!bypassCache) {
      const cached = getFromCache(tenantId, role);
      if (cached) return cached;
    }

    const permittedFields = ROLE_FIELD_ACCESS[role] ?? [];
    const needs = (field: string): boolean => (permittedFields as string[]).includes(field);

    const TIMEOUT_MS = 10_000;
    const withTimeout = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new AppError('Dashboard aggregation timed out', 504)), TIMEOUT_MS),
        ),
      ]);

    const [
      totalPatients,
      todayOpdCount,
      activeIpdCount,
      admissionsToday,
      newRegistrationsToday,
      pendingLabCount,
      labReportsToday,
      revenueSummary,
      averageDailyRevenue,
      pendingPaymentsCount,
      lowStockCount,
      outOfStockCount,
      totalInventoryItems,
      totalActiveStaff,
      bedStats,
      monthlyOpdTrend,
      monthlyRevenueTrend,
      recentActivities,
    ] = await withTimeout(Promise.all([
      needs('totalPatients')         ? getTotalPatients(tenantId)         : Promise.resolve(undefined),
      needs('todayOpdCount')         ? getTodayOpdCount(tenantId)         : Promise.resolve(undefined),
      needs('activeIpdCount')        ? getActiveIpdCount(tenantId)        : Promise.resolve(undefined),
      needs('admissionsToday')       ? getAdmissionsToday(tenantId)       : Promise.resolve(undefined),
      needs('newRegistrationsToday') ? getNewRegistrationsToday(tenantId) : Promise.resolve(undefined),
      needs('pendingLabCount')       ? getPendingLabCount(tenantId)       : Promise.resolve(undefined),
      needs('labReportsToday')       ? getLabReportsToday(tenantId)       : Promise.resolve(undefined),
      (needs('revenueToday') || needs('revenueThisMonth'))
        ? getRevenueSummary(tenantId) : Promise.resolve(undefined),
      needs('averageDailyRevenue')   ? getAverageDailyRevenue(tenantId)   : Promise.resolve(undefined),
      needs('pendingPaymentsCount')  ? getPendingPaymentsCount(tenantId)  : Promise.resolve(undefined),
      needs('lowStockCount')         ? getLowStockCount(tenantId)         : Promise.resolve(undefined),
      needs('outOfStockCount')       ? getOutOfStockCount(tenantId)       : Promise.resolve(undefined),
      needs('totalInventoryItems')   ? getTotalInventoryItems(tenantId)   : Promise.resolve(undefined),
      needs('totalActiveStaff')      ? getTotalActiveStaff(tenantId)      : Promise.resolve(undefined),
      (needs('totalBeds') || needs('occupiedBeds'))
        ? getBedStats(tenantId) : Promise.resolve(undefined),
      needs('monthlyOpdTrend')       ? getMonthlyOpdTrend(tenantId)       : Promise.resolve(undefined),
      needs('monthlyRevenueTrend')   ? getMonthlyRevenueTrend(tenantId)   : Promise.resolve(undefined),
      needs('recentActivities')      ? getRecentActivities(tenantId)      : Promise.resolve(undefined),
    ]));

    const stats: DashboardStats = { lastUpdated: new Date().toISOString() };

    if (needs('totalPatients')         && totalPatients         !== undefined) stats.totalPatients         = totalPatients as number;
    if (needs('todayOpdCount')         && todayOpdCount         !== undefined) stats.todayOpdCount         = todayOpdCount as number;
    if (needs('activeIpdCount')        && activeIpdCount        !== undefined) stats.activeIpdCount        = activeIpdCount as number;
    if (needs('admissionsToday')       && admissionsToday       !== undefined) stats.admissionsToday       = admissionsToday as number;
    if (needs('newRegistrationsToday') && newRegistrationsToday !== undefined) stats.newRegistrationsToday = newRegistrationsToday as number;
    if (needs('pendingLabCount')       && pendingLabCount       !== undefined) stats.pendingLabCount       = pendingLabCount as number;
    if (needs('labReportsToday')       && labReportsToday       !== undefined) stats.labReportsToday       = labReportsToday as number;
    if (needs('revenueToday')          && revenueSummary        !== undefined) stats.revenueToday          = (revenueSummary as { today: number; month: number }).today;
    if (needs('revenueThisMonth')      && revenueSummary        !== undefined) stats.revenueThisMonth      = (revenueSummary as { today: number; month: number }).month;
    if (needs('averageDailyRevenue')   && averageDailyRevenue   !== undefined) stats.averageDailyRevenue   = averageDailyRevenue as number;
    if (needs('pendingPaymentsCount')  && pendingPaymentsCount  !== undefined) stats.pendingPaymentsCount  = pendingPaymentsCount as number;
    if (needs('lowStockCount')         && lowStockCount         !== undefined) stats.lowStockCount         = lowStockCount as number;
    if (needs('outOfStockCount')       && outOfStockCount       !== undefined) stats.outOfStockCount       = outOfStockCount as number;
    if (needs('totalInventoryItems')   && totalInventoryItems   !== undefined) stats.totalInventoryItems   = totalInventoryItems as number;
    if (needs('totalActiveStaff')      && totalActiveStaff      !== undefined) stats.totalActiveStaff      = totalActiveStaff as number;
    if (needs('totalBeds')             && bedStats              !== undefined) stats.totalBeds             = (bedStats as { total: number; occupied: number }).total;
    if (needs('occupiedBeds')          && bedStats              !== undefined) stats.occupiedBeds          = (bedStats as { total: number; occupied: number }).occupied;
    if (needs('monthlyOpdTrend')       && monthlyOpdTrend       !== undefined) stats.monthlyOpdTrend       = monthlyOpdTrend as TrendPoint[];
    if (needs('monthlyRevenueTrend')   && monthlyRevenueTrend   !== undefined) stats.monthlyRevenueTrend   = monthlyRevenueTrend as RevenueTrendPoint[];
    if (needs('recentActivities')      && recentActivities      !== undefined) stats.recentActivities      = recentActivities as RecentActivity[];

    setInCache(tenantId, role, stats);
    return stats;
  }
}

export const dashboardService = new DashboardService();
