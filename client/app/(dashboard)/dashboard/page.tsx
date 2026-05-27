'use client';

import { useState } from 'react';
import {
  Users,
  CalendarDays,
  BedDouble,
  FlaskConical,
  IndianRupee,
  PackageX,
  UserCheck,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

import { useGetDashboardStatsQuery } from '@/store/api/dashboard.api';
import type { TrendPoint, RevenueTrendPoint } from '@/store/api/dashboard.api';
import { useAppSelector }            from '@/store/hooks';
import { StatCard }                  from '@/components/dashboard/StatCard';
import { TrendChart }                from '@/components/dashboard/TrendChart';
import { AlertBadge }                from '@/components/dashboard/AlertBadge';
import { DashboardSkeleton }         from '@/components/dashboard/DashboardSkeleton';

const POLL_INTERVAL_MS =
  parseInt(process.env.NEXT_PUBLIC_DASHBOARD_POLL_INTERVAL_SECONDS ?? '60', 10) * 1000;

function formatINR(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

function opdTrendData(trend?: TrendPoint[]): { date: string; value: number }[] {
  return (trend ?? []).map((p) => ({ date: p.date, value: p.count }));
}

function revenueTrendData(trend?: RevenueTrendPoint[]): { date: string; value: number }[] {
  return (trend ?? []).map((p) => ({ date: p.date, value: p.amount }));
}

export default function DashboardPage() {
  const [refreshArg, setRefreshArg] = useState<{ refresh?: boolean } | void>(undefined);

  const role = useAppSelector((s) => s.auth.profile?.role);

  const { data, isLoading, isFetching, isError, refetch } =
    useGetDashboardStatsQuery(refreshArg, {
      pollingInterval: POLL_INTERVAL_MS,
    });

  function handleRefresh() {
    setRefreshArg({ refresh: true });
    refetch();
  }

  if (isLoading) return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          {data?.lastUpdated && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last refreshed at{' '}
              {new Date(data.lastUpdated).toLocaleTimeString('en-IN', {
                hour:   '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          aria-label="Refresh dashboard"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {isError && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Unable to load statistics. Retrying…
        </div>
      )}

      {/* Alert badges row — low-stock + pending lab */}
      {(data?.lowStockCount !== undefined || data?.pendingLabCount !== undefined) && (
        <div className="flex flex-wrap gap-2">
          {data?.lowStockCount !== undefined && (
            <AlertBadge
              icon={PackageX}
              label="Low Stock"
              count={data.lowStockCount}
              warn
            />
          )}
          {data?.pendingLabCount !== undefined && (
            <AlertBadge
              icon={FlaskConical}
              label="Pending Lab"
              count={data.pendingLabCount}
              warn={data.pendingLabCount > 0}
            />
          )}
        </div>
      )}

      {/* Stat card grid — 1 col mobile, 2 col tablet, 4 col desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {data?.totalPatients !== undefined && (
          <StatCard
            icon={Users}
            label="Total Patients"
            value={data.totalPatients}
            context="registered in your hospital"
          />
        )}
        {data?.todayOpdCount !== undefined && (
          <StatCard
            icon={CalendarDays}
            label="Today's OPD"
            value={data.todayOpdCount}
            context="appointments today"
          />
        )}
        {data?.activeIpdCount !== undefined && (
          <StatCard
            icon={BedDouble}
            label="Active IPD"
            value={data.activeIpdCount}
            context="currently admitted"
          />
        )}
        {data?.pendingLabCount !== undefined && role !== 'STAFF' && (
          <StatCard
            icon={FlaskConical}
            label="Pending Lab Reports"
            value={data.pendingLabCount}
            context="pathology + radiology"
          />
        )}
        {data?.revenueToday !== undefined && (
          <StatCard
            icon={IndianRupee}
            label="Revenue Today"
            value={formatINR(data.revenueToday)}
            context="payments collected today"
          />
        )}
        {data?.revenueThisMonth !== undefined && (
          <StatCard
            icon={IndianRupee}
            label="Revenue This Month"
            value={formatINR(data.revenueThisMonth)}
            context="current calendar month"
          />
        )}
        {data?.lowStockCount !== undefined && (
          <StatCard
            icon={PackageX}
            label="Low Stock Items"
            value={data.lowStockCount}
            context="below minimum threshold"
          />
        )}
        {data?.totalActiveStaff !== undefined && (
          <StatCard
            icon={UserCheck}
            label="Active Staff"
            value={data.totalActiveStaff}
            context="active accounts"
          />
        )}
      </div>

      {/* Trend charts — only for roles that have trend data */}
      {(data?.monthlyOpdTrend !== undefined || data?.monthlyRevenueTrend !== undefined) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {data?.monthlyOpdTrend !== undefined && (
            <TrendChart
              title="OPD Visits — Last 30 Days"
              data={opdTrendData(data.monthlyOpdTrend)}
              color="#3b82f6"
            />
          )}
          {data?.monthlyRevenueTrend !== undefined && (
            <TrendChart
              title="Revenue (₹) — Last 30 Days"
              data={revenueTrendData(data.monthlyRevenueTrend)}
              color="#10b981"
            />
          )}
        </div>
      )}
    </div>
  );
}
