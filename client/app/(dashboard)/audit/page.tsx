'use client';

import { useState, useCallback } from 'react';
import {
  FileText,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';
import { useListAuditLogsQuery } from '@/store/api/audit.api';
import type { AuditQueryParams } from '@/store/api/audit.api';
import { AuditEntityTypes } from '@/store/types';
import { useAppSelector } from '@/store/hooks';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Badge }  from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

function truncate(str: string, len = 20): string {
  return str.length > len ? `${str.slice(0, len)}…` : str;
}

const ACTION_COLORS: Record<string, string> = {
  CREATE:         'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  UPDATE:         'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  DELETE:         'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  LOGIN:          'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  LOGOUT:         'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  LOCKOUT:        'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  PASSWORD_RESET: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

const LIMIT = 25;

// ─── Filter form state ────────────────────────────────────────────────────────

interface FilterState {
  entityType: string;
  entityId:   string;
  userId:     string;
  dateFrom:   string;
  dateTo:     string;
}

const EMPTY_FILTERS: FilterState = {
  entityType: '',
  entityId:   '',
  userId:     '',
  dateFrom:   '',
  dateTo:     '',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const role = useAppSelector((s) => s.auth.profile?.role);

  const [filters, setFilters]       = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied]       = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage]             = useState(1);

  // Only HOSPITAL_ADMIN and SUPER_ADMIN are allowed by the backend
  const canAccess = role === 'HOSPITAL_ADMIN' || role === 'SUPER_ADMIN';

  const queryParams: AuditQueryParams = {
    ...(applied.entityType && { entityType: applied.entityType }),
    ...(applied.entityId   && { entityId:   applied.entityId   }),
    ...(applied.userId     && { userId:      applied.userId     }),
    ...(applied.dateFrom   && { dateFrom:    applied.dateFrom   }),
    ...(applied.dateTo     && { dateTo:      applied.dateTo     }),
    page,
    limit: LIMIT,
  };

  const { data, isFetching, isError, error, refetch } = useListAuditLogsQuery(
    queryParams,
    { skip: !canAccess },
  );

  const applyFilters = useCallback(() => {
    setApplied({ ...filters });
    setPage(1);
  }, [filters]);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') applyFilters();
  }

  // ─── Access denied ──────────────────────────────────────────────────────────
  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-semibold text-lg">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">
            Audit logs are available to Hospital Admin and Super Admin only.
          </p>
        </div>
      </div>
    );
  }

  const logs       = data?.data       ?? [];
  const total      = data?.total      ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
            <p className="text-sm text-muted-foreground">
              Append-only record of all critical entity operations
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Filter form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Entity Type */}
            <div className="space-y-1.5">
              <Label htmlFor="entityType">Entity Type</Label>
              <select
                id="entityType"
                value={filters.entityType}
                onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
                onKeyDown={handleKeyDown}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">All types</option>
                {AuditEntityTypes.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Entity ID */}
            <div className="space-y-1.5">
              <Label htmlFor="entityId">Entity ID</Label>
              <Input
                id="entityId"
                placeholder="UUID or identifier"
                value={filters.entityId}
                onChange={(e) => setFilters((f) => ({ ...f, entityId: e.target.value }))}
                onKeyDown={handleKeyDown}
              />
            </div>

            {/* User ID */}
            <div className="space-y-1.5">
              <Label htmlFor="userId">User ID</Label>
              <Input
                id="userId"
                placeholder="UUID of the actor"
                value={filters.userId}
                onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
                onKeyDown={handleKeyDown}
              />
            </div>

            {/* Date From */}
            <div className="space-y-1.5">
              <Label htmlFor="dateFrom">From</Label>
              <Input
                id="dateFrom"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              />
            </div>

            {/* Date To */}
            <div className="space-y-1.5">
              <Label htmlFor="dateTo">To</Label>
              <Input
                id="dateTo"
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              />
            </div>

            {/* Actions */}
            <div className="space-y-1.5 flex flex-col justify-end">
              <div className="flex gap-2">
                <Button onClick={applyFilters} disabled={isFetching} className="flex-1 gap-2">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Search
                </Button>
                <Button variant="outline" onClick={clearFilters} disabled={isFetching}>
                  Clear
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error state */}
      {isError && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {/* @ts-expect-error RTK error shape */}
            {error?.data?.message ?? 'Failed to load audit logs. You may not have permission to view this data.'}
          </span>
        </div>
      )}

      {/* Results */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Results
              {total > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({total.toLocaleString()} total)
                </span>
              )}
            </CardTitle>
            {isFetching && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Entity Type</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Entity ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">User ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {!isFetching && logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      No audit logs found for the selected filters.
                    </td>
                  </tr>
                )}
                {logs.map((log) => (
                  <tr
                    key={log.auditId}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    {/* Entity Type */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                        {log.entityType.replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Entity ID */}
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-muted-foreground" title={log.entityId}>
                      {truncate(log.entityId, 16)}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          ACTION_COLORS[log.action] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {log.action}
                      </span>
                    </td>

                    {/* User ID */}
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-muted-foreground" title={log.userId}>
                      {truncate(log.userId, 16)}
                    </td>

                    {/* Timestamp */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(log.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isFetching}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || isFetching}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
