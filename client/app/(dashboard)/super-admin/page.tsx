'use client';

import { useState } from 'react';
import {
  useListTenantsQuery,
  useApproveTenantMutation,
  useDeactivateTenantMutation,
  useResendInviteMutation,
} from '@/store/api/tenant.api';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, RefreshCw, CheckCircle, XCircle, Mail, Plus } from 'lucide-react';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'ACTIVE':               return 'default';
    case 'PENDING_VERIFICATION': return 'secondary';
    case 'INACTIVE':             return 'destructive';
    default:                     return 'outline';
  }
}

export default function SuperAdminPage() {
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, isFetching, refetch } = useListTenantsQuery({ page, limit });
  const [approveTenant,    { isLoading: approving   }] = useApproveTenantMutation();
  const [deactivateTenant, { isLoading: deactivating }] = useDeactivateTenantMutation();
  const [resendInvite,     { isLoading: resending    }] = useResendInviteMutation();

  const tenants    = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const isBusy = approving || deactivating || resending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Super Admin Console</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage hospital tenants — {total} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link href="/super-admin/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Onboard Hospital
            </Button>
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center text-sm text-muted-foreground">Loading tenants…</div>
        ) : tenants.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            <Building2 className="mx-auto h-8 w-8 mb-3 opacity-40" />
            No tenants found
          </div>
        ) : (
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
                    <Badge variant={statusVariant(tenant.status)}>{tenant.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(tenant.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {tenant.status === 'PENDING_VERIFICATION' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={isBusy}
                          onClick={() => approveTenant(tenant._id)}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1 text-green-500" />
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
                            Resend Invite
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
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
