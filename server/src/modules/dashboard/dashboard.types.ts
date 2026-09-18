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

  // Hospital Overview — This Month counterpart of todayOpdCount (Today reuses
  // that existing field, already date-scoped to today). Today/This Month
  // counterparts of pendingLabCount / pendingPaymentsCount / lowStockCount
  // below — those base fields stay live, date-unscoped totals used elsewhere
  // (Inventory Overview, etc.) and are untouched by this pairing.
  opdCountThisMonth?:             number;
  pendingLabCountToday?:          number;
  pendingLabCountThisMonth?:      number;
  pendingPaymentsCountToday?:     number;
  pendingPaymentsCountThisMonth?: number;
  lowStockCountToday?:            number;
  lowStockCountThisMonth?:        number;

  // Hospital Overview — Today/This Month counterparts of the "Total Patients
  // Registered"/"Active IPD"/"Active Staff"/"Lab Reports"/"New Registrations"
  // cards (formerly the standalone Key Stats Strip, now folded in here).
  // "Total Patients Registered" and "New Registrations" share the very same
  // registration-date-scoped values — newRegistrationsToday (above, already
  // date-scoped) for Today, newRegistrationsThisMonth for This Month — so no
  // separate field exists for "Total Patients Registered" itself.
  newRegistrationsThisMonth?: number;
  activeIpdCountToday?:       number;
  activeIpdCountThisMonth?:   number;
  totalActiveStaffToday?:     number;
  totalActiveStaffThisMonth?: number;
  labReportsThisMonth?:       number;

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
    'opdCountThisMonth', 'pendingLabCountToday', 'pendingLabCountThisMonth',
    'pendingPaymentsCountToday', 'pendingPaymentsCountThisMonth',
    'lowStockCountToday', 'lowStockCountThisMonth',
    'newRegistrationsThisMonth', 'activeIpdCountToday', 'activeIpdCountThisMonth',
    'totalActiveStaffToday', 'totalActiveStaffThisMonth', 'labReportsThisMonth',
  ],
  [UserRole.HOSPITAL_ADMIN]: [
    'totalPatients', 'todayOpdCount', 'activeIpdCount', 'newRegistrationsToday',
    'pendingLabCount', 'labReportsToday',
    'revenueToday', 'revenueThisMonth', 'averageDailyRevenue', 'pendingPaymentsCount',
    'lowStockCount', 'outOfStockCount', 'totalInventoryItems',
    'totalActiveStaff', 'totalBeds', 'occupiedBeds',
    'monthlyOpdTrend', 'monthlyRevenueTrend', 'recentActivities',
    'opdCountThisMonth', 'pendingLabCountToday', 'pendingLabCountThisMonth',
    'pendingPaymentsCountToday', 'pendingPaymentsCountThisMonth',
    'lowStockCountToday', 'lowStockCountThisMonth',
    'newRegistrationsThisMonth', 'activeIpdCountToday', 'activeIpdCountThisMonth',
    'totalActiveStaffToday', 'totalActiveStaffThisMonth', 'labReportsThisMonth',
  ],
  [UserRole.MANAGER]: [
    'totalPatients', 'todayOpdCount', 'activeIpdCount', 'newRegistrationsToday',
    'pendingLabCount', 'labReportsToday',
    'revenueToday', 'revenueThisMonth', 'averageDailyRevenue', 'pendingPaymentsCount',
    'lowStockCount', 'outOfStockCount', 'totalInventoryItems',
    'totalActiveStaff', 'totalBeds', 'occupiedBeds',
    'monthlyOpdTrend', 'monthlyRevenueTrend', 'recentActivities',
    'opdCountThisMonth', 'pendingLabCountToday', 'pendingLabCountThisMonth',
    'pendingPaymentsCountToday', 'pendingPaymentsCountThisMonth',
    'lowStockCountToday', 'lowStockCountThisMonth',
    'newRegistrationsThisMonth', 'activeIpdCountToday', 'activeIpdCountThisMonth',
    'totalActiveStaffToday', 'totalActiveStaffThisMonth', 'labReportsThisMonth',
  ],
  // Doctor sees only data scoped to their own patients/visits/admissions/lab
  // requests (enforced server-side in dashboard.service.ts) — no hospital-wide
  // aggregates (beds, tenant-wide OPD trend, staff, revenue, inventory).
  [UserRole.DOCTOR]: [
    'totalPatients', 'todayOpdCount', 'activeIpdCount',
    'pendingLabCount', 'labReportsToday',
    'recentActivities',
    'opdCountThisMonth', 'pendingLabCountToday', 'pendingLabCountThisMonth',
    'activeIpdCountToday', 'activeIpdCountThisMonth', 'labReportsThisMonth',
  ],
  [UserRole.NURSE]: [
    'totalPatients', 'todayOpdCount', 'activeIpdCount',
    'totalBeds', 'occupiedBeds',
    'recentActivities',
    'opdCountThisMonth',
    'activeIpdCountToday', 'activeIpdCountThisMonth',
  ],
  [UserRole.RECEPTIONIST]: [
    'totalPatients', 'todayOpdCount',
    'newRegistrationsToday', 'pendingPaymentsCount',
    'recentActivities',
    'opdCountThisMonth', 'pendingPaymentsCountToday', 'pendingPaymentsCountThisMonth',
    'newRegistrationsThisMonth',
  ],
  [UserRole.PATHOLOGIST]: [
    'pendingLabCount', 'labReportsToday',
    'recentActivities',
    'pendingLabCountToday', 'pendingLabCountThisMonth',
    'labReportsThisMonth',
  ],
  [UserRole.RADIOLOGIST]: [
    'pendingLabCount', 'labReportsToday',
    'recentActivities',
    'pendingLabCountToday', 'pendingLabCountThisMonth',
    'labReportsThisMonth',
  ],
  [UserRole.FINANCE_MANAGER]: [
    'revenueToday', 'revenueThisMonth', 'averageDailyRevenue', 'pendingPaymentsCount',
    'monthlyRevenueTrend', 'recentActivities',
    'pendingPaymentsCountToday', 'pendingPaymentsCountThisMonth',
  ],
  [UserRole.HR]: [
    'totalActiveStaff', 'newRegistrationsToday',
    'recentActivities',
    'totalActiveStaffToday', 'totalActiveStaffThisMonth', 'newRegistrationsThisMonth',
  ],
  [UserRole.STAFF]:       [],
  [UserRole.SUPER_ADMIN]: [],
};
