'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  useListUsersQuery,
  useCreateUserMutation,
  useUpdateUserRoleMutation,
  useDeactivateUserMutation,
} from '@/store/api/user.api';
import { useListDepartmentsQuery } from '@/store/api/department.api';
import { useAppSelector } from '@/store/hooks';
import { UserRole } from '@/store/types';
import type { UserResponse } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  RefreshCw,
  UserPlus,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ASSIGNABLE_ROLES = [
  UserRole.MANAGER,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.PATHOLOGIST,
  UserRole.RADIOLOGIST,
  UserRole.FINANCE_MANAGER,
  UserRole.HR,
  UserRole.ADMIN,
  UserRole.STAFF,
  UserRole.HOSPITAL_ADMIN,
] as const;

const USER_NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,199}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function roleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' {
  if (role === 'HOSPITAL_ADMIN') return 'default';
  if (role === 'DOCTOR' || role === 'MANAGER') return 'secondary';
  return 'outline';
}

function sanitizeUserName(value: string) {
  return value.replace(/[^A-Za-z .'-]/g, '').replace(/\s{2,}/g, ' ').slice(0, 200);
}

// ─── Create User Modal ────────────────────────────────────────────────────────

interface CreateUserModalProps {
  onClose: () => void;
}

// Roles that can be assigned to a department
const DEPARTMENT_ROLES = new Set<UserRole>([
  UserRole.DOCTOR, UserRole.NURSE, UserRole.PATHOLOGIST, UserRole.RADIOLOGIST,
]);

function CreateUserModal({ onClose }: CreateUserModalProps) {
  const [name,         setName]         = useState('');
  const [email,        setEmail]        = useState('');
  const [role,         setRole]         = useState<UserRole>(UserRole.STAFF);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [error,         setError]         = useState<string | null>(null);

  const [createUser, { isLoading }] = useCreateUserMutation();
  const { data: departments }       = useListDepartmentsQuery();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!USER_NAME_RE.test(trimmedName)) {
      setError('Enter a valid full name using letters, spaces, and common name punctuation only.');
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    try {
      await createUser({
        name:          trimmedName,
        email:         trimmedEmail,
        role,
        departmentIds: DEPARTMENT_ROLES.has(role) && departmentIds.length ? departmentIds : undefined,
      }).unwrap();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to create user.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create User</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cu-name">Full Name</Label>
            <Input
              id="cu-name"
              placeholder="Dr. Priya Sharma"
              value={name}
              onChange={(e) => {
                setName(sanitizeUserName(e.target.value));
                setError(null);
              }}
              minLength={2}
              maxLength={200}
              pattern="[A-Za-z][A-Za-z .'-]{1,199}"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-email">Email</Label>
            <Input
              id="cu-email"
              type="email"
              placeholder="staff@hospital.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              maxLength={254}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-role">Role</Label>
            <select
              id="cu-role"
              value={role}
              onChange={(e) => { setRole(e.target.value as UserRole); setDepartmentIds([]); }}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {DEPARTMENT_ROLES.has(role) && (
            <div className="space-y-2">
              <Label>Departments</Label>
              {(departments ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No departments available.</p>
              ) : (
                <div className="rounded-md border border-input max-h-36 overflow-y-auto divide-y">
                  {(departments ?? []).map((d) => (
                    <label key={d.departmentId} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors">
                      <input
                        type="checkbox"
                        className="accent-primary h-4 w-4 shrink-0"
                        checked={departmentIds.includes(d.departmentId)}
                        onChange={(e) => {
                          setDepartmentIds((prev) =>
                            e.target.checked
                              ? [...prev, d.departmentId]
                              : prev.filter((id) => id !== d.departmentId)
                          );
                        }}
                      />
                      <span className="text-sm">{d.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Creating…' : 'Create User'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Deactivate Confirm Modal ─────────────────────────────────────────────────

interface DeactivateModalProps {
  user:      UserResponse;
  onConfirm: () => Promise<void>;
  onClose:   () => void;
  isLoading: boolean;
  error:     string | null;
}

function DeactivateModal({ user, onConfirm, onClose, isLoading, error }: DeactivateModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Deactivate User</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to deactivate <span className="font-medium text-foreground">{user.name}</span>?
          This action will revoke their access immediately.
        </p>
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Deactivating…' : 'Deactivate'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Sort Header Button ───────────────────────────────────────────────────────

type SortByField = 'name' | 'createdAt' | 'role';

interface SortHeaderProps {
  label:   string;
  field:   SortByField;
  current: { sortBy: SortByField; sortOrder: 'asc' | 'desc' };
  onClick: (field: SortByField) => void;
}

function SortHeader({ label, field, current, onClick }: SortHeaderProps) {
  const active = current.sortBy === field;
  const Icon = active
    ? current.sortOrder === 'asc' ? ChevronUp : ChevronDown
    : ChevronsUpDown;
  return (
    <button
      onClick={() => onClick(field)}
      className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function UserTableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          <td className="px-4 py-3">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-3 w-24 bg-muted/60 rounded mt-1" />
          </td>
          <td className="px-4 py-3"><div className="h-4 w-44 bg-muted rounded" /></td>
          <td className="px-4 py-3"><div className="h-5 w-20 bg-muted rounded-full" /></td>
          <td className="px-4 py-3"><div className="h-5 w-14 bg-muted rounded-full" /></td>
          <td className="px-4 py-3"><div className="h-6 w-20 bg-muted rounded ml-auto" /></td>
        </tr>
      ))}
    </>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const currentUserRole = useAppSelector((s) => s.auth.profile?.role);
  const canDeactivate   = currentUserRole === UserRole.HOSPITAL_ADMIN || currentUserRole === UserRole.HR;

  const [page,          setPage]          = useState(1);
  const [filterRole,    setFilterRole]    = useState<UserRole | ''>('');
  const [filterStatus,  setFilterStatus]  = useState<'ACTIVE' | 'INACTIVE' | ''>('');
  const [searchInput,   setSearchInput]   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy,        setSortBy]        = useState<SortByField>('createdAt');
  const [sortOrder,     setSortOrder]     = useState<'asc' | 'desc'>('desc');
  const [showCreate,    setShowCreate]    = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [newRole,       setNewRole]       = useState<UserRole>(UserRole.STAFF);
  const [deactivateTarget, setDeactivateTarget] = useState<UserResponse | null>(null);
  const [deactivateError,  setDeactivateError]  = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limit = 10;

  // 300ms debounce for search
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const { data, isLoading, isFetching, refetch } = useListUsersQuery({
    page,
    limit,
    ...(filterRole   ? { role:   filterRole }                              : {}),
    ...(filterStatus ? { status: filterStatus as 'ACTIVE' | 'INACTIVE' }  : {}),
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() }        : {}),
    sortBy,
    sortOrder,
  });

  const [updateUserRole, { isLoading: updatingRole }] = useUpdateUserRoleMutation();
  const [deactivateUser, { isLoading: deactivating }] = useDeactivateUserMutation();

  const users      = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd   = Math.min(page * limit, total);

  function handleSortClick(field: SortByField) {
    if (sortBy === field) {
      setSortOrder((o) => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  }

  function openRoleEdit(user: UserResponse) {
    setEditingRoleId(user.userId);
    setNewRole(user.role);
  }

  async function handleRoleSave(userId: string) {
    await updateUserRole({ userId, role: newRole });
    setEditingRoleId(null);
  }

  async function handleDeactivateConfirm() {
    if (!deactivateTarget) return;
    setDeactivateError(null);
    try {
      await deactivateUser(deactivateTarget.userId).unwrap();
      setDeactivateTarget(null);
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setDeactivateError(msg ?? 'Failed to deactivate user.');
    }
  }

  const sortState = { sortBy, sortOrder };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name or email…"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
            aria-label="Search users"
          />
        </div>

        {/* Filters + actions row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Role filter */}
            <select
              value={filterRole}
              onChange={(e) => { setFilterRole(e.target.value as UserRole | ''); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Filter by role"
            >
              <option value="">All Roles</option>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>

            {/* Status filter */}
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value as 'ACTIVE' | 'INACTIVE' | ''); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Filter by status"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>

            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {!isLoading && users.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            <Users className="mx-auto h-8 w-8 mb-3 opacity-40" />
            No users found matching your filters.
          </div>
        ) : (
          <>
            {/* Mobile card list — below md */}
            <div className="divide-y md:hidden">
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-4 space-y-2 animate-pulse">
                      <div className="h-4 w-36 bg-muted rounded" />
                      <div className="h-3 w-48 bg-muted/60 rounded" />
                      <div className="flex gap-2 mt-1">
                        <div className="h-5 w-20 bg-muted rounded-full" />
                        <div className="h-5 w-14 bg-muted rounded-full" />
                      </div>
                    </div>
                  ))
                : users.map((user) => (
                    <div key={user.userId} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{user.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate">{user.userId}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge variant={roleBadgeVariant(user.role)} className="text-xs">
                            {user.role.replace(/_/g, ' ')}
                          </Badge>
                          <Badge variant={user.isActive ? 'default' : 'destructive'} className="text-xs">
                            {user.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </div>

                      {editingRoleId === user.userId ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={newRole}
                            onChange={(e) => setNewRole(e.target.value as UserRole)}
                            className="h-8 rounded border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                          <Button size="sm" className="h-7 px-2 text-xs" disabled={updatingRole} onClick={() => handleRoleSave(user.userId)}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingRoleId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        user.isActive && (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openRoleEdit(user)}>
                              Edit Role
                            </Button>
                            {canDeactivate && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                onClick={() => { setDeactivateError(null); setDeactivateTarget(user); }}
                              >
                                Deactivate
                              </Button>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  ))
              }
            </div>

            {/* Desktop table — md and above */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <SortHeader label="Name" field="name" current={sortState} onClick={handleSortClick} />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                    <th className="px-4 py-3 text-left">
                      <SortHeader label="Role" field="role" current={sortState} onClick={handleSortClick} />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left">
                      <SortHeader label="Created" field="createdAt" current={sortState} onClick={handleSortClick} />
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading
                    ? <UserTableSkeleton />
                    : users.map((user) => (
                        <tr key={user.userId} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium">{user.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{user.userId}</div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                          <td className="px-4 py-3">
                            {editingRoleId === user.userId ? (
                              <div className="flex items-center gap-2">
                                <select
                                  value={newRole}
                                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                                  className="h-7 rounded border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                  {ASSIGNABLE_ROLES.map((r) => (
                                    <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                                  ))}
                                </select>
                                <Button size="sm" className="h-7 px-2 text-xs" disabled={updatingRole} onClick={() => handleRoleSave(user.userId)}>
                                  Save
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingRoleId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Badge variant={roleBadgeVariant(user.role)}>
                                {user.role.replace(/_/g, ' ')}
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={user.isActive ? 'default' : 'destructive'}>
                              {user.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              {user.isActive && editingRoleId !== user.userId && (
                                <>
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openRoleEdit(user)}>
                                    Edit Role
                                  </Button>
                                  {canDeactivate && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                      onClick={() => { setDeactivateError(null); setDeactivateTarget(user); }}
                                    >
                                      Deactivate
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Pagination + count */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
        <span>
          {total === 0
            ? 'No users'
            : `Showing ${rangeStart}–${rangeEnd} of ${total} user${total !== 1 ? 's' : ''}`}
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

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}

      {deactivateTarget && (
        <DeactivateModal
          user={deactivateTarget}
          onConfirm={handleDeactivateConfirm}
          onClose={() => setDeactivateTarget(null)}
          isLoading={deactivating}
          error={deactivateError}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Hospital Admin Panel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your hospital's staff accounts.
        </p>
      </div>

      <UsersTab />
    </div>
  );
}
