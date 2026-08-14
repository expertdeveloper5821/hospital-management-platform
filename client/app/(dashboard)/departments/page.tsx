'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  useListDepartmentsQuery,
  useCreateDepartmentMutation,
  useUpdateDepartmentMutation,
  useDeleteDepartmentMutation,
  useUpdateDepartmentDoctorsMutation,
} from '@/store/api/department.api';
import { useListUsersQuery } from '@/store/api/user.api';
import type { DepartmentResponse, UserResponse } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CharCounter } from '@/components/ui/char-counter';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { Building2, Plus, Pencil, Trash2, X, RefreshCw, Search } from 'lucide-react';

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

interface DepartmentModalProps {
  existing?:   DepartmentResponse;
  allDoctors?: UserResponse[];
  onClose:     () => void;
}

function DepartmentModal({ existing, allDoctors = [], onClose }: DepartmentModalProps) {
  const [name,        setName]        = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [error,       setError]       = useState<string | null>(null);
  const [doctorSearch, setDoctorSearch] = useState('');

  // Which doctors are currently in this department (by userId)
  const initialAssigned = new Set(
    existing
      ? allDoctors.filter((d) => d.departmentIds.includes(existing.departmentId)).map((d) => d.userId)
      : [],
  );
  const [assigned, setAssigned] = useState<Set<string>>(initialAssigned);

  const [createDepartment,        { isLoading: creating  }] = useCreateDepartmentMutation();
  const [updateDepartment,        { isLoading: updating  }] = useUpdateDepartmentMutation();
  const [updateDepartmentDoctors, { isLoading: updatingDoctors }] = useUpdateDepartmentDoctorsMutation();
  const isLoading = creating || updating || updatingDoctors;

  function toggleDoctor(userId: string) {
    setAssigned((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }

  const filteredDoctors = doctorSearch.trim()
    ? allDoctors.filter((d) => d.name.toLowerCase().includes(doctorSearch.toLowerCase()))
    : allDoctors;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimName = name.trim();
    if (!trimName) { setError('Department name is required.'); return; }

    try {
      let departmentId = existing?.departmentId ?? '';

      if (existing) {
        await updateDepartment({
          departmentId,
          name:        trimName,
          description: description.trim() || null,
        }).unwrap();

        // Compute doctor assignment diff
        const add    = allDoctors.filter((d) =>  assigned.has(d.userId) && !initialAssigned.has(d.userId)).map((d) => d.userId);
        const remove = allDoctors.filter((d) => !assigned.has(d.userId) &&  initialAssigned.has(d.userId)).map((d) => d.userId);
        if (add.length > 0 || remove.length > 0) {
          await updateDepartmentDoctors({ departmentId, add, remove }).unwrap();
        }
      } else {
        const created = await createDepartment({
          name:        trimName,
          description: description.trim() || undefined,
        }).unwrap();
        departmentId = created.departmentId;
      }

      onClose();
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to save department.');
    }
  }

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{existing ? 'Edit Department' : 'Create Department'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dept-name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="dept-name"
              placeholder="e.g. Cardiology"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              maxLength={200}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dept-desc">Description</Label>
            <Input
              id="dept-desc"
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
            <CharCounter value={description} max={1000} />
          </div>

          {/* Doctors section — only when editing (need a departmentId to assign) */}
          {existing && (
            <div className="space-y-2">
              <Label>Assigned Doctors</Label>
              <Input
                placeholder="Search doctors…"
                value={doctorSearch}
                onChange={(e) => setDoctorSearch(e.target.value)}
                className="h-8 text-sm"
              />
              {allDoctors.length === 0 ? (
                <p className="text-xs text-muted-foreground">No doctors available.</p>
              ) : (
                <div className="rounded-md border max-h-48 overflow-y-auto divide-y">
                  {filteredDoctors.map((d) => (
                    <label
                      key={d.userId}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <input
                        type="checkbox"
                        className="accent-primary h-4 w-4 shrink-0"
                        checked={assigned.has(d.userId)}
                        onChange={() => toggleDoctor(d.userId)}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{d.name || 'Unnamed'}</p>
                        <p className="text-xs text-muted-foreground truncate">{d.email}</p>
                      </div>
                    </label>
                  ))}
                  {filteredDoctors.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No doctors match your search.</p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {assigned.size} doctor{assigned.size !== 1 ? 's' : ''} assigned
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving…' : existing ? 'Save Changes' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </DialogOverlay>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

interface DeleteModalProps {
  dept:      DepartmentResponse;
  onConfirm: () => Promise<void>;
  onClose:   () => void;
  isLoading: boolean;
  error:     string | null;
}

function DeleteModal({ dept, onConfirm, onClose, isLoading, error }: DeleteModalProps) {
  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Delete Department</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Delete <span className="font-medium text-foreground">{dept.name}</span>? This cannot be undone.
        </p>
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </DialogOverlay>
  );
}

// ─── Doctors Cell (chips + overflow popover) ──────────────────────────────────

const DOCTOR_CHIP_LIMIT = 3; // max chips shown inline before collapsing to "+N more"

function DoctorChip({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span
      className={`inline-flex max-w-[110px] items-center px-2 py-0.5 rounded-full text-xs bg-info/10 text-info font-medium ${className}`}
    >
      <span className="truncate min-w-0" title={name}>{name}</span>
    </span>
  );
}

function DoctorsCell({ names }: { names: string[] }) {
  const [open, setOpen]         = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const triggerRef  = useRef<HTMLButtonElement>(null);
  const popoverRef  = useRef<HTMLDivElement>(null);
  const closeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function openPopover() {
    clearCloseTimer();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 224; // matches w-56 popover
      const left  = Math.min(rect.left, window.innerWidth - width - 8);
      setPosition({ top: rect.bottom + 6, left: Math.max(8, left) });
    }
    setOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  // Close on outside click / Escape / any ancestor scroll (keeps the fixed-position popover from going stale).
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function handleScroll() { setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  if (names.length === 0) {
    return <span className="text-muted-foreground italic">—</span>;
  }

  const visible  = names.slice(0, DOCTOR_CHIP_LIMIT);
  const overflow = names.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((n) => <DoctorChip key={n} name={n} />)}

      {overflow > 0 && (
        <button
          type="button"
          ref={triggerRef}
          onClick={() => (open ? setOpen(false) : openPopover())}
          onMouseEnter={openPopover}
          onMouseLeave={scheduleClose}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground font-medium hover:bg-muted/80 transition-colors"
        >
          +{overflow} more
        </button>
      )}

      {open && overflow > 0 && position && createPortal(
        <div
          ref={popoverRef}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
          style={{ top: position.top, left: position.left }}
          className="fixed z-50 w-56 rounded-md border bg-background shadow-lg p-2 space-y-2"
        >
          <p className="text-xs font-semibold text-muted-foreground px-1">
            {names.length} doctor{names.length !== 1 ? 's' : ''}
          </p>

          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {names.map((n) => (
              <div key={n} className="px-2 py-1 rounded text-xs hover:bg-muted/40 truncate" title={n}>
                {n}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DepartmentsPage() {
  const { data: departments, isLoading, refetch } = useListDepartmentsQuery();
  const { data: usersResult, isLoading: doctorsLoading } = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const [deleteDepartment] = useDeleteDepartmentMutation();

  const [showCreate, setShowCreate]     = useState(false);
  const [editing, setEditing]           = useState<DepartmentResponse | null>(null);
  const [deleting, setDeleting]         = useState<DepartmentResponse | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError]   = useState<string | null>(null);
  const [search, setSearch]             = useState('');

  const allDoctors = usersResult?.data ?? [];
  // Map departmentId → list of doctor names for quick lookup in the table
  const doctorsByDept = allDoctors.reduce<Record<string, string[]>>((acc, u) => {
    for (const dId of u.departmentIds) {
      (acc[dId] ??= []).push(u.name);
    }
    return acc;
  }, {});

  // Global search — live-filters by department name OR any assigned doctor's name.
  const query = search.trim().toLowerCase();
  const filteredDepartments = (departments ?? []).filter((dept) => {
    if (!query) return true;
    if (dept.name.toLowerCase().includes(query)) return true;
    const doctorNames = doctorsByDept[dept.departmentId] ?? [];
    return doctorNames.some((n) => n.toLowerCase().includes(query));
  });

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteDepartment(deleting.departmentId).unwrap();
      setDeleting(null);
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setDeleteError(msg ?? 'Failed to delete department.');
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Departments</h1>
            <p className="text-sm text-muted-foreground">Manage clinical departments and assign head doctors</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by department ,doctor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
              aria-label="Search departments"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New Department
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Description</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Doctors</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b animate-pulse">
                  <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-32" /></td>
                  <td className="px-4 py-3 hidden sm:table-cell"><div className="h-4 bg-muted rounded w-48" /></td>
                  <td className="px-4 py-3 hidden md:table-cell"><div className="h-4 bg-muted rounded w-24" /></td>
                  <td className="px-4 py-3" />
                </tr>
              ))
            )}
            {!isLoading && (!departments || departments.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No departments yet. Create one to get started.
                </td>
              </tr>
            )}
            {!isLoading && departments && departments.length > 0 && filteredDepartments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No departments or doctors match &ldquo;{search.trim()}&rdquo;.
                </td>
              </tr>
            )}
            {!isLoading && filteredDepartments.map((dept) => {
              const names = doctorsByDept[dept.departmentId] ?? [];
              return (
                <tr key={dept.departmentId} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium max-w-[200px] truncate" title={dept.name}>{dept.name}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell max-w-xs truncate" title={dept.description ?? undefined}>
                    {dept.description ?? <span className="italic">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell max-w-[240px]">
                    {doctorsLoading ? (
                      <span className="text-muted-foreground italic text-xs">Loading…</span>
                    ) : (
                      <DoctorsCell names={names} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditing(dept)}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => { setDeleting(dept); setDeleteError(null); }}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {(showCreate || editing) && (
        <DepartmentModal
          existing={editing ?? undefined}
          allDoctors={allDoctors}
          onClose={() => { setShowCreate(false); setEditing(null); }}
        />
      )}
      {deleting && (
        <DeleteModal
          dept={deleting}
          onConfirm={handleDelete}
          onClose={() => setDeleting(null)}
          isLoading={deleteLoading}
          error={deleteError}
        />
      )}
    </div>
  );
}
