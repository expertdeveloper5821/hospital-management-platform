'use client';

import { useState } from 'react';
import {
  useListWardsQuery,
  useCreateWardMutation,
  useListBedsQuery,
  useAddBedsMutation,
  useAssignNursesToWardMutation,
  useGetOccupancySummaryQuery,
} from '@/store/api/ipd.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useAppSelector } from '@/store/hooks';
import { UserRole }       from '@/store/types';
import type { WardResponse, UserResponse } from '@/store/types';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import {
  Bed,
  Building2,
  PlusCircle,
  RefreshCw,
  X,
  ChevronDown,
  ChevronRight,
  BarChart3,
  UserCheck,
} from 'lucide-react';

// ─── Add Beds Modal ───────────────────────────────────────────────────────────

interface AddBedsModalProps {
  ward:    WardResponse;
  onClose: () => void;
}

function AddBedsModal({ ward, onClose }: AddBedsModalProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [addBeds, { isLoading }] = useAddBedsMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const bedNumbers = input.split(',').map((s) => s.trim()).filter(Boolean);
    if (bedNumbers.length === 0) { setError('Enter at least one bed number.'); return; }
    if (bedNumbers.length > 50)  { setError('Cannot add more than 50 beds at once.'); return; }
    try {
      await addBeds({ wardId: ward.wardId, bedNumbers }).unwrap();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to add beds.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add Beds — {ward.name}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ab-numbers">Bed Numbers</Label>
            <Input
              id="ab-numbers"
              placeholder="101, 102, 103"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">Comma-separated, up to 50 beds.</p>
          </div>
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Adding…' : 'Add Beds'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Create Ward Modal ────────────────────────────────────────────────────────

function CreateWardModal({ onClose }: { onClose: () => void }) {
  const [name,  setName]  = useState('');
  const [floor, setFloor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createWard, { isLoading }] = useCreateWardMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createWard({ name: name.trim(), ...(floor.trim() ? { floor: floor.trim() } : {}) }).unwrap();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to create ward.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create Ward</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cw-name">Ward Name</Label>
            <Input id="cw-name" placeholder="General Ward" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cw-floor">Floor (optional)</Label>
            <Input id="cw-floor" placeholder="2" value={floor} onChange={(e) => setFloor(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>{isLoading ? 'Creating…' : 'Create Ward'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Ward Row (expandable) ────────────────────────────────────────────────────

interface WardRowProps {
  ward:             WardResponse;
  canManage:        boolean;
  canAssignNurses:  boolean;
  onAddBeds:        (ward: WardResponse) => void;
}

function WardRow({ ward, canManage, canAssignNurses, onAddBeds }: WardRowProps) {
  const [expanded,    setExpanded]    = useState(false);
  const [nurseIds,    setNurseIds]    = useState<string[]>(ward.assignedNurseIds ?? []);
  const [addNurseId,  setAddNurseId]  = useState('');
  const [nurseError,  setNurseError]  = useState<string | null>(null);
  const [nurseDirty,  setNurseDirty]  = useState(false);

  const { data: beds, isLoading: bedsLoading } = useListBedsQuery(ward.wardId, { skip: !expanded });
  const { data: nursesPage } = useListUsersQuery(
    { role: UserRole.NURSE, isActive: true, limit: 100 },
    { skip: !expanded },
  );
  const [assignNurses, { isLoading: saving }] = useAssignNursesToWardMutation();

  const allNurses: UserResponse[] = nursesPage?.data ?? [];
  const unassigned = allNurses.filter((n) => !nurseIds.includes(n.userId));

  const total    = beds?.length ?? 0;
  const occupied = beds?.filter((b) => b.isOccupied).length ?? 0;

  function handleAddNurse() {
    if (!addNurseId) return;
    setNurseIds((prev) => [...prev, addNurseId]);
    setAddNurseId('');
    setNurseDirty(true);
  }

  function handleRemoveNurse(id: string) {
    setNurseIds((prev) => prev.filter((n) => n !== id));
    setNurseDirty(true);
  }

  async function handleSaveNurses() {
    setNurseError(null);
    try {
      await assignNurses({ wardId: ward.wardId, nurseIds }).unwrap();
      setNurseDirty(false);
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setNurseError(msg ?? 'Failed to save nurses.');
    }
  }

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown  className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium">{ward.name}</span>
          {ward.floor && <span className="text-xs text-muted-foreground">Floor {ward.floor}</span>}
        </div>
        <div className="flex items-center gap-3">
          {expanded && !bedsLoading && (
            <span className="text-xs text-muted-foreground">{occupied}/{total} occupied</span>
          )}
          {(ward.assignedNurseIds?.length ?? 0) > 0 && (
            <span className="text-xs text-muted-foreground">
              <UserCheck className="inline h-3 w-3 mr-1" />
              {ward.assignedNurseIds.length} nurse{ward.assignedNurseIds.length !== 1 ? 's' : ''}
            </span>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={(e) => { e.stopPropagation(); onAddBeds(ward); }}
            >
              <PlusCircle className="h-3 w-3 mr-1" />
              Add Beds
            </Button>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-4">
          {/* Beds */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Beds</p>
            {bedsLoading ? (
              <p className="text-sm text-muted-foreground">Loading beds…</p>
            ) : !beds || beds.length === 0 ? (
              <p className="text-sm text-muted-foreground">No beds in this ward yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {beds.map((b) => (
                  <div
                    key={b.bedId}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
                      b.isOccupied
                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                        : 'border-green-500/40 bg-green-50 text-green-700',
                    ].join(' ')}
                  >
                    <Bed className="h-3 w-3" />
                    {b.bedNumber}
                    <span className="opacity-60">{b.isOccupied ? '· Occupied' : '· Free'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Nurses */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Assigned Nurses</p>

            {/* Assigned nurse chips */}
            {nurseIds.length === 0 ? (
              <p className="text-sm text-muted-foreground mb-2">No nurses assigned.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-2">
                {nurseIds.map((id) => {
                  const nurse = allNurses.find((n) => n.userId === id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium"
                    >
                      <UserCheck className="h-3 w-3" />
                      {nurse ? (nurse.name || nurse.email) : id}
                      {canAssignNurses && (
                        <button
                          onClick={() => handleRemoveNurse(id)}
                          className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Add nurse dropdown — only for authorized roles */}
            {canAssignNurses && (
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={addNurseId}
                  onChange={(e) => setAddNurseId(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select nurse…</option>
                  {unassigned.map((n) => (
                    <option key={n.userId} value={n.userId}>
                      {n.name || n.email}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  disabled={!addNurseId}
                  onClick={handleAddNurse}
                >
                  <PlusCircle className="h-3 w-3 mr-1" />
                  Add
                </Button>
                {nurseDirty && (
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs"
                    disabled={saving}
                    onClick={handleSaveNurses}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                )}
              </div>
            )}

            {nurseError && (
              <p className="text-xs text-destructive mt-1">{nurseError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Wards Section ────────────────────────────────────────────────────────────

function WardsSection({
  wards,
  canManage,
  canAssignNurses,
}: {
  wards:            WardResponse[];
  canManage:        boolean;
  canAssignNurses:  boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [addBedsFor, setAddBedsFor] = useState<WardResponse | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{wards.length} ward{wards.length !== 1 ? 's' : ''}</p>
        {canManage && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Building2 className="h-4 w-4 mr-2" />
            Create Ward
          </Button>
        )}
      </div>

      {wards.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground border rounded-lg">
          <Building2 className="mx-auto h-8 w-8 mb-3 opacity-40" />
          No wards created yet.
        </div>
      ) : (
        <div className="space-y-2">
          {wards.map((w) => (
            <WardRow
              key={w.wardId}
              ward={w}
              canManage={canManage}
              canAssignNurses={canAssignNurses}
              onAddBeds={setAddBedsFor}
            />
          ))}
        </div>
      )}

      {showCreate && <CreateWardModal onClose={() => setShowCreate(false)} />}
      {addBedsFor && <AddBedsModal ward={addBedsFor} onClose={() => setAddBedsFor(null)} />}
    </div>
  );
}

// ─── Occupancy Section ────────────────────────────────────────────────────────

function OccupancySection() {
  const { data: summary, isLoading, refetch, isFetching } = useGetOccupancySummaryQuery();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading occupancy data…</div>
      ) : !summary || summary.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground border rounded-lg">
          <BarChart3 className="mx-auto h-8 w-8 mb-3 opacity-40" />
          No ward data available.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summary.map((w) => {
            const pct = w.total > 0 ? Math.round((w.occupied / w.total) * 100) : 0;
            return (
              <div key={w.wardId} className="rounded-lg border bg-card p-4 space-y-3">
                <div>
                  <p className="font-semibold">{w.wardName}</p>
                  {w.floor && <p className="text-xs text-muted-foreground">Floor {w.floor}</p>}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Occupied</span>
                  <span className="font-medium">{w.occupied} / {w.total}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={[
                      'h-full rounded-full transition-all',
                      pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500',
                    ].join(' ')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="text-green-600">{w.available} available</span>
                  <span>{pct}% full</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type ActiveTab = 'wards' | 'occupancy';

export default function WardsPage() {
  const role = useAppSelector((s) => s.auth.profile?.role) as UserRole | undefined;
  const [activeTab, setActiveTab] = useState<ActiveTab>('wards');

  const { data: wards = [], isLoading } = useListWardsQuery();

  if (!role) return null;

  const canManage        = role === UserRole.HOSPITAL_ADMIN || role === UserRole.ADMIN;
  const canAssignNurses  = role === UserRole.HOSPITAL_ADMIN || role === UserRole.DOCTOR;
  const canViewOccupancy =
    role === UserRole.HOSPITAL_ADMIN ||
    role === UserRole.ADMIN          ||
    role === UserRole.MANAGER        ||
    role === UserRole.NURSE;

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'wards',     label: 'Wards & Beds'      },
    ...(canViewOccupancy ? [{ key: 'occupancy' as ActiveTab, label: 'Occupancy Summary' }] : []),
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Wards</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage wards, beds, and view bed occupancy across the hospital.
        </p>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={[
              'flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0',
              activeTab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading && activeTab === 'wards' ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {activeTab === 'wards'     && <WardsSection wards={wards} canManage={canManage} canAssignNurses={canAssignNurses} />}
          {activeTab === 'occupancy' && <OccupancySection />}
        </>
      )}
    </div>
  );
}
