'use client';

import { useState, useEffect, useRef } from 'react';
import {
  useListWardsQuery,
  useCreateWardMutation,
  useListBedsQuery,
  useAddBedsMutation,
  useListAdmissionsQuery,
  useCreateAdmissionMutation,
  useAddProgressNoteMutation,
  useDischargePatientMutation,
  useGetOccupancySummaryQuery,
} from '@/store/api/ipd.api';
import { useListUsersQuery }    from '@/store/api/user.api';
import { useSearchPatientsQuery } from '@/store/api/patient.api';
import { useAppSelector }       from '@/store/hooks';
import { UserRole }             from '@/store/types';
import type { AdmissionResponse, WardResponse, PatientResponse, UserResponse } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Badge }  from '@/components/ui/badge';
import {
  Bed,
  Building2,
  PlusCircle,
  RefreshCw,
  X,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  BarChart3,
  Search,
  AlertTriangle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'admissions' | 'wards' | 'occupancy';

// ─── PatientSearch ────────────────────────────────────────────────────────────
// Live search typeahead — type name or mobile, pick a patient from the dropdown.

interface PatientSearchProps {
  value:    PatientResponse | null;
  onChange: (p: PatientResponse | null) => void;
}

function PatientSearch({ value, onChange }: PatientSearchProps) {
  const [query,    setQuery]    = useState('');
  const [open,     setOpen]     = useState(false);
  const containerRef            = useRef<HTMLDivElement>(null);

  // Debounce — only fire after user stops typing 300 ms
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isFetching } = useSearchPatientsQuery(
    { q: debouncedQ, limit: 8 },
    { skip: debouncedQ.trim().length < 2 },
  );

  const results = data?.data ?? [];

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <div>
          <p className="font-medium">{value.fullName}</p>
          <p className="text-xs text-muted-foreground font-mono">{value.patientId} · {value.mobileNumber}</p>
        </div>
        <button
          type="button"
          onClick={() => { onChange(null); setQuery(''); }}
          className="text-muted-foreground hover:text-foreground transition-colors ml-3 shrink-0"
          aria-label="Clear patient selection"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by name or mobile…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="pl-9"
        />
      </div>

      {open && (query.trim().length >= 2) && (
        <div className="absolute z-10 w-full mt-1 rounded-md border bg-background shadow-lg max-h-60 overflow-y-auto">
          {isFetching ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No patients found.</div>
          ) : (
            results.map((p) => (
              <button
                key={p.patientId}
                type="button"
                className="w-full flex flex-col items-start px-3 py-2 text-sm hover:bg-muted/60 transition-colors text-left"
                onMouseDown={(e) => e.preventDefault()} // prevent input blur before click
                onClick={() => { onChange(p); setOpen(false); setQuery(''); }}
              >
                <span className="font-medium">{p.fullName}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {p.patientId} · {p.mobileNumber}
                  {p.bloodGroup ? ` · ${p.bloodGroup}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── DoctorSearch ────────────────────────────────────────────────────────────
// Client-side search over a pre-fetched doctor list (users API has no q param).

interface DoctorSearchProps {
  doctors:  UserResponse[];
  value:    UserResponse | null;
  onChange: (d: UserResponse | null) => void;
}

function DoctorSearch({ doctors, value, onChange }: DoctorSearchProps) {
  const [query,        setQuery]        = useState('');
  const [open,         setOpen]         = useState(false);
  const containerRef                    = useRef<HTMLDivElement>(null);

  const filtered = query.trim().length === 0
    ? doctors
    : doctors.filter((d) => {
        const q = query.toLowerCase();
        return d.name.toLowerCase().includes(q);
      });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (value) {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-2.5 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{value.name || value.email}</span>
          <button
            type="button"
            onClick={() => { onChange(null); setQuery(''); }}
            className="text-muted-foreground hover:text-foreground transition-colors ml-3 shrink-0"
            aria-label="Clear doctor selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-mono">{value.userId.slice(0, 12)}…</span>
          <span>·</span>
          <span>{value.email}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by doctor name…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="pl-9"
        />
      </div>

      {open && (
        <div className="absolute z-10 w-full mt-1 rounded-md border bg-background shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No doctors found.</div>
          ) : (
            filtered.map((d) => (
              <button
                key={d.userId}
                type="button"
                className="w-full flex flex-col items-start px-3 py-2.5 text-sm hover:bg-muted/60 transition-colors text-left border-b last:border-0"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(d); setOpen(false); setQuery(''); }}
              >
                <span className="font-medium">{d.name || 'Unnamed doctor'}</span>
                <span className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span className="font-mono">{d.userId.slice(0, 12)}…</span>
                  <span>·</span>
                  <span>{d.email}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── New Admission Modal ──────────────────────────────────────────────────────

interface NewAdmissionModalProps {
  wards:   WardResponse[];
  onClose: () => void;
}

function NewAdmissionModal({ wards, onClose }: NewAdmissionModalProps) {
  const [patient, setPatient] = useState<PatientResponse | null>(null);
  const [wardId,  setWardId]  = useState('');
  const [bedId,   setBedId]   = useState('');
  const [doctor,  setDoctor]  = useState<UserResponse | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  const { data: bedsData } = useListBedsQuery(wardId, { skip: !wardId });
  const { data: doctorsPage } = useListUsersQuery({ role: UserRole.DOCTOR, isActive: true, limit: 100 });

  const availableBeds = bedsData?.filter((b) => !b.isOccupied) ?? [];
  const allBeds       = bedsData ?? [];
  const doctorList    = doctorsPage?.data ?? [];

  const [createAdmission, { isLoading }] = useCreateAdmissionMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!patient) { setError('Select a patient.'); return; }
    if (!wardId)  { setError('Select a ward.'); return; }
    if (!bedId)   { setError('Select a bed.'); return; }
    if (!doctor)  { setError('Select a doctor.'); return; }
    try {
      await createAdmission({
        patientId:        patient.patientId,
        wardId,
        bedId,
        assignedDoctorId: doctor.userId,
      }).unwrap();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to create admission.');
    }
  }

  const selectedWard = wards.find((w) => w.wardId === wardId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b">
          <h2 className="text-lg font-semibold">New Admission</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">

          {/* Step 1 — Patient */}
          <div className="space-y-2">
            <Label>Patient</Label>
            <PatientSearch value={patient} onChange={setPatient} />
          </div>

          {/* Step 2 — Ward */}
          <div className="space-y-2">
            <Label htmlFor="na-ward">Ward</Label>
            <select
              id="na-ward"
              value={wardId}
              onChange={(e) => { setWardId(e.target.value); setBedId(''); }}
              required
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Select ward…</option>
              {wards.map((w) => (
                <option key={w.wardId} value={w.wardId}>
                  {w.name}{w.floor ? ` — Floor ${w.floor}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Step 3 — Bed selector */}
          {wardId && (
            <div className="space-y-2">
              <Label>Bed</Label>
              {allBeds.length === 0 ? (
                <p className="text-sm text-muted-foreground">No beds in this ward yet.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 rounded-md border bg-muted/20 p-3">
                    {allBeds.map((b) => {
                      const isSelected = bedId === b.bedId;
                      const isAvailable = !b.isOccupied;
                      return (
                        <button
                          key={b.bedId}
                          type="button"
                          disabled={!isAvailable}
                          onClick={() => setBedId(b.bedId)}
                          className={[
                            'inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : isAvailable
                                ? 'border-green-500/50 bg-green-50 text-green-700 hover:bg-green-100'
                                : 'border-muted bg-muted/40 text-muted-foreground opacity-50 cursor-not-allowed',
                          ].join(' ')}
                          title={b.isOccupied ? 'Occupied' : 'Available'}
                        >
                          <Bed className="h-3 w-3" />
                          {b.bedNumber}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {availableBeds.length} of {allBeds.length} beds available in {selectedWard?.name}
                  </p>
                  {availableBeds.length === 0 && (
                    <p className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      All beds are occupied in this ward.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 4 — Doctor */}
          <div className="space-y-2">
            <Label>Assigned Doctor</Label>
            <DoctorSearch doctors={doctorList} value={doctor} onChange={setDoctor} />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !patient || !wardId || !bedId || !doctor}
            >
              {isLoading ? 'Admitting…' : 'Admit Patient'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── View / Add Progress Notes Modal ─────────────────────────────────────────

interface NotesModalProps {
  admission:  AdmissionResponse;
  canAdd:     boolean;
  doctorMap:  Record<string, string>;
  onClose:    () => void;
}

function NotesModal({ admission, canAdd, doctorMap, onClose }: NotesModalProps) {
  const [note,       setNote]       = useState('');
  const [error,      setError]      = useState<string | null>(null);
  // Local copy so the list updates instantly after a save — no reload needed
  const [localNotes, setLocalNotes] = useState(admission.progressNotes);
  const [addNote, { isLoading }]    = useAddProgressNoteMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const updated = await addNote({ admissionId: admission.admissionId, note: note.trim() }).unwrap();
      setLocalNotes(updated.progressNotes);
      setNote('');
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to add note.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b shrink-0">
          <div>
            <h2 className="text-lg font-semibold">Progress Notes</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ward <span className="text-foreground font-medium">{admission.wardName}</span> · Bed {admission.bedNumber}
              {' '}· <span className="font-mono">{admission.patientId}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Notes history — uses localNotes so it updates without reload */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {localNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No progress notes yet.</p>
          ) : (
            [...localNotes].reverse().map((n) => (
              <div key={n.noteId} className="rounded-md border bg-muted/30 px-4 py-3 space-y-1">
                <p className="text-xs text-muted-foreground">
                  {new Date(n.timestamp).toLocaleString()}
                  {' · '}
                  <span className="font-medium text-foreground">
                    {doctorMap[n.doctorId] ?? `Dr. ${n.doctorId.slice(0, 8)}…`}
                  </span>
                </p>
                <p className="text-sm whitespace-pre-wrap">{n.note}</p>
              </div>
            ))
          )}
        </div>

        {/* Add note — doctors only */}
        {canAdd && admission.status === 'ADMITTED' && (
          <form onSubmit={handleSubmit} className="border-t px-6 py-4 space-y-3 shrink-0">
            <Label htmlFor="pn-note">New Note</Label>
            <textarea
              id="pn-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={5000}
              rows={3}
              placeholder="Clinical observations, treatment changes…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{note.length}/5000</span>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" size="sm" disabled={isLoading || !note.trim()}>
                {isLoading ? 'Saving…' : 'Add Note'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Discharge Confirmation ────────────────────────────────────────────────────

interface DischargeConfirmProps {
  admission: AdmissionResponse;
  onConfirm: () => void;
  onCancel:  () => void;
  loading:   boolean;
}

function DischargeConfirm({ admission, onConfirm, onCancel, loading }: DischargeConfirmProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Discharge Patient?</h2>
            <p className="text-sm text-muted-foreground mt-1">
              This will release Bed <span className="font-medium text-foreground">{admission.bedNumber}</span> in{' '}
              <span className="font-medium text-foreground">{admission.wardName}</span>. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Discharging…' : 'Confirm Discharge'}
          </Button>
        </div>
      </div>
    </div>
  );
}

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

interface CreateWardModalProps {
  onClose: () => void;
}

function CreateWardModal({ onClose }: CreateWardModalProps) {
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

// ─── Admissions Tab ───────────────────────────────────────────────────────────

function AdmissionsTab({ role, wards }: { role: UserRole; wards: WardResponse[] }) {
  const [filterWard,   setFilterWard]   = useState('');
  const [filterStatus, setFilterStatus] = useState<'ADMITTED' | 'DISCHARGED'>('ADMITTED');
  const [searchQ,      setSearchQ]      = useState('');
  const [page,         setPage]         = useState(1);
  const [showNew,      setShowNew]      = useState(false);
  const [notesFor,     setNotesFor]     = useState<AdmissionResponse | null>(null);
  const [dischargeFor, setDischargeFor] = useState<AdmissionResponse | null>(null);

  const { data, isLoading, isFetching, refetch } = useListAdmissionsQuery({
    status: filterStatus,
    page,
    limit: 20,
    ...(filterWard ? { wardId: filterWard } : {}),
  });

  // Fetch all doctors once so we can resolve names in the table and notes modal
  const { data: doctorsPage } = useListUsersQuery({ role: UserRole.DOCTOR, isActive: true, limit: 100 });
  const doctorMap: Record<string, string> = {};
  for (const d of doctorsPage?.data ?? []) {
    doctorMap[d.userId] = d.name || d.email;
  }

  const [discharge, { isLoading: discharging }] = useDischargePatientMutation();

  const canAdmit =
    role === UserRole.RECEPTIONIST ||
    role === UserRole.HOSPITAL_ADMIN ||
    role === UserRole.ADMIN;
  const canProgress  = role === UserRole.DOCTOR;
  const canDischarge = role === UserRole.DOCTOR;

  // Client-side filter by patientId prefix
  const allAdmissions = data?.data ?? [];
  const admissions    = searchQ.trim()
    ? allAdmissions.filter((a) =>
        a.patientId.toLowerCase().includes(searchQ.toLowerCase()),
      )
    : allAdmissions;

  const total      = data?.total      ?? 0;
  const totalPages = Math.ceil(total / 20);

  async function handleDischargeConfirm() {
    if (!dischargeFor) return;
    await discharge(dischargeFor.admissionId);
    setDischargeFor(null);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Patient ID search */}
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Filter by patient ID…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="h-9 pl-8 text-sm w-full"
            />
          </div>

          {/* Ward filter */}
          <select
            value={filterWard}
            onChange={(e) => { setFilterWard(e.target.value); setPage(1); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All wards</option>
            {wards.map((w) => (
              <option key={w.wardId} value={w.wardId}>{w.name}</option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value as 'ADMITTED' | 'DISCHARGED'); setPage(1); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="ADMITTED">Admitted</option>
            <option value="DISCHARGED">Discharged</option>
          </select>

          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {canAdmit && (
          <Button size="sm" onClick={() => setShowNew(true)} className="shrink-0">
            <PlusCircle className="h-4 w-4 mr-2" />
            New Admission
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center text-sm text-muted-foreground">Loading admissions…</div>
        ) : admissions.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            <Bed className="mx-auto h-8 w-8 mb-3 opacity-40" />
            {searchQ ? 'No admissions match your search.' : 'No admissions found.'}
          </div>
        ) : (
          <>
            {/* Mobile card list — below md */}
            <div className="divide-y md:hidden">
              {admissions.map((a) => (
                <div key={a.admissionId} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {(a as AdmissionResponse & { fullName?: string | null }).fullName ?? a.patientId}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground mt-0.5">{a.patientId}</p>
                      <p className="font-medium mt-0.5">{a.wardName} · Bed {a.bedNumber}</p>
                      <p className="text-xs text-muted-foreground">{doctorMap[a.assignedDoctorId] ?? '—'}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <Badge variant={a.status === 'ADMITTED' ? 'default' : 'secondary'} className="text-xs">
                        {a.status}
                      </Badge>
                      {a.progressNotes.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {a.progressNotes.length} note{a.progressNotes.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    In: {new Date(a.admissionDate).toLocaleDateString()}
                    {a.dischargeDate ? (
                      <span className="ml-3 text-green-600">Out: {new Date(a.dischargeDate).toLocaleDateString()}</span>
                    ) : (
                      <span className="ml-3 text-amber-600">
                        {Math.floor((Date.now() - new Date(a.admissionDate).getTime()) / 86400000)}d stay
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setNotesFor(a)}>
                      Notes
                      {a.progressNotes.length > 0 && (
                        <span className="ml-1 rounded-full bg-primary/10 text-primary px-1.5 text-[10px] font-semibold">
                          {a.progressNotes.length}
                        </span>
                      )}
                    </Button>
                    {canDischarge && a.status === 'ADMITTED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setDischargeFor(a)}
                      >
                        Discharge
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table — md and above */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ward / Bed</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Doctor</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Dates</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {admissions.map((a) => (
                    <tr key={a.admissionId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {(a as AdmissionResponse & { fullName?: string | null }).fullName ?? a.patientId}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground mt-0.5">{a.patientId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{a.wardName}</div>
                        <div className="text-xs text-muted-foreground">Bed {a.bedNumber}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium">{doctorMap[a.assignedDoctorId] ?? '—'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{a.assignedDoctorId.slice(0, 8)}…</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={a.status === 'ADMITTED' ? 'default' : 'secondary'}>
                          {a.status}
                        </Badge>
                        {a.progressNotes.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {a.progressNotes.length} note{a.progressNotes.length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <div>In: {new Date(a.admissionDate).toLocaleDateString()}</div>
                        {a.dischargeDate
                          ? <div className="text-green-600">Out: {new Date(a.dischargeDate).toLocaleDateString()}</div>
                          : <div className="text-amber-600">
                              {Math.floor((Date.now() - new Date(a.admissionDate).getTime()) / 86400000)}d stay
                            </div>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setNotesFor(a)}
                          >
                            Notes
                            {a.progressNotes.length > 0 && (
                              <span className="ml-1 rounded-full bg-primary/10 text-primary px-1.5 text-[10px] font-semibold">
                                {a.progressNotes.length}
                              </span>
                            )}
                          </Button>
                          {canDischarge && a.status === 'ADMITTED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                              onClick={() => setDischargeFor(a)}
                            >
                              Discharge
                            </Button>
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
      {totalPages > 1 && !searchQ && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
          <span>Page {page} of {totalPages} — {total} admissions</span>
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

      {showNew  && <NewAdmissionModal wards={wards} onClose={() => setShowNew(false)} />}
      {notesFor && <NotesModal admission={notesFor} canAdd={canProgress} doctorMap={doctorMap} onClose={() => setNotesFor(null)} />}
      {dischargeFor && (
        <DischargeConfirm
          admission={dischargeFor}
          onConfirm={handleDischargeConfirm}
          onCancel={() => setDischargeFor(null)}
          loading={discharging}
        />
      )}
    </div>
  );
}

// ─── Ward Row (expandable) ────────────────────────────────────────────────────

interface WardRowProps {
  ward:      WardResponse;
  canManage: boolean;
  onAddBeds: (ward: WardResponse) => void;
}

function WardRow({ ward, canManage, onAddBeds }: WardRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: beds, isLoading } = useListBedsQuery(ward.wardId, { skip: !expanded });

  const total    = beds?.length ?? 0;
  const occupied = beds?.filter((b) => b.isOccupied).length ?? 0;

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium">{ward.name}</span>
          {ward.floor && <span className="text-xs text-muted-foreground">Floor {ward.floor}</span>}
        </div>
        <div className="flex items-center gap-3">
          {expanded && !isLoading && (
            <span className="text-xs text-muted-foreground">{occupied}/{total} occupied</span>
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
        <div className="border-t px-4 py-3">
          {isLoading ? (
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
      )}
    </div>
  );
}

// ─── Wards Tab ────────────────────────────────────────────────────────────────

function WardsTab({ wards, canManage }: { wards: WardResponse[]; canManage: boolean }) {
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
            <WardRow key={w.wardId} ward={w} canManage={canManage} onAddBeds={setAddBedsFor} />
          ))}
        </div>
      )}

      {showCreate && <CreateWardModal onClose={() => setShowCreate(false)} />}
      {addBedsFor && <AddBedsModal ward={addBedsFor} onClose={() => setAddBedsFor(null)} />}
    </div>
  );
}

// ─── Occupancy Tab ────────────────────────────────────────────────────────────

function OccupancyTab() {
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

export default function IPDPage() {
  const role = useAppSelector((s) => s.auth.profile?.role) as UserRole | undefined;
  const [activeTab, setActiveTab] = useState<Tab>('admissions');

  const { data: wards = [], isLoading: wardsLoading } = useListWardsQuery();

  const canManageWards  = role === UserRole.HOSPITAL_ADMIN;
  const canViewOccupancy = role === UserRole.HOSPITAL_ADMIN || role === UserRole.MANAGER;

  const tabs = [
    { key: 'admissions' as Tab, label: 'Admissions',        Icon: ClipboardList },
    { key: 'wards'      as Tab, label: 'Wards & Beds',      Icon: Building2     },
    ...(canViewOccupancy
      ? [{ key: 'occupancy' as Tab, label: 'Occupancy Summary', Icon: BarChart3 }]
      : []),
  ];

  if (!role) return null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">IPD — In-Patient</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage admissions, ward beds, progress notes, and occupancy.
        </p>
      </div>

      {/* Tabs — scrollable on narrow screens */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map(({ key, label, Icon }) => (
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
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {wardsLoading && activeTab !== 'occupancy' ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {activeTab === 'admissions' && <AdmissionsTab role={role} wards={wards} />}
          {activeTab === 'wards'      && <WardsTab wards={wards} canManage={canManageWards} />}
          {activeTab === 'occupancy'  && <OccupancyTab />}
        </>
      )}
    </div>
  );
}
