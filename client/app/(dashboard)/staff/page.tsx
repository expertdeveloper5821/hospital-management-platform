'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useListUsersQuery } from '@/store/api/user.api';
import { useAppSelector } from '@/store/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

// Mirrors GET /api/users requireRole on the backend — full staff list is
// restricted to admin/management roles + HR.
const ALLOWED_ROLES = ['HOSPITAL_ADMIN', 'ADMIN', 'MANAGER', 'HR'];

const STAFF_PAGE_SIZE = 20;

export default function StaffPage() {
  const router  = useRouter();
  const profile = useAppSelector((s) => s.auth.profile);
  const allowed = !profile || ALLOWED_ROLES.includes(profile.role);

  const [search, setSearch]                   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage]                       = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limit = STAFF_PAGE_SIZE;

  // 300ms debounce for search; a new search always starts from page 1
  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  }
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const appliedSearch = debouncedSearch.trim();
  const { data, isLoading, isFetching, isError } = useListUsersQuery(
    { ...(appliedSearch ? { search: appliedSearch } : {}), page, limit },
    { skip: !allowed },
  );

  const users      = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd   = Math.min(page * limit, total);

  // A shrinking result set (e.g. a staff member deactivated elsewhere) could
  // otherwise leave `page` past the end and render an empty page.
  useEffect(() => {
    if (!isFetching && totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [isFetching, page, totalPages]);

  useEffect(() => {
    if (!allowed) router.replace('/dashboard');
  }, [allowed, router]);

  if (!allowed) return null;

  const canSeeIdCard = profile?.role === 'HOSPITAL_ADMIN' || profile?.role === 'HR';

  return (
    <div className="px-4 pt-2 pb-5 space-y-4 sm:px-5">
      <h1 className="text-2xl font-bold">Staff</h1>

      <div className="max-w-sm">
        <Input
          placeholder="Search by name ,role or email…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {isError   && <p className="text-red-600">Failed to load staff list.</p>}

      <div className="space-y-2">
        {users.map((user) => (
          <Card key={user.userId}>
            <CardContent className="flex flex-col gap-2 py-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
              <div className="min-w-0">
                <p className="font-medium truncate">{user.name || user.email}</p>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:ml-4 sm:shrink-0">
                <span className="w-full text-sm font-bold text-muted-foreground sm:w-44 sm:pr-4 sm:whitespace-nowrap">{user.role}</span>

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

      {data && users.length === 0 && !isLoading && (
        <p className="text-muted-foreground">No staff members found.</p>
      )}

      {/* Pagination + count */}
      {data && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
          <span>
            {total === 0
              ? 'No staff members'
              : `Showing ${rangeStart}–${rangeEnd} of ${total} staff member${total !== 1 ? 's' : ''}`}
          </span>
          {totalPages > 1 && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="flex items-center px-2 text-xs">
                {page} / {totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
