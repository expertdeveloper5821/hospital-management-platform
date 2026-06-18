'use client';

import { useState } from 'react';
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
import { Building2, Plus, Pencil, Trash2, X, RefreshCw } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
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
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
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
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DepartmentsPage() {
  const { data: departments, isLoading, refetch } = useListDepartmentsQuery();
  const { data: usersResult, isLoading: doctorsLoading } = useListUsersQuery({ role: 'DOCTOR', limit: 100 });
  const [deleteDepartment] = useDeleteDepartmentMutation();

  const [showCreate, setShowCreate]     = useState(false);
  const [editing, setEditing]           = useState<DepartmentResponse | null>(null);
  const [deleting, setDeleting]         = useState<DepartmentResponse | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError]   = useState<string | null>(null);

  const allDoctors = usersResult?.data ?? [];
  // Map departmentId → list of doctor names for quick lookup in the table
  const doctorsByDept = allDoctors.reduce<Record<string, string[]>>((acc, u) => {
    for (const dId of u.departmentIds) {
      (acc[dId] ??= []).push(u.name);
    }
    return acc;
  }, {});

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
            {!isLoading && departments?.map((dept) => {
              const names = doctorsByDept[dept.departmentId] ?? [];
              return (
                <tr key={dept.departmentId} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{dept.name}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {dept.description ?? <span className="italic">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {doctorsLoading ? (
                      <span className="text-muted-foreground italic text-xs">Loading…</span>
                    ) : names.length === 0 ? (
                      <span className="text-muted-foreground italic">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {names.map((n) => (
                          <span key={n} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary font-medium">{n}</span>
                        ))}
                      </div>
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
