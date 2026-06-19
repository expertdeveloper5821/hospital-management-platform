'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useListPackagesQuery } from '@/store/api/packages.api';
import { useAppSelector } from '@/store/hooks';
import type { PackageStatus } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function PackagesPage() {
  const profile = useAppSelector((s) => s.auth.profile);
  const [statusFilter, setStatusFilter] = useState<PackageStatus | undefined>();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useListPackagesQuery({ status: statusFilter, page, limit: 20 });

  const canCreate = profile?.role === 'HOSPITAL_ADMIN' || profile?.role === 'ADMIN';

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

      {data && data.data.length === 0 && (
        <p className="text-muted-foreground">No packages found.</p>
      )}

      <div className="grid gap-4">
        {data?.data.map((pkg) => (
          <Link key={pkg.packageId} href={`/packages/${pkg.packageId}`}>
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  {pkg.name}
                  <Badge variant={pkg.status === 'ACTIVE' ? 'default' : 'secondary'}>
                    {pkg.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground flex gap-6">
                <span>₹{pkg.price.toFixed(2)}</span>
                <span>{pkg.includedServices.length} services</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="text-sm">{page} / {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
