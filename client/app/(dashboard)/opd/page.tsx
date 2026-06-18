'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  useGetOPDQueueQuery,
  useCreateOPDVisitMutation,
  useUpdateOPDVisitMutation,
  useCompleteOPDVisitMutation,
  useCancelOPDVisitMutation,
} from '@/store/api/opd.api';
import { useCreateManualPaymentMutation, useListPaymentsQuery } from '@/store/api/payment.api';
import { useSearchPatientsQuery } from '@/store/api/patient.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useListDepartmentsQuery } from '@/store/api/department.api';
import { useAppSelector } from '@/store/hooks';
import type {
  OPDVisitResponse,
  OPDVisitStatus,
  CreateOPDVisitRequest,
  UpdateOPDVisitRequest,
  CompleteOPDVisitRequest,
  PatientResponse,
  UserResponse,
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
  doctorNames: (ids: string[]) => string;
  allDoctors:  UserResponse[];
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CHEQUE: 'Cheque',
};

function VisitPanel({ visit, onClose, onUpdate, canEdit, canComplete, canCancel, doctorNames, allDoctors }: VisitPanelProps) {
  const isTerminal = TERMINAL.has(visit.status);

  const visitDateStr = new Date(visit.visitDate).toISOString().substring(0, 10);
  const { data: paymentData } = useListPaymentsQuery({
    patientId: visit.patientId,
    dateFrom:  visitDateStr,
    dateTo:    visitDateStr,
    limit:     10,
  });
  const visitPayment = paymentData?.data?.[0] ?? null;

  const [selectedDepartmentId, setSelectedDepartmentId] = useState(visit.departmentId ?? '');

  const { data: departmentsData } = useListDepartmentsQuery();
  const { data: editUsersData }   = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const editAllDoctors = editUsersData?.data ?? [];
  const editDepartments = departmentsData ?? [];
  const editDoctors = selectedDepartmentId
    ? editAllDoctors.filter((d) => d.departmentIds.includes(selectedDepartmentId))
    : editAllDoctors;

  const [editDoctorIds,    setEditDoctorIds]    = useState<string[]>(visit.doctorIds ?? []);
  const [editAddDoctorId,  setEditAddDoctorId]  = useState('');

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
      // Strip empty strings from optional min(1) fields so the backend schema doesn't reject them
      const body: UpdateOPDVisitRequest = {
        ...(form.chiefComplaint?.trim() ? { chiefComplaint: form.chiefComplaint.trim() } : {}),
        doctorIds:    editDoctorIds,
        ...(form.diagnosis?.trim()      ? { diagnosis: form.diagnosis.trim() }           : {}),
        ...(form.prescription != null   ? { prescription: form.prescription }            : {}),
        ...(form.notes        != null   ? { notes: form.notes }                          : {}),
      };
      const updated = await updateVisit({ visitId: visit.visitId, ...body }).unwrap();
      onUpdate(updated);
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
            <p className="text-sm font-semibold">{visit.fullName ?? visit.patientId}</p>
            <p className="text-xs text-muted-foreground">{visit.patientId} · {formatDate(visit.visitDate)}</p>
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
              {f('Doctor(s)',        doctorNames(visit.doctorIds ?? []))}
              {f('Chief Complaint', visit.chiefComplaint)}
              {f('Diagnosis',       visit.diagnosis)}
              {f('Prescription',    visit.prescription ? (
                <pre className="whitespace-pre-wrap font-sans text-sm">{visit.prescription}</pre>
              ) : null)}
              {f('Notes',           visit.notes)}
              {f('Visit ID',        <span className="font-mono text-xs">{visit.visitId}</span>)}
              <div className="mt-3 pt-3 border-t space-y-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Payment</p>
                {visitPayment ? (
                  <>
                    {f('Amount',       <span className="font-semibold">₹{visitPayment.amount.toLocaleString('en-IN')}</span>)}
                    {f('Payment Mode', <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">{PAYMENT_METHOD_LABELS[visitPayment.paymentMethod] ?? visitPayment.paymentMethod}</span>)}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground py-1">No payment on record for this visit.</p>
                )}
              </div>
            </div>
          )}

          {/* Edit mode */}
          {mode === 'edit' && (
            <form id="editForm" onSubmit={handleUpdate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ep-dept">Department</Label>
                <select
                  id="ep-dept"
                  value={selectedDepartmentId}
                  onChange={(e) => { setSelectedDepartmentId(e.target.value); setEditAddDoctorId(''); }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— All Departments —</option>
                  {editDepartments.map((dept) => (
                    <option key={dept.departmentId} value={dept.departmentId}>{dept.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Assigned Doctors</Label>
                {editDoctorIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {editDoctorIds.map((id) => {
                      const d = allDoctors.find((u) => u.userId === id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                          {d?.name ?? id}
                          <button type="button" onClick={() => setEditDoctorIds((prev) => prev.filter((x) => x !== id))} className="ml-0.5 hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <select
                    value={editAddDoctorId}
                    onChange={(e) => setEditAddDoctorId(e.target.value)}
                    className="flex-1 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">— Add doctor —</option>
                    {editDoctors.filter((d) => !editDoctorIds.includes(d.userId)).map((d) => (
                      <option key={d.userId} value={d.userId}>{d.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!editAddDoctorId}
                    onClick={() => {
                      if (editAddDoctorId && !editDoctorIds.includes(editAddDoctorId)) {
                        setEditDoctorIds((prev) => [...prev, editAddDoctorId]);
                        setEditAddDoctorId('');
                      }
                    }}
                    className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
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

const PAYMENT_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI',  label: 'UPI'  },
  { value: 'CARD', label: 'Card' },
] as const;

type OPDPaymentMode = 'CASH' | 'UPI' | 'CARD';

function NewVisitModal({ onClose }: NewVisitModalProps) {
  const [patientSearch, setPatientSearch]     = useState('');
  const [debouncedPSearch, setDebouncedPSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientResponse | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [selectedDoctorIds,    setSelectedDoctorIds]    = useState<string[]>([]);
  const [addDoctorId,          setAddDoctorId]          = useState('');
  const [form, setForm] = useState<Omit<CreateOPDVisitRequest, 'patientId' | 'doctorIds'>>({
    chiefComplaint: '',
    visitDate:      todayISO(),
    notes:          '',
  });
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode,   setPaymentMode]   = useState<OPDPaymentMode | ''>('');
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

  const { data: departmentsData } = useListDepartmentsQuery();
  const departments = departmentsData ?? [];

  const { data: usersData } = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const allDoctors = usersData?.data ?? [];
  const doctors = selectedDepartmentId
    ? allDoctors.filter((d) => d.departmentIds.includes(selectedDepartmentId))
    : allDoctors;

  const [createVisit,         { isLoading: creatingVisit }]   = useCreateOPDVisitMutation();
  const [createManualPayment, { isLoading: creatingPayment }] = useCreateManualPaymentMutation();
  const isLoading = creatingVisit || creatingPayment;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!selectedPatient) { setError('Please select a patient.'); return; }
    if (!form.chiefComplaint.trim()) { setError('Chief complaint is required.'); return; }
    const amount = parseFloat(paymentAmount);
    if (!paymentAmount || isNaN(amount) || amount <= 0) {
      setError('Payment amount is required and must be greater than zero.');
      return;
    }
    if (!paymentMode) { setError('Payment mode is required.'); return; }
    try {
      const body: CreateOPDVisitRequest = {
        patientId:      selectedPatient.patientId,
        chiefComplaint: form.chiefComplaint,
        doctorIds:      selectedDoctorIds.length ? selectedDoctorIds : undefined,
        visitDate:      form.visitDate || undefined,
        notes:          form.notes    || undefined,
      };
      const visit = await createVisit(body).unwrap();
      await createManualPayment({
        patientId:     selectedPatient.patientId,
        amount,
        paymentMethod: paymentMode,
        description:   `OPD Consultation – Visit #${visit.queueNumber}`,
      }).unwrap();
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

          {/* Department */}
          <div className="space-y-1.5">
            <Label htmlFor="nv-dept">Department</Label>
            <select
              id="nv-dept"
              value={selectedDepartmentId}
              onChange={(e) => { setSelectedDepartmentId(e.target.value); setAddDoctorId(''); }}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— All Departments —</option>
              {departments.map((dept) => (
                <option key={dept.departmentId} value={dept.departmentId}>{dept.name}</option>
              ))}
            </select>
          </div>

          {/* Doctors */}
          <div className="space-y-1.5">
            <Label>Assign Doctors</Label>
            {selectedDoctorIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedDoctorIds.map((id) => {
                  const d = allDoctors.find((u) => u.userId === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {d?.name ?? id}
                      <button type="button" onClick={() => setSelectedDoctorIds((prev) => prev.filter((x) => x !== id))} className="ml-0.5 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <select
                value={addDoctorId}
                onChange={(e) => setAddDoctorId(e.target.value)}
                className="flex-1 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Add doctor —</option>
                {doctors.filter((d) => !selectedDoctorIds.includes(d.userId)).map((d) => (
                  <option key={d.userId} value={d.userId}>{d.name}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!addDoctorId}
                onClick={() => {
                  if (addDoctorId && !selectedDoctorIds.includes(addDoctorId)) {
                    setSelectedDoctorIds((prev) => [...prev, addDoctorId]);
                    setAddDoctorId('');
                  }
                }}
                className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                Add
              </button>
            </div>
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

          {/* Payment */}
          <div className="rounded-md border border-input p-4 space-y-3 bg-muted/30">
            <p className="text-sm font-medium">Payment *</p>
            <div className="space-y-1.5">
              <Label htmlFor="nv-pay-amount">Amount (₹) *</Label>
              <Input
                id="nv-pay-amount"
                type="number"
                min="1"
                step="0.01"
                placeholder="0.00"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Mode *</Label>
              <div className="flex gap-2">
                {PAYMENT_MODES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPaymentMode(value)}
                    className={cn(
                      'flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                      paymentMode === value
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background hover:bg-muted',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
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

  const doctorNames = useCallback((ids: string[]) => {
    if (!ids?.length) return 'Unassigned';
    return ids.map((id) => {
      const d = doctors.find((u) => u.userId === id);
      return d ? d.name : id;
    }).join(', ');
  }, [doctors]);

  const visits = queue ?? [];

  const canCreateVisit = ['RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN', 'DOCTOR'].includes(role ?? '');
  const canEdit        = ['DOCTOR', 'NURSE', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canComplete    = ['DOCTOR', 'NURSE', 'HOSPITAL_ADMIN'].includes(role ?? '');
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
                        {doctorNames(v.doctorIds ?? [])}
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
          doctorNames={doctorNames}
          allDoctors={doctors}
        />
      )}

      {/* New visit modal */}
      {showNewVisit && (
        <NewVisitModal onClose={() => setShowNewVisit(false)} />
      )}
    </div>
  );
}
