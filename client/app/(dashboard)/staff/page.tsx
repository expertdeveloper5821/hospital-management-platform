'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useListUsersQuery } from '@/store/api/user.api';
import { useAppSelector } from '@/store/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

const ALLOWED_ROLES = ['HOSPITAL_ADMIN', 'HR'];

export default function StaffPage() {
  const router  = useRouter();
  const profile = useAppSelector((s) => s.auth.profile);

  if (profile && !ALLOWED_ROLES.includes(profile.role)) {
    router.replace('/dashboard');
    return null;
  }

  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);

  const { data, isLoading, isError } = useListUsersQuery({ search: search || undefined, page, limit: 20 });

  const canSeeIdCard = profile?.role === 'HOSPITAL_ADMIN' || profile?.role === 'HR';

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Staff</h1>

      <div className="max-w-sm">
        <Input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {isError   && <p className="text-red-600">Failed to load staff list.</p>}

      <div className="space-y-2">
        {data?.data.map((user) => (
          <Card key={user.userId}>
            <CardContent className="flex items-center justify-between py-3 px-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{user.name || user.email}</p>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              </div>

              <div className="flex items-center gap-3 ml-4 shrink-0">
                <Badge variant="outline" className="text-xs">{user.role}</Badge>

                <Link href={`/staff/${user.userId}/documents`}>
                  <Button variant="outline" size="sm">Documents</Button>
                </Link>

                {canSeeIdCard && (
                  <Link href={`/staff/${user.userId}/id-card`}>
                    <Button variant="outline" size="sm">ID Card</Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data && data.data.length === 0 && !isLoading && (
        <p className="text-muted-foreground">No staff members found.</p>
      )}

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
