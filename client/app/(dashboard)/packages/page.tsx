'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useListPackagesQuery } from '@/store/api/packages.api';
import { useAppSelector } from '@/store/hooks';
import type { PackageStatus } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

// Backend caps packages list pages at 20.
const PACKAGES_PAGE_SIZE = 20;

export default function PackagesPage() {
  const profile = useAppSelector((s) => s.auth.profile);
  const [statusFilter, setStatusFilter] = useState<PackageStatus | undefined>();
  const [page, setPage] = useState(1);
  const [search, setSearch]                   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 300ms debounce for search; a new search always starts from page 1
  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value.trim());
      setPage(1);
    }, 300);
  }
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const { data, isLoading, isFetching, isError } = useListPackagesQuery({
    status: statusFilter,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    page,
    limit: PACKAGES_PAGE_SIZE,
  });

  const packages   = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  // Derived from the response rather than local state: an offline cache read
  // returns everything matching as a single page (page 1, totalPages 1).
  const rangeStart = total === 0 || !data ? 0 : (data.page - 1) * data.limit + 1;
  const rangeEnd   = rangeStart === 0 ? 0 : rangeStart + packages.length - 1;

  // A shrinking result set (e.g. a package deactivated while filtering by
  // ACTIVE) would otherwise leave `page` past the end and render an empty page.
  useEffect(() => {
    if (!isFetching && data && page > Math.max(1, totalPages)) setPage(Math.max(1, totalPages));
  }, [isFetching, data, page, totalPages]);

  const canCreate = profile?.role === 'HOSPITAL_ADMIN' || profile?.role === 'ADMIN' || profile?.role === 'RECEPTIONIST';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Packages</h1>
        {canCreate && (
          <Link href="/packages/new">
            <Button>+ New Package</Button>
          </Link>
        )}
      </div>

      <div className="max-w-sm">
        <Input
          placeholder="Search packages by name…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        {(['', 'ACTIVE', 'INACTIVE'] as const).map((s) => (
          <Button
            key={s}
            variant={statusFilter === (s || undefined) ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setStatusFilter(s ? s as PackageStatus : undefined); setPage(1); }}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      {isLoading && <p className="text-muted-foreground">Loading packages…</p>}
      {isError  && <p className="text-red-600">Failed to load packages.</p>}

      {data && packages.length === 0 && !isFetching && (
        <p className="text-muted-foreground">
          {debouncedSearch ? 'No packages match your search.' : 'No packages found.'}
        </p>
      )}

      <div className="grid gap-4">
        {packages.map((pkg) => (
          <Link key={pkg.packageId} href={`/packages/${pkg.packageId}`}>
            <Card className="h-24 cursor-pointer transition-colors hover:bg-muted/50">
              <CardContent className="flex h-full items-center justify-between gap-4 p-5">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-base font-semibold leading-none text-foreground">{pkg.name}</p>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">₹{pkg.price.toFixed(2)}</span>
                    <span>{pkg.includedServices.length} service{pkg.includedServices.length === 1 ? '' : 's'}</span>
                    {pkg.wardName && <span>Ward: {pkg.wardName}</span>}
                  </div>
                </div>
                <Badge
                  variant={pkg.status === 'ACTIVE' ? 'success' : 'destructive'}
                  className="w-[88px] h-6 shrink-0 justify-center text-center"
                >
                  {pkg.status}
                </Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Pagination + count */}
      {data && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
          <span>Showing {rangeStart}–{rangeEnd} of {total} package{total !== 1 ? 's' : ''}</span>
          {totalPages > 1 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="flex items-center px-2 text-xs">{page} / {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
