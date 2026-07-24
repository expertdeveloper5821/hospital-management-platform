import { dashboardRepository }   from './dashboard.repository';
import { auditRepository }       from '../audit/audit.repository';
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

// ─── In-memory TTL cache (keyed by tenantId+role) ────────────────────────────

interface CacheEntry {
  stats:     DashboardStats;
  expiresAt: number;
}

const statsCache = new Map<string, CacheEntry>();

// Sentinel used when a self-scoped role is queried without a userId. It cannot
// match any real audit-log userId, so the activity feed comes back empty
// (fail closed) instead of falling back to tenant-wide activity.
const NO_ACTIVITY_SENTINEL = '__no_user__';

// Same fail-closed idea for Doctor-scoped stats: if a DOCTOR request somehow
// arrives without a userId, this sentinel matches no OPD/IPD/lab records, so
// the doctor's counts come back as 0 rather than leaking hospital-wide totals.
const NO_DOCTOR_SENTINEL = '__no_doctor__';

// `activityScope` isolates the cache per recent-activity view: 'ALL' for roles
// that see every user's activity (Hospital Admin), or the acting userId for
// self-scoped roles — so two users of the same role never share cached activity.
function cacheKey(tenantId: string, role: UserRole, activityScope: string): string {
  return `${tenantId}:${role}:${activityScope}`;
}

function getFromCache(tenantId: string, role: UserRole, activityScope: string): DashboardStats | null {
  const entry = statsCache.get(cacheKey(tenantId, role, activityScope));
  if (!entry || Date.now() > entry.expiresAt) {
    statsCache.delete(cacheKey(tenantId, role, activityScope));
    return null;
  }
  return entry.stats;
}

// Remove every expired entry. Because keys now include the acting userId, one-off
// user scopes would otherwise linger in the Map until their exact key is read
// again (which may never happen). Sweeping on write keeps resident entries bounded
// to those still within their TTL, with no timer and no unbounded growth.
function pruneExpiredEntries(now: number): void {
  for (const [key, entry] of statsCache) {
    if (now > entry.expiresAt) statsCache.delete(key);
  }
}

function setInCache(tenantId: string, role: UserRole, activityScope: string, stats: DashboardStats): void {
  const now = Date.now();
  pruneExpiredEntries(now);
  statsCache.set(cacheKey(tenantId, role, activityScope), {
    stats,
    expiresAt: now + config.dashboard.cacheTtlSeconds * 1000,
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

// `doctorId` present ⇒ scope to that doctor's own patients/visits/admissions/
// requests (Doctor dashboard); absent ⇒ tenant-wide (every other role).

async function getTotalPatients(tenantId: string, doctorId?: string): Promise<number> {
  if (doctorId !== undefined) {
    const patientIds = await dashboardRepository.findPatientIdsForDoctor(tenantId, doctorId);
    return patientIds.length;
  }
  return dashboardRepository.countPatients(tenantId);
}

async function getTodayOpdCount(tenantId: string, doctorId?: string): Promise<number> {
  const { start, end } = todayRange();
  return doctorId !== undefined
    ? dashboardRepository.countOpdVisitsForDoctorBetween(tenantId, doctorId, start, end)
    : dashboardRepository.countOpdVisitsBetween(tenantId, start, end);
}

async function getActiveIpdCount(tenantId: string, doctorId?: string): Promise<number> {
  return doctorId !== undefined
    ? dashboardRepository.countActiveIpdForDoctor(tenantId, doctorId)
    : dashboardRepository.countActiveIpd(tenantId);
}

async function getNewRegistrationsToday(tenantId: string): Promise<number> {
  const { start, end } = todayRange();
  return dashboardRepository.countPatientsCreatedBetween(tenantId, start, end);
}

async function getPendingLabCount(tenantId: string, doctorId?: string): Promise<number> {
  if (doctorId !== undefined) {
    const patientIds = await dashboardRepository.findPatientIdsForDoctor(tenantId, doctorId);
    const { pathology, radiology } = await dashboardRepository.countPendingLabRequestsForDoctor(tenantId, doctorId, patientIds);
    return pathology + radiology;
  }
  const { pathology, radiology } = await dashboardRepository.countPendingLabRequests(tenantId);
  return pathology + radiology;
}

async function getLabReportsToday(tenantId: string, doctorId?: string): Promise<number> {
  const { start, end } = todayRange();
  if (doctorId !== undefined) {
    const patientIds = await dashboardRepository.findPatientIdsForDoctor(tenantId, doctorId);
    const { pathology, radiology } = await dashboardRepository.countCompletedLabRequestsForDoctorBetween(tenantId, doctorId, patientIds, start, end);
    return pathology + radiology;
  }
  const { pathology, radiology } = await dashboardRepository.countCompletedLabRequestsBetween(tenantId, start, end);
  return pathology + radiology;
}

async function getRevenueSummary(tenantId: string): Promise<{ today: number; month: number }> {
  const { start: todayStart, end: todayEnd } = todayRange();
  const { start: monthStart, end: monthEnd } = monthRange();

  const [today, month] = await Promise.all([
    dashboardRepository.sumCompletedPaymentsBetween(tenantId, todayStart, todayEnd),
    dashboardRepository.sumCompletedPaymentsBetween(tenantId, monthStart, monthEnd),
  ]);

  return { today, month };
}

async function getAverageDailyRevenue(tenantId: string): Promise<number> {
  const since = last30DaysStart();
  const total = await dashboardRepository.sumCompletedPaymentsSince(tenantId, since);
  return Math.round(total / 30);
}

async function getPendingPaymentsCount(tenantId: string): Promise<number> {
  return dashboardRepository.countPendingPayments(tenantId);
}

async function getLowStockCount(tenantId: string): Promise<number> {
  return dashboardRepository.countLowStock(tenantId);
}

async function getOutOfStockCount(tenantId: string): Promise<number> {
  return dashboardRepository.countOutOfStock(tenantId);
}

async function getTotalInventoryItems(tenantId: string): Promise<number> {
  return dashboardRepository.countInventoryItems(tenantId);
}

async function getTotalActiveStaff(tenantId: string): Promise<number> {
  return dashboardRepository.countActiveStaff(tenantId);
}

async function getBedStats(tenantId: string): Promise<{ total: number; occupied: number }> {
  return dashboardRepository.bedStats(tenantId);
}

// The server's timezone. Visit/payment dates are stored at local-midnight
// (see opd.service), and "today"/"last-30-days" ranges are computed in local time,
// so the trend charts must bucket days in the SAME timezone — otherwise a visit
// added "today" in, e.g., IST lands on the previous UTC day and shows as 0.
const SERVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Local-timezone YYYY-MM-DD key (matches Mongo's $dateToString with SERVER_TZ).
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Turn a sparse day→value map into a continuous 30-day series ending today (in the
// server timezone), filling days with no activity as 0 — so "Last 30 Days" charts
// always span the full window and include today. Returns [] when there is no data
// at all, so the UI can still show a clean "No data yet" state for new hospitals.
function buildDailySeries(byDate: Map<string, number>): { date: string; value: number }[] {
  if (byDate.size === 0) return [];
  const today = new Date();
  const out: { date: string; value: number }[] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = localDayKey(d);
    out.push({ date: key, value: byDate.get(key) ?? 0 });
  }
  return out;
}

async function getMonthlyOpdTrend(tenantId: string): Promise<TrendPoint[]> {
  const since = last30DaysStart();
  // Cap at "now" so a Last-30-Days trend never includes future-scheduled visits.
  const results = await dashboardRepository.opdVisitsGroupedByDay(tenantId, since, new Date(), SERVER_TZ);
  const byDate = new Map<string, number>(results.map((r) => [r._id, r.count]));
  return buildDailySeries(byDate).map((e) => ({ date: e.date, count: e.value }));
}

async function getMonthlyRevenueTrend(tenantId: string): Promise<RevenueTrendPoint[]> {
  const since = last30DaysStart();
  const results = await dashboardRepository.paymentsGroupedByDay(tenantId, since, SERVER_TZ);
  const byDate = new Map<string, number>(results.map((r) => [r._id, r.amount]));
  return buildDailySeries(byDate).map((e) => ({ date: e.date, amount: e.value }));
}

// When `userId` is provided the feed is restricted to that user's own actions;
// otherwise it returns the whole tenant's activity (Hospital Admin view).
// Data access goes through the audit repository (no direct model queries here).
async function getRecentActivities(tenantId: string, userId?: string): Promise<RecentActivity[]> {
  const { data } = await auditRepository.query(tenantId, {
    ...(userId ? { userId } : {}),
    page:  1,
    limit: 10,
  });
  return data.map((l) => ({
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
    userId?:     string,
  ): Promise<DashboardStats> {
    // Recent Activities scope: Hospital Admin sees the whole hospital; every other
    // role sees only their own actions. Enforced here on the backend.
    // Fail closed: a self-scoped role with no userId resolves to a sentinel that
    // matches no audit log, so omitting userId can never leak other users' activity
    // (nor share a cross-user cache entry) — it simply returns an empty feed.
    const activityUserId = role === UserRole.HOSPITAL_ADMIN
      ? undefined                       // Hospital Admin: whole-tenant activity
      : (userId ?? NO_ACTIVITY_SENTINEL);
    const activityScope  = activityUserId ?? 'ALL';

    // Doctor dashboard: every patient/OPD/IPD/lab figure below is scoped to this
    // doctor's own userId, never tenant-wide (see dashboard.repository doctor-scoped
    // methods). Same fail-closed sentinel pattern as activityUserId above.
    const doctorId = role === UserRole.DOCTOR ? (userId ?? NO_DOCTOR_SENTINEL) : undefined;

    if (!bypassCache) {
      const cached = getFromCache(tenantId, role, activityScope);
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
      needs('totalPatients')         ? getTotalPatients(tenantId, doctorId) : Promise.resolve(undefined),
      needs('todayOpdCount')         ? getTodayOpdCount(tenantId, doctorId) : Promise.resolve(undefined),
      needs('activeIpdCount')        ? getActiveIpdCount(tenantId, doctorId) : Promise.resolve(undefined),
      needs('newRegistrationsToday') ? getNewRegistrationsToday(tenantId) : Promise.resolve(undefined),
      needs('pendingLabCount')       ? getPendingLabCount(tenantId, doctorId) : Promise.resolve(undefined),
      needs('labReportsToday')       ? getLabReportsToday(tenantId, doctorId) : Promise.resolve(undefined),
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
      needs('recentActivities')      ? getRecentActivities(tenantId, activityUserId) : Promise.resolve(undefined),
    ]));

    const stats: DashboardStats = { lastUpdated: new Date().toISOString() };

    if (needs('totalPatients')         && totalPatients         !== undefined) stats.totalPatients         = totalPatients as number;
    if (needs('todayOpdCount')         && todayOpdCount         !== undefined) stats.todayOpdCount         = todayOpdCount as number;
    if (needs('activeIpdCount')        && activeIpdCount        !== undefined) stats.activeIpdCount        = activeIpdCount as number;
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

    setInCache(tenantId, role, activityScope, stats);
    return stats;
  }
}

export const dashboardService = new DashboardService();
