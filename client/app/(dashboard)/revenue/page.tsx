"use client";

import { useMemo, useState } from "react";
import { useGetDepartmentRevenueQuery } from "@/store/api/payment.api";
import { useAppSelector } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Building2, RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthRange(year: number, monthIndex0: number) {
  const from = new Date(year, monthIndex0, 1);
  const to = new Date(year, monthIndex0 + 1, 0);
  return { from: toDateStr(from), to: toDateStr(to) };
}

type RevenueFilterType = "TODAY" | "DAILY" | "THIS_MONTH" | "MONTHLY" | "CUSTOM";

const FILTER_OPTIONS: Array<{ value: RevenueFilterType; label: string }> = [
  { value: "THIS_MONTH", label: "This Month" },
  { value: "TODAY", label: "Today" },
  { value: "DAILY", label: "Daily" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "CUSTOM", label: "Custom Date Range" },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RevenuePage() {
  const role = useAppSelector((s) => s.auth.profile?.role);

  // Same role set as the Payments page's "canSummary" gate (Payment Summary /
  // Department-wise Revenue), since Revenue is that reporting surface moved
  // to its own page — access must stay consistent with it.
  const canView = ["MANAGER", "FINANCE_MANAGER", "HOSPITAL_ADMIN", "ADMIN"].includes(role ?? "");

  const now = useMemo(() => new Date(), []);
  const today = toDateStr(now);

  const [filterType, setFilterType] = useState<RevenueFilterType>("THIS_MONTH");
  const [dailyDate, setDailyDate] = useState(today);
  const [monthValue, setMonthValue] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // "ALL" | a departmentId | "OTHER" — filters which row(s) the table shows;
  // it never affects the underlying date-filtered query or the grand total.
  const [departmentFilter, setDepartmentFilter] = useState("ALL");

  const { dateFrom, dateTo } = useMemo(() => {
    switch (filterType) {
      case "TODAY":
        return { dateFrom: today, dateTo: today };
      case "DAILY":
        return { dateFrom: dailyDate, dateTo: dailyDate };
      case "THIS_MONTH": {
        const { from } = monthRange(now.getFullYear(), now.getMonth());
        return { dateFrom: from, dateTo: today };
      }
      case "MONTHLY": {
        const [y, m] = monthValue.split("-").map(Number);
        if (!y || !m) return { dateFrom: "", dateTo: "" };
        const { from, to } = monthRange(y, m - 1);
        return { dateFrom: from, dateTo: to };
      }
      case "CUSTOM":
        return { dateFrom: customFrom, dateTo: customTo };
      default:
        return { dateFrom: "", dateTo: "" };
    }
  }, [filterType, today, dailyDate, monthValue, customFrom, customTo, now]);

  const { data, isFetching, isError, refetch } = useGetDepartmentRevenueQuery(
    { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { skip: !canView },
  );

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <TrendingUp className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm">You do not have access to the revenue module.</p>
      </div>
    );
  }

  const showEmptyState = !isFetching && !isError && data && data.departments.length === 0 && data.other.total === 0;

  const allRows = useMemo(() => {
    if (!data) return [];
    return [
      ...data.departments.map((dept) => ({ ...dept, key: dept.departmentId, id: dept.departmentId })),
      { key: "OTHER", id: "OTHER", name: "Other Revenue", ...data.other },
    ];
  }, [data]);

  const visibleRows = useMemo(
    () => (departmentFilter === "ALL" ? allRows : allRows.filter((row) => row.id === departmentFilter)),
    [allRows, departmentFilter],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Revenue</h1>
          <p className="text-sm text-muted-foreground">Department-wise collected revenue</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label htmlFor="revenue-filter-type" className="text-xs">Filter</Label>
          <select
            id="revenue-filter-type"
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as RevenueFilterType)}
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {filterType === "DAILY" && (
          <div className="space-y-1">
            <Label htmlFor="revenue-daily-date" className="text-xs">Date</Label>
            <Input
              id="revenue-daily-date"
              type="date"
              max={today}
              value={dailyDate}
              onChange={(e) => setDailyDate(e.target.value)}
            />
          </div>
        )}

        {filterType === "MONTHLY" && (
          <div className="space-y-1">
            <Label htmlFor="revenue-month" className="text-xs">Month</Label>
            <Input
              id="revenue-month"
              type="month"
              max={`${now.getFullYear()}-${pad(now.getMonth() + 1)}`}
              value={monthValue}
              onChange={(e) => setMonthValue(e.target.value)}
            />
          </div>
        )}

        {filterType === "CUSTOM" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="revenue-from-date" className="text-xs">From Date</Label>
              <Input
                id="revenue-from-date"
                type="date"
                max={customTo || today}
                value={customFrom}
                onChange={(e) => {
                  const value = e.target.value;
                  setCustomFrom(value);
                  if (customTo && value > customTo) setCustomTo(value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="revenue-to-date" className="text-xs">To Date</Label>
              <Input
                id="revenue-to-date"
                type="date"
                min={customFrom}
                max={today}
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          </>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-9 self-end"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
        </Button>
      </div>

      {/* Department-wise revenue */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <CardTitle className="text-base">Department-wise Revenue</CardTitle>
            </div>
            {data && !showEmptyState && (
              <div className="space-y-1">
                <Label htmlFor="revenue-department-filter" className="text-xs sm:sr-only">Department</Label>
                <select
                  id="revenue-department-filter"
                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                >
                  <option value="ALL">All Departments</option>
                  {data.departments.map((dept) => (
                    <option key={dept.departmentId} value={dept.departmentId}>{dept.name}</option>
                  ))}
                  <option value="OTHER">Other Revenue</option>
                </select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isFetching ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
          ) : isError ? (
            <div className="py-4 text-center text-sm text-destructive">
              Failed to load revenue data.
            </div>
          ) : showEmptyState ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No departments have been created yet.
            </div>
          ) : data ? (
            <div className="space-y-3">
              <div className="rounded-md border overflow-x-auto">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-muted/50">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Department</th>
                        <th className="px-4 py-2 font-medium text-right">OPD Revenue</th>
                        <th className="px-4 py-2 font-medium text-right">IPD Revenue</th>
                        <th className="px-4 py-2 font-medium text-right">Direct Payment</th>
                        <th className="px-4 py-2 font-medium text-right">Total Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-4 text-center text-muted-foreground">
                            No matching department.
                          </td>
                        </tr>
                      ) : (
                        visibleRows.map((row) => (
                          <tr key={row.key} className="border-t">
                            <td className="px-4 py-2.5 break-words">{row.name}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(row.opdRevenue)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(row.ipdRevenue)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(row.directPayment)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatINR(row.total)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border px-4 py-3 bg-muted/30">
                <span className="text-sm font-medium">Total Revenue</span>
                <span className="text-xl font-bold tabular-nums">{formatINR(data.grandTotal)}</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
