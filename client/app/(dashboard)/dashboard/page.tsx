'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users, CalendarDays, BedDouble, FlaskConical, IndianRupee,
  PackageX, UserCheck, RefreshCw, AlertTriangle, TrendingUp,
  ClipboardList, Package, Activity, CreditCard, PlusCircle,
  Stethoscope, TestTube2, ShoppingCart, Wallet,
} from 'lucide-react';
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import { useGetDashboardStatsQuery } from '@/store/api/dashboard.api';
import type { RecentActivity }       from '@/store/api/dashboard.api';
import { useAppSelector }            from '@/store/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn }     from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const POLL_MS = parseInt(process.env.NEXT_PUBLIC_DASHBOARD_POLL_INTERVAL_SECONDS ?? '60', 10) * 1000;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function formatINR(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function activityLabel(a: RecentActivity): string {
  const e   = a.entityType;
  const act = a.action;
  if (e === 'PATIENT'               && act === 'CREATE') return `Patient #${a.entityId} registered`;
  if (e === 'PATIENT'               && act === 'UPDATE') return `Patient #${a.entityId} updated`;
  if (e === 'IPD_ADMISSION'         && act === 'CREATE') return 'Patient admitted in IPD';
  if (e === 'IPD_ADMISSION'         && act === 'UPDATE') return 'IPD admission updated';
  if (e === 'OPD_VISIT'             && act === 'CREATE') return 'New OPD visit created';
  if (e === 'OPD_VISIT'             && act === 'UPDATE') return 'OPD visit updated';
  if (e === 'PAYMENT'               && act === 'CREATE') return 'Payment received';
  if (e === 'LAB_PATHOLOGY_REQUEST' && act === 'CREATE') return 'Lab test created';
  if (e === 'LAB_PATHOLOGY_REQUEST' && act === 'UPDATE') return 'Lab report updated';
  if (e === 'LAB_RADIOLOGY_REQUEST' && act === 'CREATE') return 'Radiology test created';
  if (e === 'LAB_RADIOLOGY_REQUEST' && act === 'UPDATE') return 'Radiology report updated';
  if (e === 'INVENTORY_ITEM'        && act === 'CREATE') return 'Inventory item added';
  if (e === 'INVENTORY_ITEM'        && act === 'UPDATE') return 'Inventory updated';
  return `${e.replace(/_/g, ' ')} ${act.toLowerCase()}`;
}

const ENTITY_BADGE: Record<string, { label: string; cls: string }> = {
  PATIENT:               { label: 'Patient',   cls: 'bg-blue-100 text-blue-700' },
  IPD_ADMISSION:         { label: 'IPD',        cls: 'bg-purple-100 text-purple-700' },
  OPD_VISIT:             { label: 'OPD',        cls: 'bg-cyan-100 text-cyan-700' },
  PAYMENT:               { label: 'Payment',    cls: 'bg-green-100 text-green-700' },
  LAB_PATHOLOGY_REQUEST: { label: 'Lab',        cls: 'bg-orange-100 text-orange-700' },
  LAB_RADIOLOGY_REQUEST: { label: 'Lab',        cls: 'bg-orange-100 text-orange-700' },
  INVENTORY_ITEM:        { label: 'Inventory',  cls: 'bg-yellow-100 text-yellow-700' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function AlertCard({
  icon: Icon, label, count, href, warn,
}: {
  icon: React.ElementType; label: string; count: number; href: string; warn?: boolean;
}) {
  return (
    <Link href={href}>
      <div className={cn(
        'rounded-xl border p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow',
        warn && count > 0 ? 'border-orange-200 bg-orange-50' : 'border-border bg-card',
      )}>
        <div className={cn(
          'rounded-full p-3',
          warn && count > 0 ? 'bg-orange-100' : 'bg-muted',
        )}>
          <Icon className={cn('h-5 w-5', warn && count > 0 ? 'text-orange-600' : 'text-muted-foreground')} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('text-2xl font-bold', warn && count > 0 ? 'text-orange-600' : 'text-foreground')}>
            {count}
          </p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
        </div>
        <span className="text-xs text-primary font-medium shrink-0">View →</span>
      </div>
    </Link>
  );
}

function MetricCard({
  icon: Icon, label, value, sub, color,
}: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={cn('rounded-full p-3', color ?? 'bg-primary/10')}>
          <Icon className={cn('h-5 w-5', color ? 'text-white' : 'text-primary')} />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function QuickAction({ icon: Icon, label, href, color }: {
  icon: React.ElementType; label: string; href: string; color: string;
}) {
  return (
    <Link href={href}>
      <Button variant="outline" className="w-full justify-start gap-2 h-10">
        <div className={cn('rounded p-1', color)}>
          <Icon className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm">{label}</span>
      </Button>
    </Link>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const role         = useAppSelector((s) => s.auth.profile?.role);
  const hospitalName = useAppSelector((s) => s.auth.branding?.displayName ?? 'Hospital');

  const [refreshArg, setRefreshArg] = useState<{ refresh?: boolean } | void>(undefined);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, isFetching, isError, refetch } = useGetDashboardStatsQuery(refreshArg, {
    pollingInterval: POLL_MS,
  });

  function handleRefresh() {
    setRefreshArg({ refresh: true });
    refetch();
  }

  // Quick action permissions — match exact page-level canXxx checks in each module's page
  const canRegisterPatient = ['RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canCreateOPD       = ['RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN', 'DOCTOR', 'ADMIN', 'MANAGER'].includes(role ?? '');
  const canAdmitPatient    = ['RECEPTIONIST', 'HOSPITAL_ADMIN', 'ADMIN'].includes(role ?? '');
  const canCreateLab       = ['DOCTOR', 'HOSPITAL_ADMIN', 'ADMIN', 'MANAGER'].includes(role ?? '');
  const canManageInventory = ['HOSPITAL_ADMIN', 'MANAGER'].includes(role ?? '');
  const canCollectPayment  = ['RECEPTIONIST', 'FINANCE_MANAGER', 'HOSPITAL_ADMIN', 'ADMIN', 'MANAGER'].includes(role ?? '');

  // Data-presence flags — backend already filtered by role; show a section only when the field arrived
  const hasBedData        = data?.totalBeds !== undefined;
  const hasOpdTrend       = data?.monthlyOpdTrend !== undefined;
  const hasRevTrend       = data?.monthlyRevenueTrend !== undefined;
  const hasInventory      = data?.totalInventoryItems !== undefined;
  const hasRevenue        = data?.revenueToday !== undefined;
  const hasActivities     = (data?.recentActivities?.length ?? 0) > 0;
  const hasCriticalAlerts = [
    data?.lowStockCount, data?.pendingLabCount, data?.pendingPaymentsCount, data?.todayOpdCount,
  ].some((v) => v !== undefined);
  const hasTodayActivity  = [
    data?.newRegistrationsToday, data?.todayOpdCount, data?.admissionsToday,
    data?.labReportsToday, data?.revenueToday,
  ].some((v) => v !== undefined);

  // Chart data
  const opdTrendData = (data?.monthlyOpdTrend ?? []).map((p) => ({ date: p.date.slice(5), value: p.count }));
  const revTrendData = (data?.monthlyRevenueTrend ?? []).map((p) => ({ date: p.date.slice(5), value: p.amount }));

  // Bed occupancy
  const occupiedBeds  = data?.occupiedBeds  ?? 0;
  const availableBeds = (data?.totalBeds ?? 0) - occupiedBeds;
  const bedPieData    = [
    { name: 'Occupied',  value: occupiedBeds,  color: '#10b981' },
    { name: 'Available', value: availableBeds, color: '#e5e7eb' },
  ];
  const occupancyPct = data?.totalBeds ? Math.round((occupiedBeds / data.totalBeds) * 100) : 0;

  if (isLoading) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="h-16 rounded-xl bg-muted" />
        <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted" />)}</div>
        <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted" />)}</div>
        <div className="grid grid-cols-3 gap-4">{[...Array(3)].map((_, i) => <div key={i} className="h-64 rounded-xl bg-muted" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── 1. Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {greeting()}, {hospitalName}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {fmtDate(currentTime)}
            {data?.lastUpdated && (
              <span className="ml-3 text-xs">| Last updated: {fmtTime(data.lastUpdated)}</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isFetching}
          className="self-start sm:self-auto"
        >
          <RefreshCw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Error banner */}
      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Unable to load dashboard statistics. Retrying…
        </div>
      )}

      {/* ── 2. Critical Alerts — data-driven; backend sends only what this role can see ── */}
      {hasCriticalAlerts && (
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2 text-foreground">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Critical Alerts
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {data?.lowStockCount !== undefined && (
              <AlertCard icon={PackageX}    label="Low Stock Items"       count={data.lowStockCount}        href="/inventory" warn />
            )}
            {data?.pendingLabCount !== undefined && (
              <AlertCard icon={FlaskConical} label="Pending Lab Reports"  count={data.pendingLabCount}      href="/lab"       warn />
            )}
            {data?.pendingPaymentsCount !== undefined && (
              <AlertCard icon={CreditCard}  label="Pending Payments"      count={data.pendingPaymentsCount} href="/payments"  warn />
            )}
            {data?.todayOpdCount !== undefined && (
              <AlertCard icon={CalendarDays} label="Today's Appointments" count={data.todayOpdCount}        href="/opd" />
            )}
          </div>
        </div>
      )}

      {/* ── 3. Key Stats Strip — data-driven ───────────────────────────────── */}
      {[
        data?.totalPatients,
        data?.activeIpdCount,
        data?.totalActiveStaff,
        data?.labReportsToday,
        data?.admissionsToday,
        data?.newRegistrationsToday,
      ].some((v) => v !== undefined) && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {data?.totalPatients !== undefined && (
            <MetricCard icon={Users}        label="Total Patients"        value={data.totalPatients}      sub="Registered" />
          )}
          {data?.activeIpdCount !== undefined && (
            <MetricCard icon={BedDouble}    label="Active IPD"            value={data.activeIpdCount}     sub="Admitted patients" />
          )}
          {data?.totalActiveStaff !== undefined && (
            <MetricCard icon={UserCheck}    label="Active Staff"          value={data.totalActiveStaff}   sub="Working today" />
          )}
          {data?.labReportsToday !== undefined && (
            <MetricCard icon={TestTube2}    label="Lab Reports Today"     value={data.labReportsToday}    sub="Completed" />
          )}
          {data?.admissionsToday !== undefined && (
            <MetricCard icon={BedDouble}    label="Admissions Today"      value={data.admissionsToday}    sub="New this day" />
          )}
          {data?.newRegistrationsToday !== undefined && (
            <MetricCard icon={Users}        label="New Registrations"     value={data.newRegistrationsToday} sub="Today" />
          )}
        </div>
      )}

      {/* ── 4. Revenue + Today's Activity + Quick Actions ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Revenue Overview — shown only when backend sends revenueToday (FINANCE roles) */}
        {hasRevenue && (
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <IndianRupee className="h-4 w-4 text-green-600" />
                Revenue Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-100">
                <div>
                  <p className="text-xs text-muted-foreground">Revenue Today</p>
                  <p className="text-xl font-bold text-green-700">{formatINR(data?.revenueToday ?? 0)}</p>
                </div>
                <TrendingUp className="h-6 w-6 text-green-500" />
              </div>
              {data?.revenueThisMonth !== undefined && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 border border-blue-100">
                  <div>
                    <p className="text-xs text-muted-foreground">Revenue This Month</p>
                    <p className="text-xl font-bold text-blue-700">{formatINR(data.revenueThisMonth)}</p>
                  </div>
                  <TrendingUp className="h-6 w-6 text-blue-500" />
                </div>
              )}
              {data?.averageDailyRevenue !== undefined && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                  <div>
                    <p className="text-xs text-muted-foreground">Avg Daily Revenue</p>
                    <p className="text-xl font-bold">{formatINR(data.averageDailyRevenue)}</p>
                  </div>
                  <Activity className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Today's Activity — data-driven; each row only when that field arrived */}
        {hasTodayActivity && (
          <Card className={cn(hasRevenue ? 'lg:col-span-1' : 'lg:col-span-2')}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Today's Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: 'New Registrations',    value: data?.newRegistrationsToday,                                           icon: Users,        color: 'text-blue-600' },
                  { label: 'OPD Visits',            value: data?.todayOpdCount,                                                   icon: Stethoscope,  color: 'text-cyan-600' },
                  { label: 'Admissions',            value: data?.admissionsToday,                                                 icon: BedDouble,    color: 'text-purple-600' },
                  { label: 'Lab Reports Generated', value: data?.labReportsToday,                                                 icon: TestTube2,    color: 'text-orange-600' },
                  { label: 'Payments Received',     value: data?.revenueToday !== undefined ? formatINR(data.revenueToday) : undefined, icon: IndianRupee, color: 'text-green-600' },
                ].filter((row) => row.value !== undefined).map((row) => {
                  const Icon = row.icon;
                  return (
                    <div key={row.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Icon className={cn('h-4 w-4', row.color)} />
                        {row.label}
                      </div>
                      <span className={cn('font-semibold text-sm', row.color)}>{row.value}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions — permission-gated per module's own canXxx rules */}
        {(canRegisterPatient || canCreateOPD || canAdmitPatient || canCreateLab || canManageInventory || canCollectPayment) && (
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-primary" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2">
                {canRegisterPatient  && <QuickAction icon={Users}        label="Register Patient" href="/patients"  color="bg-blue-500" />}
                {canCreateOPD        && <QuickAction icon={Stethoscope}  label="New OPD Visit"    href="/opd"       color="bg-cyan-500" />}
                {canAdmitPatient     && <QuickAction icon={BedDouble}    label="Admit Patient"    href="/ipd"       color="bg-purple-500" />}
                {canCreateLab        && <QuickAction icon={TestTube2}    label="Create Lab Test"  href="/lab"       color="bg-orange-500" />}
                {canManageInventory  && <QuickAction icon={ShoppingCart} label="Add Inventory"    href="/inventory" color="bg-yellow-500" />}
                {canCollectPayment   && <QuickAction icon={Wallet}       label="Collect Payment"  href="/payments"  color="bg-green-500" />}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── 5. Trend Charts — shown only when backend sends the trend arrays ── */}
      {(hasOpdTrend || hasRevTrend) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {hasOpdTrend && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-blue-500" />
                  OPD Trend
                  <span className="text-xs font-normal text-muted-foreground">(Last 30 Days)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {opdTrendData.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={opdTrendData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                      <defs>
                        <linearGradient id="opdGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="url(#opdGrad)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          )}
          {hasRevTrend && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <IndianRupee className="h-4 w-4 text-green-500" />
                  Revenue Trend
                  <span className="text-xs font-normal text-muted-foreground">(Last 30 Days)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {revTrendData.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={revTrendData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => formatINR(Number(v))} />
                      <Area type="monotone" dataKey="value" stroke="#10b981" fill="url(#revGrad)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── 6. Recent Activities + Inventory + Bed Occupancy ───────────────── */}
      {(data?.recentActivities !== undefined || hasInventory || hasBedData) && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* Recent Activities */}
          {data?.recentActivities !== undefined && (
            <Card className={cn(hasInventory || hasBedData ? 'xl:col-span-1' : 'xl:col-span-3')}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-primary" />
                  Recent Activities
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!hasActivities ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No recent activity</p>
                ) : (
                  <div className="space-y-3">
                    {(data?.recentActivities ?? []).map((a, i) => {
                      const badge = ENTITY_BADGE[a.entityType] ?? { label: a.entityType, cls: 'bg-muted text-muted-foreground' };
                      return (
                        <div key={i} className="flex items-start gap-3">
                          <span className="text-xs text-muted-foreground shrink-0 w-12 mt-0.5">{fmtTime(a.timestamp)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground leading-tight">{activityLabel(a)}</p>
                          </div>
                          <span className={cn('text-xs px-2 py-0.5 rounded font-medium shrink-0', badge.cls)}>
                            {badge.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Inventory Overview */}
          {hasInventory && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4 text-yellow-600" />
                  Inventory Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700">{data?.totalInventoryItems ?? 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">Total Items</p>
                  </div>
                  <div className={cn(
                    'rounded-lg border p-3 text-center',
                    (data?.lowStockCount ?? 0) > 0 ? 'bg-orange-50 border-orange-100' : 'bg-muted',
                  )}>
                    <p className={cn('text-2xl font-bold', (data?.lowStockCount ?? 0) > 0 ? 'text-orange-600' : 'text-foreground')}>
                      {data?.lowStockCount ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Low Stock</p>
                  </div>
                  <div className={cn(
                    'rounded-lg border p-3 text-center',
                    (data?.outOfStockCount ?? 0) > 0 ? 'bg-red-50 border-red-100' : 'bg-muted',
                  )}>
                    <p className={cn('text-2xl font-bold', (data?.outOfStockCount ?? 0) > 0 ? 'text-red-600' : 'text-foreground')}>
                      {data?.outOfStockCount ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Out of Stock</p>
                  </div>
                  <Link href="/inventory" className="rounded-lg bg-muted border p-3 text-center flex flex-col items-center justify-center hover:bg-accent transition-colors">
                    <p className="text-xs font-medium text-primary">View Inventory →</p>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bed Occupancy */}
          {hasBedData && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BedDouble className="h-4 w-4 text-purple-600" />
                  Bed Occupancy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="relative flex-shrink-0">
                    <ResponsiveContainer width={120} height={120}>
                      <PieChart>
                        <Pie
                          data={bedPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={38}
                          outerRadius={55}
                          startAngle={90}
                          endAngle={-270}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          {bedPieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg font-bold">{occupancyPct}%</span>
                    </div>
                  </div>
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                        <span className="text-muted-foreground">Occupied</span>
                      </div>
                      <span className="font-semibold text-red-600">{occupiedBeds}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-gray-200 inline-block" />
                        <span className="text-muted-foreground">Available</span>
                      </div>
                      <span className="font-semibold text-green-600">{availableBeds}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm border-t pt-2">
                      <span className="text-muted-foreground">Total Beds</span>
                      <span className="font-semibold">{data?.totalBeds ?? 0}</span>
                    </div>
                    <Link href="/ipd" className="block">
                      <Button variant="outline" size="sm" className="w-full mt-1 text-xs h-7">
                        View Bed Management →
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

    </div>
  );
}
