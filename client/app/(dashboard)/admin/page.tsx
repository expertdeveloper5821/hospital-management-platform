'use client';

import { useState, useRef } from 'react';
import {
  useGetBrandingQuery,
  useUpdateBrandingMutation,
} from '@/store/api/tenant.api';
import {
  useListUsersQuery,
  useCreateUserMutation,
  useUpdateUserRoleMutation,
  useDeactivateUserMutation,
} from '@/store/api/user.api';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setBranding } from '@/store/slices/auth.slice';
import { UserRole } from '@/store/types';
import type { UserResponse } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Settings,
  Users,
  Upload,
  RefreshCw,
  UserPlus,
  X,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Tab = 'branding' | 'users';

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

function CreateUserModal({ onClose }: CreateUserModalProps) {
  const [name,  setName]  = useState('');
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState<UserRole>(UserRole.STAFF);
  const [error, setError] = useState<string | null>(null);
  const [createUser, { isLoading }] = useCreateUserMutation();

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
      await createUser({ name: trimmedName, email: trimmedEmail, role }).unwrap();
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
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

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

// ─── Branding Tab ─────────────────────────────────────────────────────────────

function BrandingTab({ tenantId }: { tenantId: string }) {
  const dispatch = useAppDispatch();

  const { data: branding, isLoading } = useGetBrandingQuery(tenantId);
  const [updateBranding, { isLoading: saving }] = useUpdateBrandingMutation();

  const [displayName,  setDisplayName]  = useState('');
  const [primaryColor, setPrimaryColor] = useState('#1A73E8');
  const [logoFile,     setLogoFile]     = useState<File | null>(null);
  const [logoPreview,  setLogoPreview]  = useState<string | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [success,      setSuccess]      = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [initialised, setInitialised] = useState(false);
  if (branding && !initialised) {
    setDisplayName(branding.displayName ?? '');
    setPrimaryColor(branding.primaryColor ?? '#1A73E8');
    setInitialised(true);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be 2 MB or smaller.');
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await updateBranding({
        tenantId,
        displayName:  displayName.trim(),
        primaryColor,
        ...(logoFile ? { logo: logoFile } : {}),
      }).unwrap();

      dispatch(setBranding({
        logoUrl:      logoPreview ?? branding?.logoUrl ?? null,
        displayName:  displayName.trim(),
        primaryColor,
      }));

      setLogoFile(null);
      setSuccess('Branding updated successfully.');
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to save branding.');
    }
  }

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading branding…</div>;
  }

  const currentLogo = logoPreview ?? branding?.logoUrl ?? null;

  return (
    <form onSubmit={handleSave} className="max-w-lg space-y-6">
      {/* Logo */}
      <div className="space-y-3">
        <Label>Hospital Logo</Label>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {currentLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentLogo}
              alt="Logo preview"
              className="h-16 w-16 rounded-lg object-contain border bg-muted shrink-0"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg border bg-muted flex items-center justify-center text-muted-foreground text-xs shrink-0">
              No logo
            </div>
          )}
          <div className="space-y-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={saving}
            >
              <Upload className="h-4 w-4 mr-2" />
              {logoFile ? 'Change File' : 'Upload Logo'}
            </Button>
            {logoFile && (
              <p className="text-xs text-muted-foreground">{logoFile.name}</p>
            )}
            <p className="text-xs text-muted-foreground">PNG, JPG — max 2 MB</p>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Display name */}
      <div className="space-y-2">
        <Label htmlFor="displayName">Display Name</Label>
        <Input
          id="displayName"
          placeholder="City General Hospital"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          Shown in the portal header and on generated documents.
        </p>
      </div>

      {/* Primary color */}
      <div className="space-y-2">
        <Label htmlFor="primaryColor">Primary Color</Label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            id="primaryColor"
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            className="h-9 w-16 rounded-md border cursor-pointer bg-background"
          />
          <Input
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#1A73E8"
            className="w-32 font-mono"
          />
          <div
            className="h-9 w-9 rounded-md border"
            style={{ backgroundColor: primaryColor }}
            aria-label="Color preview"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
      )}
      {success && (
        <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">{success}</p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save Branding'}
        </Button>
      </div>
    </form>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const [page,          setPage]          = useState(1);
  const [filterRole,    setFilterRole]    = useState<UserRole | ''>('');
  const [showCreate,    setShowCreate]    = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [newRole,       setNewRole]       = useState<UserRole>(UserRole.STAFF);

  const limit = 20;

  const { data, isLoading, isFetching, refetch } = useListUsersQuery({
    page,
    limit,
    ...(filterRole ? { role: filterRole } : {}),
  });

  const [updateUserRole, { isLoading: updatingRole }]  = useUpdateUserRoleMutation();
  const [deactivateUser, { isLoading: deactivating }]  = useDeactivateUserMutation();

  const users      = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  async function handleDeactivate(userId: string) {
    await deactivateUser(userId);
  }

  function openRoleEdit(user: UserResponse) {
    setEditingRoleId(user.userId);
    setNewRole(user.role);
  }

  async function handleRoleSave(userId: string) {
    await updateUserRole({ userId, role: newRole });
    setEditingRoleId(null);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filterRole}
            onChange={(e) => { setFilterRole(e.target.value as UserRole | ''); setPage(1); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All roles</option>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
            ))}
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

      {/* Content */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center text-sm text-muted-foreground">Loading users…</div>
        ) : users.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            <Users className="mx-auto h-8 w-8 mb-3 opacity-40" />
            No users found
          </div>
        ) : (
          <>
            {/* Mobile card list — below md */}
            <div className="divide-y md:hidden">
              {users.map((user) => (
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
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={deactivating}
                          onClick={() => handleDeactivate(user.userId)}
                        >
                          Deactivate
                        </Button>
                      </div>
                    )
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table — md and above */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((user) => (
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
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={updatingRole}
                              onClick={() => handleRoleSave(user.userId)}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => setEditingRoleId(null)}
                            >
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
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {user.isActive && editingRoleId !== user.userId && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => openRoleEdit(user)}
                              >
                                Edit Role
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                disabled={deactivating}
                                onClick={() => handleDeactivate(user.userId)}
                              >
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
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
          <span>Page {page} of {totalPages} — {total} users</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('branding');
  const tenantId = useAppSelector((s) => s.auth.profile?.tenantId);

  if (!tenantId) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        No tenant associated with your account.
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Hospital Admin Panel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your hospital's branding and staff accounts.
        </p>
      </div>

      {/* Tabs — scrollable on mobile */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {([
          { key: 'branding', label: 'Branding',    Icon: Settings },
          { key: 'users',    label: 'Users',        Icon: Users    },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={[
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0',
              activeTab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'branding' && <BrandingTab tenantId={tenantId} />}
      {activeTab === 'users'    && <UsersTab />}
    </div>
  );
}
