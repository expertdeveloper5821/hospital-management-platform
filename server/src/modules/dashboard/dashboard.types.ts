import { UserRole } from '../../shared/types/common.types';

// ─── Trend Point ──────────────────────────────────────────────────────────────

export interface TrendPoint {
  date:  string; // YYYY-MM-DD
  count: number;
}

export interface RevenueTrendPoint {
  date:   string; // YYYY-MM-DD
  amount: number;
}

// ─── DashboardStats ───────────────────────────────────────────────────────────

/** Role-filtered response shape for GET /api/v1/dashboard/stats */
export interface DashboardStats {
  lastUpdated: string; // ISO timestamp

  // Admin | Manager | Doctor | Nurse | Receptionist
  totalPatients?:       number;
  todayOpdCount?:       number;

  // Admin | Manager | Doctor | Nurse
  activeIpdCount?:      number;

  // Admin | Manager | Doctor
  pendingLabCount?:     number;

  // Admin | Manager
  revenueToday?:        number;
  revenueThisMonth?:    number;
  lowStockCount?:       number;
  totalActiveStaff?:    number;

  // Admin | Manager | Doctor
  monthlyOpdTrend?:     TrendPoint[];

  // Admin | Manager
  monthlyRevenueTrend?: RevenueTrendPoint[];
}

// ─── Role field access map ────────────────────────────────────────────────────

type DashboardField = keyof Omit<DashboardStats, 'lastUpdated'>;

export const ROLE_FIELD_ACCESS: Record<UserRole, DashboardField[]> = {
  [UserRole.ADMIN]: [
    'totalPatients',
    'todayOpdCount',
    'activeIpdCount',
    'pendingLabCount',
    'revenueToday',
    'revenueThisMonth',
    'lowStockCount',
    'totalActiveStaff',
    'monthlyOpdTrend',
    'monthlyRevenueTrend',
  ],
  [UserRole.MANAGER]: [
    'totalPatients',
    'todayOpdCount',
    'activeIpdCount',
    'pendingLabCount',
    'revenueToday',
    'revenueThisMonth',
    'lowStockCount',
    'totalActiveStaff',
    'monthlyOpdTrend',
    'monthlyRevenueTrend',
  ],
  [UserRole.DOCTOR]: [
    'totalPatients',
    'todayOpdCount',
    'activeIpdCount',
    'pendingLabCount',
    'monthlyOpdTrend',
  ],
  [UserRole.NURSE]: [
    'totalPatients',
    'todayOpdCount',
    'activeIpdCount',
  ],
  [UserRole.RECEPTIONIST]: [
    'totalPatients',
    'todayOpdCount',
  ],
  [UserRole.HOSPITAL_ADMIN]: [
    'totalPatients',
    'todayOpdCount',
    'activeIpdCount',
    'pendingLabCount',
    'revenueToday',
    'revenueThisMonth',
    'lowStockCount',
    'totalActiveStaff',
    'monthlyOpdTrend',
    'monthlyRevenueTrend',
  ],
  // Roles below have endpoint access but no specific stat fields defined in FR-E01.4
  [UserRole.STAFF]:           [],
  [UserRole.SUPER_ADMIN]:     [],
  [UserRole.PATHOLOGIST]:     [],
  [UserRole.RADIOLOGIST]:     [],
  [UserRole.FINANCE_MANAGER]: [],
  [UserRole.HR]:              [],
};
