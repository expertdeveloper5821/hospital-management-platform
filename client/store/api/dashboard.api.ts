import { baseApi }    from './base.api';
import type { ApiSuccess } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  date:  string; // YYYY-MM-DD
  count: number;
}

export interface RevenueTrendPoint {
  date:   string;
  amount: number;
}

export interface DashboardStats {
  lastUpdated:          string;
  totalPatients?:       number;
  todayOpdCount?:       number;
  activeIpdCount?:      number;
  pendingLabCount?:     number;
  revenueToday?:        number;
  revenueThisMonth?:    number;
  lowStockCount?:       number;
  totalActiveStaff?:    number;
  monthlyOpdTrend?:     TrendPoint[];
  monthlyRevenueTrend?: RevenueTrendPoint[];
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
