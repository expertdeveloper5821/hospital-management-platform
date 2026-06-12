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
  admissionsToday?:       number;
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
