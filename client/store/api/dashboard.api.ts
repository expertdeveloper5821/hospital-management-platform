import { baseApi }    from './base.api';
import type { ApiSuccess } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  date:  string;
  count: number;
}

export interface RevenueTrendPoint {
  date:   string;
  amount: number;
}

export interface RecentActivity {
  entityType: string;
  entityId:   string;
  action:     string;
  timestamp:  string;
}

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
  // that field, already date-scoped to today). Today/This Month counterparts
  // of pendingLabCount / pendingPaymentsCount / lowStockCount above — those
  // base fields stay live, date-unscoped totals used elsewhere on this page.
  opdCountThisMonth?:             number;
  pendingLabCountToday?:          number;
  pendingLabCountThisMonth?:      number;
  pendingPaymentsCountToday?:     number;
  pendingPaymentsCountThisMonth?: number;
  lowStockCountToday?:            number;
  lowStockCountThisMonth?:        number;

  // Hospital Overview — Today/This Month counterparts of the "Total Patients
  // Registered"/"Active IPD"/"Active Staff"/"Lab Reports"/"New Registrations"
  // metric cards (formerly the standalone Key Stats Strip, now folded in
  // here). "Total Patients Registered" and "New Registrations" share the
  // very same registration-date-scoped values — newRegistrationsToday above
  // for Today, newRegistrationsThisMonth for This Month.
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

// ─── API slice ────────────────────────────────────────────────────────────────

export const dashboardApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getDashboardStats: build.query<DashboardStats, { refresh?: boolean } | void>({
      query: (arg) => {
        const refresh = arg && arg.refresh;
        return refresh ? '/api/dashboard/stats?refresh=true' : '/api/dashboard/stats';
      },
      transformResponse: (raw: ApiSuccess<DashboardStats>) => raw.data,
      providesTags: ['Dashboard' as never],
    }),
  }),
});

export const { useGetDashboardStatsQuery } = dashboardApi;
