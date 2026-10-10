'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import {
  useListUsersQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeactivateUserMutation,
  useReactivateUserMutation,
} from '@/store/api/user.api';
import type { UpdateUserRequest } from '@/store/api/user.api';
import { useListDepartmentsQuery } from '@/store/api/department.api';
import { useAppSelector } from '@/store/hooks';
import { UserRole } from '@/store/types';
import type { UserResponse } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { DoctorActivePatientsDialog, type BlockedRoleChange } from '@/components/staff/DoctorActivePatientsDialog';
import { RoleChangeConflictDialog, type RoleChangeConflict } from '@/components/staff/RoleChangeConflictDialog';
import { cn } from '@/lib/utils';
import { serialNumber, serialOffset } from '@/lib/serial-number';
import {
  UserX,
  UserCheck,
  Users,
  RefreshCw,
  UserPlus,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  Pencil,
} from 'lucide-react';
import { NavForm } from '@/components/ui/form';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// HOSPITAL_ADMIN is intentionally excluded — it cannot be assigned via user
// management (enforced on the backend too). Tenant admins come from onboarding.
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
] as const;

const USER_NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,199}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Uttarakhand Medical Council Registration No. — 1–20 uppercase alphanumeric
// characters with optional hyphens/spaces as separators (leading/trailing
// separator rejected). Mirrors the server's ukmcNoSchema so client + server
// can never disagree about what a valid value looks like. Normalised (trim,
// uppercase, collapsed separator runs) before submit on both sides.
const UKMC_NO_RE = /^[A-Z0-9](?:[A-Z0-9 -]{0,18}[A-Z0-9])?$/;

/** Shared client-side Zod schema for the Create User and Edit User forms. */
const userFormSchema = z.object({
  name:  z.string().trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(200, 'Name must be at most 200 characters.')
    .regex(USER_NAME_RE, 'Only letters, spaces, and common name punctuation are allowed.'),
  email: z.string().trim().toLowerCase()
    .email('Enter a valid email address.')
    .max(254, 'Email must be at most 254 characters.'),
  role:  z.custom<UserRole>((v) => (ASSIGNABLE_ROLES as readonly UserRole[]).includes(v), 'Select a valid role.'),
  ukmcNo: z.string().trim().toUpperCase()
    .regex(UKMC_NO_RE, 'UKMC No. may contain 1–20 letters, digits, hyphens, or spaces (no leading/trailing separator).'),
});

type UserFormValues = z.infer<typeof userFormSchema>;

/**
 * Validate a user form against the shared schema, plus the role-conditional
 * rule (UKMC No. is mandatory for DOCTOR — empty or invalid only for them;
 * other roles never carry or send the field).
 * Returns the first form-level error, the Email error and the UKMC No. error
 * separately (each `null` when valid) so the last two can render directly
 * below their inputs.
 */
function validateUserForm(
  values: { name: string; email: string; role: UserRole; ukmcNo: string },
): { form: string | null; email: string | null; ukmcNo: string | null } {
  const base   = userFormSchema.omit({ ukmcNo: true }).safeParse(values);
  const issues = base.success ? [] : base.error.issues;
  const email  = issues.find((i) => i.path[0] === 'email')?.message ?? null;
  const formIssue = issues.find((i) => i.path[0] !== 'email');
  const form   = formIssue ? (formIssue.message || 'Invalid form data.') : null;
  let ukmcNo: string | null = null;
  if (values.role === UserRole.DOCTOR) {
    const normalised = values.ukmcNo.trim().toUpperCase().replace(/\s+|-{2,}/g, ' ');
    if (!UKMC_NO_RE.test(normalised)) {
      ukmcNo = values.ukmcNo.trim().length === 0
        ? 'UKMC No. is required for doctors.'
        : 'UKMC No. may contain 1–20 letters, digits, hyphens, or spaces (no leading/trailing separator).';
    }
  }
  return { form, email, ukmcNo };
}

/**
 * Server-side Email rejection — a Zod `fieldErrors.email` from the controller,
 * or UserService's duplicate-email 409 (a plain ConflictError with no
 * `details.code`, unlike the role-change conflicts) — so it renders under the
 * field. `null` for any other error.
 */
function emailServerError(
  status: number | undefined,
  data?: { message?: string; details?: Record<string, unknown> },
): string | null {
  const details = data?.details;
  if (status === 409 && typeof details?.code !== 'string' && data?.message && /email/i.test(data.message)) {
    return data.message;
  }
  const fieldErrors = (details?.errors as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors;
  return fieldErrors?.email?.[0] ?? null;
}

/**
 * Server-side UKMC No. rejection — 400 `UKMC_REQUIRED` from UserService, or a
 * Zod `fieldErrors.ukmcNo` from the controller — so it renders under the
 * field too. `null` for any other error.
 */
function ukmcServerError(data?: { message?: string; details?: Record<string, unknown> }): string | null {
  const details = data?.details;
  if (details?.code === 'UKMC_REQUIRED') return data?.message ?? 'UKMC No. is required for doctors.';
  const fieldErrors = (details?.errors as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors;
  return fieldErrors?.ukmcNo?.[0] ?? null;
}

/** Empty string when null/undefined so inputs prefill cleanly. */
function ukmcInputValue(ukmcNo: string | null | undefined): string {
  return ukmcNo ?? '';
}

/**
 * Canonical form stored/sent: trimmed, uppercased, separator runs (spaces,
 * hyphens) collapsed to a single space. Mirrors the server-side transform in
 * ukmcNoSchema, so what the client sends is already canonical.
 */
function normaliseUkmcNo(value: string): string {
  return value.trim().toUpperCase().replace(/\s+|-{2,}/g, ' ');
}

// Fixed size so every Status pill (Active / Inactive) renders identically —
// same width, height, padding, and centered text regardless of label length.
const STATUS_BADGE_CLASS = 'w-20 h-6 justify-center text-center whitespace-nowrap';

function roleBadgeVariant(role: string): 'info' | 'secondary' | 'outline' {
  // Role badges are informational, not brand — never tenant-color them.
  if (role === 'HOSPITAL_ADMIN') return 'info';
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

// Only doctors can be assigned to departments during user creation
const DEPARTMENT_ROLES = new Set<UserRole>([
  UserRole.DOCTOR,
]);

function CreateUserModal({ onClose }: CreateUserModalProps) {
  const [name,         setName]         = useState('');
  const [email,        setEmail]        = useState('');
  const [role,         setRole]         = useState<UserRole>(UserRole.STAFF);
  const [ukmcNo,       setUkmcNo]       = useState('');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [error,         setError]         = useState<string | null>(null);
  const [emailError,    setEmailError]    = useState<string | null>(null);
  const [ukmcError,     setUkmcError]     = useState<string | null>(null);

  const [createUser, { isLoading }] = useCreateUserMutation();
  const { data: departments }       = useListDepartmentsQuery();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailError(null);
    setUkmcError(null);

    const values = {
      name:   name.trim(),
      email:  email.trim().toLowerCase(),
      role,
      ukmcNo: normaliseUkmcNo(ukmcNo),
    };

    const validation = validateUserForm(values);
    if (validation.form || validation.email || validation.ukmcNo) {
      setError(validation.form);
      setEmailError(validation.email);
      setUkmcError(validation.ukmcNo);
      return;
    }

    try {
      await createUser({
        name:          values.name,
        email:         values.email,
        role,
        departmentIds: DEPARTMENT_ROLES.has(role) && departmentIds.length ? departmentIds : undefined,
        // Only sent for doctors — the backend clears it for everyone else.
        ukmcNo:        role === UserRole.DOCTOR ? values.ukmcNo : undefined,
      }).unwrap();
      onClose();
    } catch (err: unknown) {
      const { status, data } = (err ?? {}) as { status?: number; data?: { message?: string; details?: Record<string, unknown> } };
      const emailMsg = emailServerError(status, data);
      const ukmcMsg  = ukmcServerError(data);
      if (emailMsg || ukmcMsg) { setEmailError(emailMsg); setUkmcError(ukmcMsg); return; }
      setError(data?.message ?? 'Failed to create user.');
    }
  }

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between shrink-0 px-4 sm:px-6 pt-4 sm:pt-6">
          <h2 className="text-lg font-semibold">Create User</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* noValidate: jsdom/browser constraint validation on `required`/
            `pattern` would block the submit event before the shared Zod
            schema ever runs, so our styled error banner would never show. */}
        <NavForm onSubmit={handleSubmit} noValidate className="flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pt-5 pb-4 space-y-4">
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
                  setEmailError(null);
                }}
                maxLength={254}
                required
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'cu-email-error' : undefined}
              />
              {emailError && (
                <p id="cu-email-error" className="text-xs text-destructive" role="alert">{emailError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-role">Role</Label>
              <select
                id="cu-role"
                value={role}
                onChange={(e) => { setRole(e.target.value as UserRole); setUkmcNo(''); setUkmcError(null); setDepartmentIds([]); }}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            {role === UserRole.DOCTOR && (
              <div className="space-y-2">
                <Label htmlFor="cu-ukmc">UKMC No.</Label>
                <Input
                  id="cu-ukmc"
                  placeholder="UK-REG-12345"
                  value={ukmcNo}
                  onChange={(e) => { setUkmcNo(e.target.value.toUpperCase()); setError(null); setUkmcError(null); }}
                  maxLength={20}
                  required
                  aria-required="true"
                  aria-invalid={!!ukmcError}
                  aria-describedby={ukmcError ? 'cu-ukmc-error' : undefined}
                />
                {ukmcError && (
                  <p id="cu-ukmc-error" className="text-xs text-destructive" role="alert">{ukmcError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Uttarakhand Medical Council Registration Number (required for doctors).
                </p>
              </div>
            )}

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
          </div>

          <div className="flex justify-end gap-3 shrink-0 px-4 sm:px-6 pt-1 pb-4 sm:pb-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Creating…' : 'Create User'}
            </Button>
          </div>
        </NavForm>
      </div>
    </DialogOverlay>
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
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
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
    </DialogOverlay>
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
          <td className="px-4 py-3"><div className="h-4 w-6 bg-muted rounded" /></td>
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

// ─── Edit User Modal ──────────────────────────────────────────────────────────

interface EditUserModalProps {
  user:     UserResponse;
  /** Role gate — mirrors PATCH /api/users/:userId (backend HOSPITAL_ADMIN + HR). */
  canEditProfile: boolean;
  canDeactivate: boolean;
  /** Deactivation stays inside the dialog as a secondary footer action. */
  onDeactivate: (user: UserResponse) => void;
  onReactivate: (user: UserResponse) => void;
  /** Structured 409 from the combined PATCH surfaces in the shared dialog. */
  onConflict: (conflict: RoleChangeConflict) => void;
  reactivating: boolean;
  onClose:  () => void;
}

/**
 * Direct edit dialog replacing the old kebab menu's inline email/role editors.
 * Validates with the shared userFormSchema, submits one PATCH through
 * useUpdateUserMutation (tag invalidation updates the table instantly), and
 * routes structured 409s to the same conflict dialogs as before.
 */
function EditUserModal({
  user,
  canEditProfile,
  canDeactivate,
  onDeactivate,
  onReactivate,
  onConflict,
  reactivating,
  onClose,
}: EditUserModalProps) {
  const [name,    setName]    = useState(user.name);
  const [email,   setEmail]   = useState(user.email);
  const [role,    setRole]    = useState<UserRole>(user.role);
  const [ukmcNo,  setUkmcNo]  = useState(ukmcInputValue(user.ukmcNo));
  const [error,   setError]   = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [ukmcError, setUkmcError] = useState<string | null>(null);

  const [updateUser, { isLoading }] = useUpdateUserMutation();

  const isActive = user.isActive;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailError(null);
    setUkmcError(null);

    const values = {
      name:   name.trim(),
      email:  email.trim().toLowerCase(),
      role,
      ukmcNo: normaliseUkmcNo(ukmcNo),
    };

    const validation = validateUserForm(values);
    if (validation.form || validation.email || validation.ukmcNo) {
      setError(validation.form);
      setEmailError(validation.email);
      setUkmcError(validation.ukmcNo);
      return;
    }

    // Only send fields that actually changed so a no-op save never triggers a
    // spurious conflict 409 (e.g. role change conflict when role is unchanged).
    const body: UpdateUserRequest = {};
    if (values.name !== user.name)                     body.name   = values.name;
    if (values.email !== user.email)                   body.email  = values.email;
    if (role !== user.role)                            body.role   = role;
    const storedUkmc = ukmcInputValue(user.ukmcNo);
    if (role === UserRole.DOCTOR && values.ukmcNo !== storedUkmc) body.ukmcNo = values.ukmcNo;
    // Role left DOCTOR → explicitly clear the stored value.
    if (user.role === UserRole.DOCTOR && role !== UserRole.DOCTOR) body.ukmcNo = null;

    if (Object.keys(body).length === 0) {
      onClose(); // nothing to save
      return;
    }

    try {
      await updateUser({ userId: user.userId, body }).unwrap();
      onClose();
    } catch (err: unknown) {
      const e = err as {
        status?: number;
        data?: { message?: string; details?: Record<string, unknown> };
      };
      // Surface backend error messages; structured 409 conflict payloads are
      // handled by the parent (same DoctorActivePatientsDialog /
      // RoleChangeConflictDialog contract as before) via onErrorConflict.
      const details = e.data?.details as Record<string, unknown> | undefined;
      const code    = typeof details?.code === 'string' ? details.code : undefined;
      if (e.status === 409 && code) {
        onConflict({
          userName:      user.name,
          code,
          message:       e.data?.message ?? 'The change was rejected.',
          details:       details ?? {},
          requestedRole: body.role ?? null,
        });
        return;
      }
      const emailMsg = emailServerError(e.status, e.data);
      const ukmcMsg  = ukmcServerError(e.data);
      if (emailMsg || ukmcMsg) { setEmailError(emailMsg); setUkmcError(ukmcMsg); return; }
      const msg = e.data?.message;
      setError(msg ?? 'Failed to update user.');
    }
  }

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between shrink-0 px-4 sm:px-6 pt-4 sm:pt-6">
          <h2 className="text-lg font-semibold">Edit User</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Close edit user dialog">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* noValidate: same rationale as the Create User form above. */}
        <NavForm onSubmit={handleSubmit} noValidate className="flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pt-5 pb-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="eu-name">Full Name</Label>
              <Input
                id="eu-name"
                placeholder="Dr. Priya Sharma"
                value={name}
                onChange={(e) => { setName(sanitizeUserName(e.target.value)); setError(null); }}
                minLength={2}
                maxLength={200}
                pattern="[A-Za-z][A-Za-z .'-]{1,199}"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eu-email">Email</Label>
              <Input
                id="eu-email"
                type="email"
                placeholder="staff@hospital.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); setEmailError(null); }}
                maxLength={254}
                required
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'eu-email-error' : undefined}
              />
              {emailError && (
                <p id="eu-email-error" className="text-xs text-destructive" role="alert">{emailError}</p>
              )}
            </div>
            {canEditProfile && (
              <div className="space-y-2">
                <Label htmlFor="eu-role">Role</Label>
                <select
                  id="eu-role"
                  value={role}
                  onChange={(e) => { setRole(e.target.value as UserRole); setUkmcNo(''); setUkmcError(null); }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            )}

            {role === UserRole.DOCTOR && (
              <div className="space-y-2">
                <Label htmlFor="eu-ukmc">UKMC No.</Label>
                <Input
                  id="eu-ukmc"
                  placeholder="UK-REG-12345"
                  value={ukmcNo}
                  onChange={(e) => { setUkmcNo(e.target.value.toUpperCase()); setError(null); setUkmcError(null); }}
                  maxLength={20}
                  required
                  aria-required="true"
                  aria-invalid={!!ukmcError}
                  aria-describedby={ukmcError ? 'eu-ukmc-error' : undefined}
                />
                {ukmcError && (
                  <p id="eu-ukmc-error" className="text-xs text-destructive" role="alert">{ukmcError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Uttarakhand Medical Council Registration Number (required for doctors).
                </p>
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
            )}
          </div>

          <div className="flex justify-between items-center gap-3 shrink-0 px-4 sm:px-6 pt-1 pb-4 sm:pb-6">
            {/* Danger zone (left side) — deactivation/reactivation live here now,
                replacing the old kebab row actions. */}
            <div>
              {isActive && canDeactivate && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                  onClick={() => { onClose(); onDeactivate(user); }} disabled={isLoading}>
                  <UserX className="h-4 w-4 mr-1" /> Deactivate
                </Button>
              )}
              {!isActive && canDeactivate && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { onReactivate(user); onClose(); }} disabled={reactivating}>
                  <UserCheck className="h-4 w-4 mr-1" /> {reactivating ? 'Reactivating…' : 'Reactivate'}
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </NavForm>
      </div>
    </DialogOverlay>
  );
}

// ─── Row Edit Button (direct Edit, no kebab) ─────────────────────────────────

interface RowEditButtonProps {
  user: UserResponse;
  currentUserId?: string;
  canEditEmail: boolean;
  canDeactivate: boolean;
  onEdit: (user: UserResponse) => void;
}

/**
 * Direct 'Edit' button replacing the old kebab menu. Visibility mirrors the
 * old kebab's rule: shown only when the viewer has at least one available
 * action for the row (otherwise the cell is empty, never a dead button).
 */
function RowEditButton({ user, currentUserId, canEditEmail, canDeactivate, onEdit }: RowEditButtonProps) {
  const canEditRole = user.userId !== currentUserId;
  const isActive = user.isActive;

  const hasAnyAction = isActive
    ? (canEditEmail || canEditRole || canDeactivate)
    : canDeactivate;
  if (!hasAnyAction) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={() => onEdit(user)}
      aria-label={`Edit user ${user.name}`}
    >
      <Pencil className="h-3.5 w-3.5 mr-1" />
      Edit
    </Button>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const currentUserRole = useAppSelector((s) => s.auth.profile?.role);
  const currentUserId   = useAppSelector((s) => s.auth.profile?.userId);
  const canDeactivate   = currentUserRole === UserRole.HOSPITAL_ADMIN || currentUserRole === UserRole.HR;
  const canCreateUser   = currentUserRole === UserRole.HOSPITAL_ADMIN || currentUserRole === UserRole.HR;
  // PATCH /api/users/:userId (email/name) is HOSPITAL_ADMIN + HR on the backend;
  // ADMIN/MANAGER can view this page but must not see the Edit Email control.
  const canEditEmail    = currentUserRole === UserRole.HOSPITAL_ADMIN || currentUserRole === UserRole.HR;

  const [page,          setPage]          = useState(1);
  const [filterRole,    setFilterRole]    = useState<UserRole | ''>('');
  const [filterStatus,  setFilterStatus]  = useState<'ACTIVE' | 'INACTIVE' | ''>('');
  const [searchInput,   setSearchInput]   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy,        setSortBy]        = useState<SortByField>('createdAt');
  const [sortOrder,     setSortOrder]     = useState<'asc' | 'desc'>('desc');
  const [showCreate,    setShowCreate]    = useState(false);
  // Direct Edit dialog (replaces the old kebab menu's inline email/role
  // editors): the full user row being edited lives in modal state so the
  // form pre-fills from it and one edit is open at a time.
  const [editTarget,    setEditTarget]    = useState<UserResponse | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<UserResponse | null>(null);
  const [deactivateError,  setDeactivateError]  = useState<string | null>(null);
  // Doctor role-change restriction — the structured 409 payload (one blocked
  // attempt at a time; null = dialog closed). Branches on details.code, never
  // on message text. See DoctorActivePatientsDialog.
  const [blockedRoleChange, setBlockedRoleChange] = useState<BlockedRoleChange | null>(null);
  // Every OTHER structured 409 (nurse duty, lab requests, open payments,
  // attendance, ward roster, last-admin, inactive user) — same one-at-a-time
  // contract, rendered through the generic RoleChangeConflictDialog which
  // displays the exact conflict details the backend returned.
  const [roleConflict, setRoleConflict] = useState<RoleChangeConflict | null>(null);
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

  const router = useRouter();

  const [deactivateUser, { isLoading: deactivating }] = useDeactivateUserMutation();
  const [reactivateUser, { isLoading: reactivating }] = useReactivateUserMutation();

  const users      = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd   = Math.min(page * limit, total);
  const serialStart = serialOffset(data, page, limit);

  function handleSortClick(field: SortByField) {
    if (sortBy === field) {
      setSortOrder((o) => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  }

  // Structured 409 from the Edit User dialog. Route DOCTOR_ACTIVE_PATIENTS to
  // the specialist doctor dialog (breakdown UI), everything else to the
  // generic conflict dialog — same contract as the old inline role editor.
  function handleEditConflict(conflict: RoleChangeConflict) {
    if (
      conflict.code === 'DOCTOR_ACTIVE_PATIENTS' &&
      typeof conflict.details.activePatients === 'number'
    ) {
      const breakdown = conflict.details.breakdown as { opd?: number; ipd?: number } | undefined;
      setBlockedRoleChange({
        userId:         editTarget?.userId ?? '',
        userName:       conflict.userName,
        requestedRole:  conflict.requestedRole ?? UserRole.STAFF,
        activePatients: conflict.details.activePatients as number,
        breakdown:      { opd: breakdown?.opd ?? 0, ipd: breakdown?.ipd ?? 0 },
      });
      return;
    }
    setRoleConflict(conflict);
  }

  async function handleDeactivateConfirm() {
    if (!deactivateTarget) return;
    setDeactivateError(null);
    try {
      await deactivateUser(deactivateTarget.userId).unwrap();
      setDeactivateTarget(null);
    } catch (err: unknown) {
      // Structured 409 (LAST_ADMIN_CONFLICT, WARD_ROSTER_CONFLICT): show the
      // exact conflict details in the generic dialog instead of a message-only
      // inline error — same binding rule as role changes.
      const e = err as {
        status?: number;
        data?: { message?: string; details?: Record<string, unknown> };
      };
      const details = e.data?.details;
      const code    = typeof details?.code === 'string' ? details.code : undefined;
      if (e.status === 409 && code) {
        setDeactivateTarget(null);
        setRoleConflict({
          userName:      deactivateTarget.name,
          code,
          message:       e.data?.message ?? 'The deactivation was rejected.',
          details:       details ?? {},
          requestedRole: null, // deactivation block — no role requested
        });
        return;
      }
      const msg = e.data?.message;
      setDeactivateError(msg ?? 'Failed to deactivate user.');
    }
  }

  function handleReactivate(user: UserResponse) {
    reactivateUser(user.userId);
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
            placeholder="Search by name, role or email…"
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
          {canCreateUser && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          )}
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
                          <Badge variant={user.isActive ? 'success' : 'destructive'} className={cn(STATUS_BADGE_CLASS, 'text-xs')}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <RowEditButton
                          user={user}
                          currentUserId={currentUserId}
                          canEditEmail={canEditEmail}
                          canDeactivate={canDeactivate}
                          onEdit={() => { setDeactivateError(null); setEditTarget(user); }}
                        />
                      </div>
                    </div>
                  ))
              }
            </div>

            {/* Desktop table — md and above */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16 whitespace-nowrap">S. No.</th>
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
                    : users.map((user, idx) => (
                        <tr key={user.userId} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">{serialNumber(serialStart, idx)}</td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <div className="font-medium truncate" title={user.name}>{user.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{user.userId}</div>
                          </td>
                          <td className="px-4 py-3 max-w-[260px]">
                            <span className="text-muted-foreground block truncate" title={user.email}>{user.email}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span>{user.role.replace(/_/g, ' ')}</span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={user.isActive ? 'success' : 'destructive'} className={STATUS_BADGE_CLASS}>
                              {user.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end">
                              <RowEditButton
                                user={user}
                                currentUserId={currentUserId}
                                canEditEmail={canEditEmail}
                                canDeactivate={canDeactivate}
                                onEdit={() => { setDeactivateError(null); setEditTarget(user); }}
                              />
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

      {editTarget && (
        <EditUserModal
          user={editTarget}
          canEditProfile={canEditEmail}
          canDeactivate={canDeactivate}
          reactivating={reactivating}
          onDeactivate={(u) => { setDeactivateError(null); setDeactivateTarget(u); }}
          onReactivate={handleReactivate}
          onConflict={handleEditConflict}
          onClose={() => setEditTarget(null)}
        />
      )}

      {deactivateTarget && (
        <DeactivateModal
          user={deactivateTarget}
          onConfirm={handleDeactivateConfirm}
          onClose={() => setDeactivateTarget(null)}
          isLoading={deactivating}
          error={deactivateError}
        />
      )}

      {blockedRoleChange && (
        <DoctorActivePatientsDialog
          blocked={blockedRoleChange}
          onClose={() => setBlockedRoleChange(null)}
          onGoToPatients={() => {
            setBlockedRoleChange(null);
            router.push('/patients');
          }}
        />
      )}

      {roleConflict && (
        <RoleChangeConflictDialog
          conflict={roleConflict}
          onClose={() => setRoleConflict(null)}
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
