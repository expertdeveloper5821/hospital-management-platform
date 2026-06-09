'use client';

import { useState, useEffect } from 'react';
import {
  useListTenantsQuery,
  useApproveTenantMutation,
  useDeactivateTenantMutation,
  useResendInviteMutation,
} from '@/store/api/tenant.api';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Building2, RefreshCw, CheckCircle, XCircle, Mail, Plus, Search } from 'lucide-react';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'ACTIVE':               return 'default';
    case 'PENDING_VERIFICATION': return 'outline';
    case 'INACTIVE':             return 'destructive';
    default:                     return 'outline';
  }
}

function statusExtraClass(status: string): string {
  return status === 'PENDING_VERIFICATION'
    ? 'border-transparent bg-orange-500 text-white hover:bg-orange-500'
    : '';
}

export default function SuperAdminPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const limit = 10;

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isFetching, refetch } = useListTenantsQuery({ page, limit, search: search || undefined });
  const [approveTenant,    { isLoading: approving   }] = useApproveTenantMutation();
  const [deactivateTenant, { isLoading: deactivating }] = useDeactivateTenantMutation();
  const [resendInvite,     { isLoading: resending    }] = useResendInviteMutation();

  const tenants    = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const isBusy = approving || deactivating || resending;

  function TenantActions({ tenant }: { tenant: typeof tenants[0] }) {
    return (
      <>
        {tenant.status === 'PENDING_VERIFICATION' && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs bg-green-600 text-white border-green-600 hover:bg-green-700 hover:border-green-700"
            disabled={isBusy}
            onClick={() => approveTenant(tenant._id)}
          >
            <CheckCircle className="h-3.5 w-3.5 mr-1" />
            Approve
          </Button>
        )}
        {tenant.status === 'ACTIVE' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={isBusy}
              onClick={() => resendInvite(tenant._id)}
            >
              <Mail className="h-3.5 w-3.5 mr-1" />
              Resend
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              disabled={isBusy}
              onClick={() => deactivateTenant(tenant._id)}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Deactivate
            </Button>
          </>
        )}
      </>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Super Admin Console</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage hospital tenants — {total} total
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              placeholder="Search hospitals…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-8 w-48 pl-8 text-sm sm:w-56"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link href="/super-admin/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              <span className="hidden xs:inline">Onboard Hospital</span>
              <span className="xs:hidden">Onboard</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Empty / loading states */}
      {isLoading ? (
        <div className="rounded-lg border bg-card py-20 text-center text-sm text-muted-foreground">
          Loading tenants…
        </div>
      ) : tenants.length === 0 ? (
        <div className="rounded-lg border bg-card py-20 text-center text-sm text-muted-foreground">
          <Building2 className="mx-auto h-8 w-8 mb-3 opacity-40" />
          {search ? `No hospitals match "${search}"` : 'No tenants found'}
        </div>
      ) : (
        <>
          {/* Mobile card list — visible below md */}
          <div className="space-y-3 md:hidden">
            {tenants.map((tenant) => (
              <div key={tenant._id} className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{tenant.name}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{tenant._id}</p>
                  </div>
                  <Badge variant={statusVariant(tenant.status)} className={`shrink-0 text-xs ${statusExtraClass(tenant.status)}`}>
                    {tenant.status}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground truncate">{tenant.adminEmail}</div>
                <div className="text-xs text-muted-foreground">
                  Created: {new Date(tenant.createdAt).toLocaleDateString()}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <TenantActions tenant={tenant} />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table — visible from md up */}
          <div className="hidden md:block rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Hospital</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Admin Email</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tenants.map((tenant) => (
                    <tr key={tenant._id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{tenant.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{tenant._id}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{tenant.adminEmail}</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(tenant.status)} className={statusExtraClass(tenant.status)}>{tenant.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(tenant.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <TenantActions tenant={tenant} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
