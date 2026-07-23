import { UserRole } from '../../shared/types/common.types';

// ─── Trend Points ─────────────────────────────────────────────────────────────

export interface TrendPoint {
  date:  string; // YYYY-MM-DD
  count: number;
}

export interface RevenueTrendPoint {
  date:   string; // YYYY-MM-DD
  amount: number;
}

export interface RecentActivity {
  entityType: string;
  entityId:   string;
  action:     string;
  timestamp:  string; // ISO
}

// ─── DashboardStats ───────────────────────────────────────────────────────────

export interface DashboardStats {
  lastUpdated: string;

  // Patient / OPD / IPD
  totalPatients?:         number;
  todayOpdCount?:         number;
  activeIpdCount?:        number;
  newRegistrationsToday?: number;

  // Lab
  pendingLabCount?:  number;
  labReportsToday?:  number;

  // Revenue / Payments
  revenueToday?:         number;
  revenueThisMonth?:     number;
  averageDailyRevenue?:  number;
  pendingPaymentsCount?: number;

  // Inventory
  lowStockCount?:       number;
  outOfStockCount?:     number;
  totalInventoryItems?: number;

  // Staff / Beds
  totalActiveStaff?: number;
  totalBeds?:        number;
  occupiedBeds?:     number;

  // Trends
  monthlyOpdTrend?:     TrendPoint[];
  monthlyRevenueTrend?: RevenueTrendPoint[];

  // Activity feed
  recentActivities?: RecentActivity[];
}

// ─── Role field access ────────────────────────────────────────────────────────

type DashboardField = keyof Omit<DashboardStats, 'lastUpdated'>;

export const ROLE_FIELD_ACCESS: Record<UserRole, DashboardField[]> = {
  [UserRole.ADMIN]: [
    'totalPatients', 'todayOpdCount', 'activeIpdCount', 'newRegistrationsToday',
    'pendingLabCount', 'labReportsToday',
    'revenueToday', 'revenueThisMonth', 'averageDailyRevenue', 'pendingPaymentsCount',
    'lowStockCount', 'outOfStockCount', 'totalInventoryItems',
    'totalActiveStaff', 'totalBeds', 'occupiedBeds',
    'monthlyOpdTrend', 'monthlyRevenueTrend', 'recentActivities',
  ],
  [UserRole.HOSPITAL_ADMIN]: [
    'totalPatients', 'todayOpdCount', 'activeIpdCount', 'newRegistrationsToday',
    'pendingLabCount', 'labReportsToday',
    'revenueToday', 'revenueThisMonth', 'averageDailyRevenue', 'pendingPaymentsCount',
    'lowStockCount', 'outOfStockCount', 'totalInventoryItems',
    'totalActiveStaff', 'totalBeds', 'occupiedBeds',
    'monthlyOpdTrend', 'monthlyRevenueTrend', 'recentActivities',
  ],
  [UserRole.MANAGER]: [
    'totalPatients', 'todayOpdCount', 'activeIpdCount', 'newRegistrationsToday',
    'pendingLabCount', 'labReportsToday',
    'revenueToday', 'revenueThisMonth', 'averageDailyRevenue', 'pendingPaymentsCount',
    'lowStockCount', 'outOfStockCount', 'totalInventoryItems',
    'totalActiveStaff', 'totalBeds', 'occupiedBeds',
    'monthlyOpdTrend', 'monthlyRevenueTrend', 'recentActivities',
  ],
  // Doctor sees only data scoped to their own patients/visits/admissions/lab
  // requests (enforced server-side in dashboard.service.ts) — no hospital-wide
  // aggregates (beds, tenant-wide OPD trend, staff, revenue, inventory).
  [UserRole.DOCTOR]: [
    'totalPatients', 'todayOpdCount', 'activeIpdCount',
    'pendingLabCount', 'labReportsToday',
    'recentActivities',
  ],
  [UserRole.NURSE]: [
    'totalPatients', 'todayOpdCount', 'activeIpdCount',
    'totalBeds', 'occupiedBeds',
    'recentActivities',
  ],
  [UserRole.RECEPTIONIST]: [
    'totalPatients', 'todayOpdCount',
    'newRegistrationsToday', 'pendingPaymentsCount',
    'recentActivities',
  ],
  [UserRole.PATHOLOGIST]: [
    'pendingLabCount', 'labReportsToday',
    'recentActivities',
  ],
  [UserRole.RADIOLOGIST]: [
    'pendingLabCount', 'labReportsToday',
    'recentActivities',
  ],
  [UserRole.FINANCE_MANAGER]: [
    'revenueToday', 'revenueThisMonth', 'averageDailyRevenue', 'pendingPaymentsCount',
    'monthlyRevenueTrend', 'recentActivities',
  ],
  [UserRole.HR]: [
    'totalActiveStaff', 'newRegistrationsToday',
    'recentActivities',
  ],
  [UserRole.STAFF]:       [],
  [UserRole.SUPER_ADMIN]: [],
};
