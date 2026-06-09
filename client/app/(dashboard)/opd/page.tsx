'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  useGetOPDQueueQuery,
  useCreateOPDVisitMutation,
  useUpdateOPDVisitMutation,
  useCompleteOPDVisitMutation,
  useCancelOPDVisitMutation,
} from '@/store/api/opd.api';
import { useSearchPatientsQuery } from '@/store/api/patient.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useAppSelector } from '@/store/hooks';
import type {
  OPDVisitResponse,
  OPDVisitStatus,
  CreateOPDVisitRequest,
  UpdateOPDVisitRequest,
  CompleteOPDVisitRequest,
  PatientResponse,
} from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Stethoscope,
  Plus,
  X,
  CheckCircle,
  XCircle,
  Search,
  ClipboardList,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().substring(0, 10);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusVariant(s: OPDVisitStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (s === 'OPEN')        return 'default';
  if (s === 'IN_PROGRESS') return 'secondary';
  if (s === 'COMPLETED')   return 'outline';
  return 'destructive';
}

function statusLabel(s: OPDVisitStatus) {
  return s.replace('_', ' ');
}

const TERMINAL: ReadonlySet<OPDVisitStatus> = new Set(['COMPLETED', 'CANCELLED']);

// ─── Visit Detail Panel ───────────────────────────────────────────────────────

interface VisitPanelProps {
  visit:   OPDVisitResponse;
  onClose: () => void;
  onUpdate: (updated: OPDVisitResponse) => void;
  canEdit: boolean;    // DOCTOR, NURSE, HOSPITAL_ADMIN
  canComplete: boolean; // DOCTOR, HOSPITAL_ADMIN
  canCancel: boolean;  // RECEPTIONIST, NURSE, DOCTOR, HOSPITAL_ADMIN
  doctorName: (id: string | null) => string;
}

function VisitPanel({ visit, onClose, onUpdate, canEdit, canComplete, canCancel, doctorName }: VisitPanelProps) {
  const isTerminal = TERMINAL.has(visit.status);

  const [form, setForm] = useState<UpdateOPDVisitRequest>({
    chiefComplaint: visit.chiefComplaint,
    diagnosis:      visit.diagnosis      ?? '',
    prescription:   visit.prescription   ?? '',
    notes:          visit.notes          ?? '',
  });
  const [completeForm, setCompleteForm] = useState<CompleteOPDVisitRequest>({
    diagnosis:    visit.diagnosis    ?? '',
    prescription: visit.prescription ?? '',
    notes:        visit.notes        ?? '',
  });
  const [mode,              setMode]              = useState<'view' | 'edit' | 'complete'>('view');
  const [error,             setError]             = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [updateVisit,   { isLoading: updating  }] = useUpdateOPDVisitMutation();
  const [completeVisit, { isLoading: completing }] = useCompleteOPDVisitMutation();
  const [cancelVisit,   { isLoading: cancelling }] = useCancelOPDVisitMutation();

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const updated = await updateVisit({ visitId: visit.visitId, ...form }).unwrap();
      onUpdate(updated); // reflect changes immediately without waiting for cache refetch
      setMode('view');
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to update visit.');
    }
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!completeForm.diagnosis.trim()) {
      setError('Diagnosis is required to complete a visit.');
      return;
    }
    try {
      await completeVisit({ visitId: visit.visitId, ...completeForm }).unwrap();
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to complete visit.');
    }
  }

  async function handleCancelConfirm() {
    setError('');
    try {
      await cancelVisit(visit.visitId).unwrap();
      setShowCancelConfirm(false);
      onClose();
    } catch (err: any) {
      setShowCancelConfirm(false);
      setError(err?.data?.message ?? 'Failed to cancel visit.');
    }
  }

  const f = (label: string, val: React.ReactNode) => (
    <div className="py-2 border-b last:border-0 grid grid-cols-5 gap-2">
      <span className="col-span-2 text-sm text-muted-foreground">{label}</span>
      <span className="col-span-3 text-sm font-medium break-words">{val ?? '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="relative flex flex-col h-full w-full max-w-lg bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">#{visit.queueNumber}</span>
              <Badge variant={statusVariant(visit.status)}>{statusLabel(visit.status)}</Badge>
            </div>
            <p className="text-sm font-semibold">{visit.patientId}</p>
            <p className="text-xs text-muted-foreground">{formatDate(visit.visitDate)}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          {/* View mode */}
          {mode === 'view' && (
            <div>
              {f('Doctor',          doctorName(visit.doctorId))}
              {f('Chief Complaint', visit.chiefComplaint)}
              {f('Diagnosis',       visit.diagnosis)}
              {f('Prescription',    visit.prescription ? (
                <pre className="whitespace-pre-wrap font-sans text-sm">{visit.prescription}</pre>
              ) : null)}
              {f('Notes',           visit.notes)}
              {f('Visit ID',        <span className="font-mono text-xs">{visit.visitId}</span>)}
            </div>
          )}

          {/* Edit mode */}
          {mode === 'edit' && (
            <form id="editForm" onSubmit={handleUpdate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ep-complaint">Chief Complaint *</Label>
                <Input
                  id="ep-complaint"
                  value={form.chiefComplaint ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, chiefComplaint: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-diagnosis">Diagnosis</Label>
                <textarea
                  id="ep-diagnosis"
                  rows={3}
                  value={form.diagnosis ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-prescription">Prescription</Label>
                <textarea
                  id="ep-prescription"
                  rows={4}
                  value={form.prescription ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, prescription: e.target.value }))}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-notes">Notes</Label>
                <textarea
                  id="ep-notes"
                  rows={2}
                  value={form.notes ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
            </form>
          )}

          {/* Complete mode */}
          {mode === 'complete' && (
            <form id="completeForm" onSubmit={handleComplete} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Completing this visit is permanent. Provide the final diagnosis before confirming.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="cp-diagnosis">Diagnosis *</Label>
                <textarea
                  id="cp-diagnosis"
                  rows={3}
                  value={completeForm.diagnosis}
                  onChange={(e) => setCompleteForm((f) => ({ ...f, diagnosis: e.target.value }))}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-prescription">Prescription</Label>
                <textarea
                  id="cp-prescription"
                  rows={4}
                  value={completeForm.prescription ?? ''}
                  onChange={(e) => setCompleteForm((f) => ({ ...f, prescription: e.target.value }))}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-notes">Notes</Label>
                <textarea
                  id="cp-notes"
                  rows={2}
                  value={completeForm.notes ?? ''}
                  onChange={(e) => setCompleteForm((f) => ({ ...f, notes: e.target.value }))}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
            </form>
          )}
        </div>

        {/* Footer actions */}
        {!isTerminal && (
          <div className="shrink-0 border-t p-4 space-y-3">
            {mode === 'view' && (
              <div className="flex flex-wrap gap-2">
                {canEdit && (
                  <Button variant="outline" className="flex-1" onClick={() => setMode('edit')}>
                    Edit Visit
                  </Button>
                )}
                {canComplete && (
                  <Button className="flex-1" onClick={() => setMode('complete')}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Complete
                  </Button>
                )}
                {canCancel && (
                  <Button variant="destructive" size="sm" onClick={() => setShowCancelConfirm(true)} disabled={cancelling}>
                    <XCircle className="h-4 w-4 mr-1" />
                    {cancelling ? '…' : 'Cancel Visit'}
                  </Button>
                )}
              </div>
            )}
            {mode === 'edit' && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setMode('view')}>Back</Button>
                <Button type="submit" form="editForm" className="flex-1" disabled={updating}>
                  {updating ? 'Saving…' : 'Save Changes'}
                </Button>
              </div>
            )}
            {mode === 'complete' && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setMode('view')}>Back</Button>
                <Button type="submit" form="completeForm" className="flex-1" disabled={completing}>
                  {completing ? 'Completing…' : 'Confirm Complete'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-lg border shadow-lg w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <h2 className="font-semibold">Cancel Visit?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  This will mark the visit as <span className="font-medium text-foreground">CANCELLED</span>. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowCancelConfirm(false)} disabled={cancelling}>
                Keep Visit
              </Button>
              <Button variant="destructive" onClick={handleCancelConfirm} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Yes, Cancel Visit'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New Visit Modal ──────────────────────────────────────────────────────────

interface NewVisitModalProps {
  onClose: () => void;
}

function NewVisitModal({ onClose }: NewVisitModalProps) {
  const [patientSearch, setPatientSearch]     = useState('');
  const [debouncedPSearch, setDebouncedPSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientResponse | null>(null);
  const [form, setForm] = useState<Omit<CreateOPDVisitRequest, 'patientId'>>({
    chiefComplaint: '',
    doctorId:       '',
    visitDate:      todayISO(),
    notes:          '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPSearch(patientSearch), 400);
    return () => clearTimeout(t);
  }, [patientSearch]);

  const { data: patientData, isFetching: fetchingPatients } = useSearchPatientsQuery(
    { q: debouncedPSearch || undefined, limit: 10 },
    { skip: !debouncedPSearch },
  );
  const patients = patientData?.data ?? [];

  const { data: usersData } = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const doctors = usersData?.data ?? [];

  const [createVisit, { isLoading }] = useCreateOPDVisitMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!selectedPatient) { setError('Please select a patient.'); return; }
    if (!form.chiefComplaint.trim()) { setError('Chief complaint is required.'); return; }
    try {
      const body: CreateOPDVisitRequest = {
        patientId:      selectedPatient.patientId,
        chiefComplaint: form.chiefComplaint,
        doctorId:       form.doctorId || undefined,
        visitDate:      form.visitDate || undefined,
        notes:          form.notes    || undefined,
      };
      await createVisit(body).unwrap();
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to create visit.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">New OPD Visit</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          {/* Patient search */}
          <div className="space-y-1.5">
            <Label>Patient *</Label>
            {selectedPatient ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{selectedPatient.fullName}</p>
                  <p className="text-xs text-muted-foreground">{selectedPatient.patientId} · {selectedPatient.mobileNumber}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPatient(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search patient by name or mobile…"
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                />
                {debouncedPSearch && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg max-h-48 overflow-y-auto">
                    {fetchingPatients && (
                      <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
                    )}
                    {!fetchingPatients && patients.length === 0 && (
                      <p className="px-3 py-2 text-sm text-muted-foreground">No patients found.</p>
                    )}
                    {patients.map((p) => (
                      <button
                        key={p.patientId}
                        type="button"
                        className="flex flex-col w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                        onClick={() => { setSelectedPatient(p); setPatientSearch(''); }}
                      >
                        <span className="text-sm font-medium">{p.fullName}</span>
                        <span className="text-xs text-muted-foreground">{p.patientId} · {p.mobileNumber}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Doctor */}
          <div className="space-y-1.5">
            <Label htmlFor="nv-doctor">Assign Doctor</Label>
            <select
              id="nv-doctor"
              value={form.doctorId ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, doctorId: e.target.value }))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— Unassigned —</option>
              {doctors.map((d) => (
                <option key={d.userId} value={d.userId}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Visit date */}
          <div className="space-y-1.5">
            <Label htmlFor="nv-date">Visit Date</Label>
            <Input
              id="nv-date"
              type="date"
              value={form.visitDate ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, visitDate: e.target.value }))}
            />
          </div>

          {/* Chief complaint */}
          <div className="space-y-1.5">
            <Label htmlFor="nv-complaint">Chief Complaint *</Label>
            <textarea
              id="nv-complaint"
              rows={3}
              value={form.chiefComplaint}
              onChange={(e) => setForm((f) => ({ ...f, chiefComplaint: e.target.value }))}
              placeholder="Describe the patient's chief complaint…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              required
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="nv-notes">Notes (optional)</Label>
            <textarea
              id="nv-notes"
              rows={2}
              value={form.notes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !selectedPatient}>
              {isLoading ? 'Creating…' : 'Create Visit'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabType = 'queue' | 'new';

export default function OPDPage() {
  const role = useAppSelector((s) => s.auth.profile?.role);

  const [activeTab,    setActiveTab]    = useState<TabType>('queue');
  const [filterDate,   setFilterDate]   = useState(todayISO());
  const [filterDoctor, setFilterDoctor] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedVisit, setSelectedVisit] = useState<OPDVisitResponse | null>(null);
  const [showNewVisit,  setShowNewVisit]  = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filterSearch), 400);
    return () => clearTimeout(t);
  }, [filterSearch]);

  const { data: queue, isFetching, refetch } = useGetOPDQueueQuery({
    date:     filterDate,
    doctorId: filterDoctor    || undefined,
    search:   debouncedSearch || undefined,
  });

  const { data: usersData } = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const doctors = usersData?.data ?? [];

  const doctorName = useCallback((id: string | null) => {
    if (!id) return 'Unassigned';
    const d = doctors.find((u) => u.userId === id);
    return d ? d.name : id;
  }, [doctors]);

  const visits = queue ?? [];

  const canCreateVisit = ['RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN', 'DOCTOR'].includes(role ?? '');
  const canEdit        = ['DOCTOR', 'NURSE', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canComplete    = ['DOCTOR', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canCancel      = ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'].includes(role ?? '');

  // Queue stats
  const open      = visits.filter((v) => v.status === 'OPEN').length;
  const completed = visits.filter((v) => v.status === 'COMPLETED').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OPD</h1>
          <p className="text-sm text-muted-foreground">Outpatient department queue and visit management</p>
        </div>
        {canCreateVisit && (
          <Button onClick={() => setShowNewVisit(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Visit
          </Button>
        )}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Today</p>
            <p className="text-2xl font-bold">{visits.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Open</p>
            <p className="text-2xl font-bold text-blue-600">{open}</p>
          </CardContent>
        </Card>
        <Card className="hidden sm:block">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="text-2xl font-bold text-green-600">{completed}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
            {/* Date */}
            <div className="flex items-center gap-2">
              <Label htmlFor="filterDate" className="shrink-0 text-sm w-14 sm:w-auto">Date</Label>
              <Input
                id="filterDate"
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="flex-1 sm:w-40 sm:flex-none"
              />
            </div>

            {/* Doctor */}
            <div className="flex items-center gap-2">
              <Label htmlFor="filterDoc" className="shrink-0 text-sm w-14 sm:w-auto">Doctor</Label>
              <select
                id="filterDoc"
                value={filterDoctor}
                onChange={(e) => setFilterDoctor(e.target.value)}
                className="flex-1 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All Doctors</option>
                {doctors.map((d) => (
                  <option key={d.userId} value={d.userId}>{d.name}</option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="flex items-center gap-2">
              <Label htmlFor="filterSearch" className="shrink-0 text-sm w-14 sm:w-auto">Search</Label>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  id="filterSearch"
                  placeholder="Patient name or ID…"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="h-10 pl-8 text-sm"
                />
              </div>
            </div>

            {/* Refresh */}
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="w-fit">
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isFetching ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Loading queue…
            </div>
          ) : visits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
              <ClipboardList className="h-8 w-8 opacity-30" />
              No visits for the selected filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground w-12">#</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Chief Complaint</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Doctor</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr
                      key={v.visitId}
                      className={cn(
                        'border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/30',
                        TERMINAL.has(v.status) && 'opacity-60',
                      )}
                      onClick={() => setSelectedVisit(v)}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v.queueNumber}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{v.fullName ?? v.patientId}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.patientId} · {formatDate(v.visitDate)}
                        </p>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground max-w-xs truncate">
                        {v.chiefComplaint}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">
                        {doctorName(v.doctorId)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(v.status)}>{statusLabel(v.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-xs text-primary hover:underline">
                          {TERMINAL.has(v.status) ? 'View' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visit detail panel */}
      {selectedVisit && (
        <VisitPanel
          visit={selectedVisit}
          onClose={() => setSelectedVisit(null)}
          onUpdate={(updated) => setSelectedVisit(updated)}
          canEdit={canEdit}
          canComplete={canComplete}
          canCancel={canCancel}
          doctorName={doctorName}
        />
      )}

      {/* New visit modal */}
      {showNewVisit && (
        <NewVisitModal onClose={() => setShowNewVisit(false)} />
      )}
    </div>
  );
}
