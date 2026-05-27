import { PatientModel }          from '../patient/patient.model';
import { OPDVisitModel }         from '../opd/opd.model';
import { IPDAdmissionModel }     from '../ipd/ipd.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../lab/lab.model';
import { InventoryItemModel }    from '../inventory/inventory.model';
import { PaymentModel }          from '../payment/payment.model';
import { UserModel }             from '../user/user.model';
import { AppError }              from '../../shared/middleware/error-handler';
import config                    from '../../shared/config/env';
import {
  DashboardStats,
  ROLE_FIELD_ACCESS,
  TrendPoint,
  RevenueTrendPoint,
} from './dashboard.types';
import { UserRole }              from '../../shared/types/common.types';
import { PaymentStatus }         from '../payment/payment.types';

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

// Exported for testing
export function clearDashboardCache(): void {
  statsCache.clear();
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

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

async function getTotalPatients(tenantId: string): Promise<number> {
  const result = await PatientModel.countDocuments({ tenantId });
  return result ?? 0;
}

async function getTodayOpdCount(tenantId: string): Promise<number> {
  const { start, end } = todayRange();
  return OPDVisitModel.countDocuments({
    tenantId,
    visitDate: { $gte: start, $lte: end },
  });
}

async function getActiveIpdCount(tenantId: string): Promise<number> {
  return IPDAdmissionModel.countDocuments({ tenantId, status: 'ADMITTED' });
}

async function getPendingLabCount(tenantId: string): Promise<number> {
  const [path, rad] = await Promise.all([
    PathologyRequestModel.countDocuments({ tenantId, status: 'PENDING' }),
    RadiologyRequestModel.countDocuments({ tenantId, status: 'PENDING' }),
  ]);
  return (path ?? 0) + (rad ?? 0);
}

async function getRevenueSummary(
  tenantId: string,
): Promise<{ today: number; month: number }> {
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

async function getLowStockCount(tenantId: string): Promise<number> {
  const result = await InventoryItemModel.aggregate([
    { $match: { tenantId, $expr: { $and: [{ $gt: ['$lowStockThreshold', 0] }, { $lt: ['$quantity', '$lowStockThreshold'] }] } } },
    { $count: 'total' },
  ]);
  return result[0]?.total ?? 0;
}

async function getTotalActiveStaff(tenantId: string): Promise<number> {
  return UserModel.countDocuments({ tenantId, isActive: true });
}

async function getMonthlyOpdTrend(tenantId: string): Promise<TrendPoint[]> {
  const since = last30DaysStart();
  const results = await OPDVisitModel.aggregate([
    { $match: { tenantId, visitDate: { $gte: since } } },
    {
      $group: {
        _id: {
          year:  { $year: '$visitDate' },
          month: { $month: '$visitDate' },
          day:   { $dayOfMonth: '$visitDate' },
        },
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
        _id: {
          year:  { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day:   { $dayOfMonth: '$createdAt' },
        },
        amount: { $sum: '$amount' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
  ]);

  return results.map((r) => ({
    date:   `${r._id.year}-${String(r._id.month).padStart(2, '0')}-${String(r._id.day).padStart(2, '00')}`,
    amount: r.amount,
  }));
}

// ─── DashboardService ─────────────────────────────────────────────────────────

export class DashboardService {
  /**
   * Returns role-scoped dashboard stats.
   * Uses in-memory TTL cache unless bypassCache is true.
   * Wraps aggregation in a 10s timeout (FR-E01.5.3).
   */
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

    const needs = (field: string): boolean =>
      (permittedFields as string[]).includes(field);

    const TIMEOUT_MS = 10_000;

    const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(new AppError('Dashboard aggregation timed out', 504)),
            TIMEOUT_MS,
          ),
        ),
      ]);

    // Fire only the aggregations required by this role (parallel)
    const [
      totalPatients,
      todayOpdCount,
      activeIpdCount,
      pendingLabCount,
      revenueSummary,
      lowStockCount,
      totalActiveStaff,
      monthlyOpdTrend,
      monthlyRevenueTrend,
    ] = await withTimeout(
      Promise.all([
        needs('totalPatients')   ? getTotalPatients(tenantId)        : Promise.resolve(undefined),
        needs('todayOpdCount')   ? getTodayOpdCount(tenantId)        : Promise.resolve(undefined),
        needs('activeIpdCount')  ? getActiveIpdCount(tenantId)       : Promise.resolve(undefined),
        needs('pendingLabCount') ? getPendingLabCount(tenantId)      : Promise.resolve(undefined),
        (needs('revenueToday') || needs('revenueThisMonth'))
          ? getRevenueSummary(tenantId)
          : Promise.resolve(undefined),
        needs('lowStockCount')       ? getLowStockCount(tenantId)       : Promise.resolve(undefined),
        needs('totalActiveStaff')    ? getTotalActiveStaff(tenantId)    : Promise.resolve(undefined),
        needs('monthlyOpdTrend')     ? getMonthlyOpdTrend(tenantId)     : Promise.resolve(undefined),
        needs('monthlyRevenueTrend') ? getMonthlyRevenueTrend(tenantId) : Promise.resolve(undefined),
      ]),
    );

    const stats: DashboardStats = { lastUpdated: new Date().toISOString() };

    if (needs('totalPatients')       && totalPatients       !== undefined) stats.totalPatients       = totalPatients as number;
    if (needs('todayOpdCount')       && todayOpdCount       !== undefined) stats.todayOpdCount       = todayOpdCount as number;
    if (needs('activeIpdCount')      && activeIpdCount      !== undefined) stats.activeIpdCount      = activeIpdCount as number;
    if (needs('pendingLabCount')     && pendingLabCount      !== undefined) stats.pendingLabCount     = pendingLabCount as number;
    if (needs('revenueToday')        && revenueSummary       !== undefined) stats.revenueToday        = (revenueSummary as { today: number; month: number }).today;
    if (needs('revenueThisMonth')    && revenueSummary       !== undefined) stats.revenueThisMonth    = (revenueSummary as { today: number; month: number }).month;
    if (needs('lowStockCount')       && lowStockCount        !== undefined) stats.lowStockCount       = lowStockCount as number;
    if (needs('totalActiveStaff')    && totalActiveStaff     !== undefined) stats.totalActiveStaff    = totalActiveStaff as number;
    if (needs('monthlyOpdTrend')     && monthlyOpdTrend      !== undefined) stats.monthlyOpdTrend     = monthlyOpdTrend as TrendPoint[];
    if (needs('monthlyRevenueTrend') && monthlyRevenueTrend  !== undefined) stats.monthlyRevenueTrend = monthlyRevenueTrend as RevenueTrendPoint[];

    setInCache(tenantId, role, stats);
    return stats;
  }
}

export const dashboardService = new DashboardService();
