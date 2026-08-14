'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useGetOPDQueueQuery,
  useCreateOPDVisitMutation,
  useUpdateOPDVisitMutation,
  useStartOPDConsultationMutation,
  useCompleteOPDVisitMutation,
  useCancelOPDVisitMutation,
  useGetOPDPaymentValidityQuery,
} from '@/store/api/opd.api';
import { useCreateManualPaymentMutation, useListPaymentsQuery } from '@/store/api/payment.api';
import { useSearchPatientsQuery } from '@/store/api/patient.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useListDepartmentsQuery } from '@/store/api/department.api';
import { useListWardsQuery } from '@/store/api/ipd.api';
import { useAppSelector } from '@/store/hooks';
import { PatientFormModal } from '@/components/patients/patient-form-modal';
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
import { CharCounter } from '@/components/ui/char-counter';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { RichTextDisplay } from '@/components/ui/rich-text-display';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { opdStatusLabel, opdStatusVariant } from '@/lib/opd-status';
import {
  Stethoscope,
  Plus,
  X,
  CheckCircle,
  XCircle,
  PlayCircle,
  Search,
  ClipboardList,
  RefreshCw,
  UserPlus,
  Printer,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().substring(0, 10);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatINR(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
}

// The backend returns 409 with a ready-to-display message when the same patient
// already has an active appointment with the selected doctor/date; fall back to
// that exact wording if the response body is ever missing a message.
function opdErrorMessage(err: any, fallback: string): string {
  if (err?.status === 409) {
    return (
      err?.data?.message ??
      'An appointment already exists for this patient with the selected doctor, date, and time slot.'
    );
  }
  return err?.data?.message ?? fallback;
}

const TERMINAL: ReadonlySet<OPDVisitStatus> = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW']);

// ─── Visit Detail Panel ───────────────────────────────────────────────────────

interface VisitPanelProps {
  visit:   OPDVisitResponse;
  onClose: () => void;
  onUpdate: (updated: OPDVisitResponse) => void;
  canEdit: boolean;    // DOCTOR, HOSPITAL_ADMIN
  canComplete: boolean; // DOCTOR, HOSPITAL_ADMIN
  canCancel: boolean;  // RECEPTIONIST, DOCTOR, HOSPITAL_ADMIN
  canViewPayment: boolean; // MANAGER, FINANCE_MANAGER, HOSPITAL_ADMIN, RECEPTIONIST — mirrors GET /api/payments requireRole
  doctorNames: (ids: string[]) => string;
  allDoctors:  UserResponse[];
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CHEQUE: 'Cheque',
};

// Roles permitted to view payment details, matching the backend's GET /api/payments requireRole list.
const PAYMENT_VIEW_ROLES = ['MANAGER', 'FINANCE_MANAGER', 'HOSPITAL_ADMIN', 'RECEPTIONIST'];

function VisitPanel({ visit, onClose, onUpdate, canEdit, canComplete, canCancel, canViewPayment, doctorNames, allDoctors }: VisitPanelProps) {
  const isTerminal = TERMINAL.has(visit.status);

  // Look up the payment linked directly to this visit (referenceId) rather than
  // guessing from patientId + calendar date — a patient can have other payments
  // (registration fee, another same-day visit) on the same date, which would
  // otherwise surface the wrong amount here. Skipped entirely for roles without
  // payment visibility so no payment data is fetched for them.
  const { data: paymentData } = useListPaymentsQuery({
    referenceType: 'OPD_VISIT',
    referenceId:   visit.visitId,
    limit:         1,
  }, { skip: !canViewPayment });
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
  const [startConsultation, { isLoading: starting }] = useStartOPDConsultationMutation();
  const [completeVisit, { isLoading: completing }] = useCompleteOPDVisitMutation();
  const [cancelVisit,   { isLoading: cancelling }] = useCancelOPDVisitMutation();

  // Waiting → In Consultation. Keeps the panel open on the updated visit so the
  // doctor can go straight on to Complete.
  async function handleStartConsultation() {
    if (starting) return;
    setError('');
    try {
      const updated = await startConsultation(visit.visitId).unwrap();
      onUpdate(updated);
    } catch (err: any) {
      setError(opdErrorMessage(err, 'Failed to start the consultation.'));
    }
  }

  // Synchronous guard against a double-click firing two update requests before
  // the mutation's isLoading flag has propagated through a render.
  const updatingRef = useRef(false);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (updating || updatingRef.current) return;
    setError('');
    if ((form.diagnosis ?? '').trim().length > 2000) {
      setError('Diagnosis cannot exceed 2000 characters.');
      return;
    }
    if ((form.prescription ?? '').length > 5000) {
      setError('Prescription cannot exceed 5000 characters.');
      return;
    }
    updatingRef.current = true;
    try {
      // Strip empty strings from optional min(1) fields so the backend schema doesn't reject them
      const body: UpdateOPDVisitRequest = {
        doctorIds:    editDoctorIds,
        ...(form.diagnosis?.trim()      ? { diagnosis: form.diagnosis.trim() }           : {}),
        ...(form.prescription != null   ? { prescription: form.prescription }            : {}),
        ...(form.notes        != null   ? { notes: form.notes }                          : {}),
      };
      const updated = await updateVisit({ visitId: visit.visitId, ...body }).unwrap();
      onUpdate(updated);
      setMode('view');
    } catch (err: any) {
      setError(opdErrorMessage(err, 'Failed to update visit.'));
    } finally {
      updatingRef.current = false;
    }
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!completeForm.diagnosis.trim()) {
      setError('Diagnosis is required to complete a visit.');
      return;
    }
    if (completeForm.diagnosis.trim().length > 2000) {
      setError('Diagnosis cannot exceed 2000 characters.');
      return;
    }
    if ((completeForm.prescription ?? '').length > 5000) {
      setError('Prescription cannot exceed 5000 characters.');
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
    <DialogOverlay className="justify-end bg-black/40" onClick={onClose}>
      <div
        className="relative flex flex-col h-full w-full max-w-lg bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b shrink-0">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">#{visit.queueNumber}</span>
              <Badge variant={opdStatusVariant(visit.status)}>{opdStatusLabel(visit.status)}</Badge>
            </div>
            <p className="text-sm font-semibold truncate">{visit.fullName ?? visit.patientId}</p>
            <p className="text-xs text-muted-foreground">{visit.patientId} · {formatDate(visit.visitDate)}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors shrink-0">
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
              {f('Diagnosis',       visit.diagnosis)}
              {f('Prescription',    visit.prescription ? (
                <pre className="whitespace-pre-wrap font-sans text-sm">{visit.prescription}</pre>
              ) : null)}
              {f('Notes',           <RichTextDisplay value={visit.notes} />)}
              {f('Visit ID',        <span className="font-mono text-xs">{visit.visitId}</span>)}
              {canViewPayment && (
                <div className="mt-3 pt-3 border-t space-y-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Payment</p>
                  {visitPayment ? (
                    <>
                      {f('Amount',       <span className="font-semibold">{formatINR(visitPayment.amount)}</span>)}
                      {f('Payment Mode', <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">{PAYMENT_METHOD_LABELS[visitPayment.paymentMethod] ?? visitPayment.paymentMethod}</span>)}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground py-1">No payment on record for this visit.</p>
                  )}
                </div>
              )}
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
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2.5 py-0.5 text-xs font-medium text-info max-w-[160px]">
                          <span className="truncate min-w-0" title={d?.name ?? id}>{d?.name ?? id}</span>
                          <button type="button" onClick={() => setEditDoctorIds((prev) => prev.filter((x) => x !== id))} className="ml-0.5 shrink-0 hover:text-destructive">
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
                <Label htmlFor="ep-diagnosis">Diagnosis</Label>
                <textarea
                  id="ep-diagnosis"
                  rows={3}
                  value={form.diagnosis ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))}
                  maxLength={2000}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                <CharCounter value={form.diagnosis ?? ''} max={2000} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-prescription">Prescription</Label>
                <textarea
                  id="ep-prescription"
                  rows={4}
                  value={form.prescription ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, prescription: e.target.value }))}
                  maxLength={5000}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                <CharCounter value={form.prescription ?? ''} max={5000} trimmed={false} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-notes">Notes</Label>
                <RichTextEditor
                  id="ep-notes"
                  rows={2}
                  value={form.notes ?? ''}
                  onChange={(html) => setForm((f) => ({ ...f, notes: html }))}
                  maxLength={2000}
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
                  maxLength={2000}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  required
                />
                <CharCounter value={completeForm.diagnosis} max={2000} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-prescription">Prescription</Label>
                <textarea
                  id="cp-prescription"
                  rows={4}
                  value={completeForm.prescription ?? ''}
                  onChange={(e) => setCompleteForm((f) => ({ ...f, prescription: e.target.value }))}
                  maxLength={5000}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                <CharCounter value={completeForm.prescription ?? ''} max={5000} trimmed={false} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-notes">Notes</Label>
                <RichTextEditor
                  id="cp-notes"
                  rows={2}
                  value={completeForm.notes ?? ''}
                  onChange={(html) => setCompleteForm((f) => ({ ...f, notes: html }))}
                  maxLength={2000}
                />
              </div>
            </form>
          )}
        </div>

        {/* Footer actions */}
        {!isTerminal && (
          <div className="shrink-0 border-t border-border bg-white px-5 py-4">
            {mode === 'view' && (
              // Wraps to a second row rather than crushing four buttons into
              // the 448px panel when the visit is still waiting.
              <div className="flex flex-wrap items-stretch gap-3">
                {canEdit && (
                  <Button
                    variant="outline"
                    className="min-w-[120px] flex-1 h-10 rounded-lg border-slate-300 bg-white font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
                    onClick={() => setMode('edit')}
                  >
                    Edit Visit
                  </Button>
                )}
                {canComplete && visit.status === 'OPEN' && (
                  <Button
                    variant="default"
                    className="min-w-[120px] flex-1 h-10 rounded-lg font-medium"
                    onClick={handleStartConsultation}
                    disabled={starting}
                  >
                    <PlayCircle className="h-4 w-4 mr-2" />
                    {starting ? 'Starting…' : 'Start'}
                  </Button>
                )}
                {canComplete && (
                  <Button
                    variant="success"
                    className="min-w-[120px] flex-1 h-10 rounded-lg border border-emerald-600 bg-emerald-600 font-medium text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700"
                    onClick={() => setMode('complete')}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Complete
                  </Button>
                )}
                {canCancel && (
                  <Button
                    variant="destructive"
                    className="min-w-[120px] flex-1 h-10 rounded-lg border border-red-600 bg-red-600 font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700"
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={cancelling}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    {cancelling ? '…' : 'Cancel Visit'}
                  </Button>
                )}
              </div>
            )}
            {mode === 'edit' && (
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-10 rounded-lg" onClick={() => setMode('view')}>Back</Button>
                <Button type="submit" form="editForm" className="flex-1 h-10 rounded-lg" disabled={updating}>
                  {updating ? 'Saving…' : 'Save Changes'}
                </Button>
              </div>
            )}
            {mode === 'complete' && (
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-10 rounded-lg" onClick={() => setMode('view')}>Back</Button>
                <Button type="submit" form="completeForm" variant="success" className="flex-1 h-10 rounded-lg" disabled={completing}>
                  {completing ? 'Completing…' : 'Confirm Complete'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {showCancelConfirm && (
        <DialogOverlay className="items-center justify-center bg-black/50 p-4">
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
        </DialogOverlay>
      )}
    </DialogOverlay>
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
    visitDate: todayISO(),
    notes:     '',
  });
  const [regType,       setRegType]       = useState<'free' | 'paid'>('free');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode,   setPaymentMode]   = useState<OPDPaymentMode | ''>('');
  const [transactionId, setTransactionId] = useState('');
  const [error, setError] = useState('');
  const [showAddPatient, setShowAddPatient] = useState(false);

  // Reset to the default manual choice whenever the selected patient changes,
  // so a stale EXPIRED/VALID determination from a previously-selected patient
  // can never leak into the new patient's payment section while the fresh
  // validity check is in flight.
  useEffect(() => {
    setRegType('free');
    setPaymentAmount('');
    setPaymentMode('');
    setTransactionId('');
  }, [selectedPatient?.patientId]);

  // Backend-authoritative OPD payment validity check for the selected patient
  // + currently-selected doctor(s) — decides whether this visit is covered by
  // a still-valid prior OPD payment for this doctor, whether that payment
  // expired (a new one is mandatory), whether the patient is visiting a
  // different doctor than the one they last paid for (a new one is also
  // mandatory), or whether no OPD payment exists yet (existing manual
  // Free/Paid flow applies unchanged). Re-fetches whenever the doctor
  // selection changes, since validity is doctor-specific, not just
  // patient-specific.
  const {
    data: paymentValidity,
    isFetching: checkingValidity,
    refetch: refetchPaymentValidity,
  } = useGetOPDPaymentValidityQuery(
    { patientId: selectedPatient?.patientId ?? '', doctorIds: selectedDoctorIds },
    { skip: !selectedPatient },
  );

  // Sync the registration type to the backend's determination whenever it's
  // known — VALID never charges, EXPIRED and DIFFERENT_DOCTOR both always
  // require a fresh payment. NO_PAYMENT (or not yet loaded) leaves the
  // receptionist's manual Free/Paid choice untouched, preserving today's flow
  // for a patient's first payment.
  useEffect(() => {
    if (!paymentValidity) return;
    if (paymentValidity.reason === 'VALID') {
      setRegType('free');
      setPaymentAmount('');
      setPaymentMode('');
      setTransactionId('');
    } else if (paymentValidity.reason === 'EXPIRED' || paymentValidity.reason === 'DIFFERENT_DOCTOR') {
      setRegType('paid');
    }
  }, [paymentValidity]);

  // Only Hospital Admins may backdate an OPD visit (e.g. paper-register backfill);
  // every other role is restricted to today/future dates, both here and on the backend.
  const role = useAppSelector((s) => s.auth.profile?.role);
  const canBackdate = role === 'HOSPITAL_ADMIN';

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

  // Belt-and-braces against double submission: React state (isLoading) only
  // reflects the mutation after the next render, so a very fast double-click or
  // duplicate submit/keydown event can slip both calls through before the button
  // disables. A synchronous ref closes that gap.
  const submittingRef = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading || submittingRef.current) return;
    setError('');
    if (!selectedPatient) { setError('Please select a patient.'); return; }
    if (!canBackdate && form.visitDate && form.visitDate < todayISO()) {
      setError('Past dates are not allowed for OPD visits.');
      return;
    }

    // Re-check payment validity right before submitting — the backend is the
    // final authority, and this form may have sat open long enough for a
    // previously-fetched validity window to have lapsed since it was checked.
    let validity = paymentValidity;
    try {
      const fresh = await refetchPaymentValidity();
      if (fresh.data) validity = fresh.data;
    } catch {
      // Network hiccup on the re-check — fall back to the last known result
      // (or the manual toggle, if none was ever loaded) rather than blocking submission.
    }

    const paymentCovered = validity?.reason === 'VALID';        // still within validity for this doctor — never charge
    const paymentForced  = validity?.reason === 'EXPIRED'        // validity lapsed for this doctor — payment mandatory
      || validity?.reason === 'DIFFERENT_DOCTOR';                // visiting a doctor never paid for — payment mandatory
    const effectiveRegType: 'free' | 'paid' = paymentCovered ? 'free' : paymentForced ? 'paid' : regType;

    let amount = 0;
    let mode: OPDPaymentMode | undefined;
    if (effectiveRegType === 'paid') {
      amount = parseFloat(paymentAmount);
      if (!paymentAmount || isNaN(amount) || amount <= 0) {
        setError('Payment amount is required and must be greater than zero.');
        return;
      }
      if (!paymentMode) { setError('Payment mode is required.'); return; }
      mode = paymentMode;
    }

    submittingRef.current = true;
    try {
      let visit: OPDVisitResponse;
      try {
        const body: CreateOPDVisitRequest = {
          patientId:      selectedPatient.patientId,
          doctorIds:      selectedDoctorIds.length ? selectedDoctorIds : undefined,
          visitDate:      form.visitDate || undefined,
          notes:          form.notes    || undefined,
        };
        visit = await createVisit(body).unwrap();
      } catch (err: any) {
        setError(opdErrorMessage(err, 'Failed to create visit.'));
        return;
      }

      if (effectiveRegType === 'paid' && mode) {
        try {
          await createManualPayment({
            patientId:     selectedPatient.patientId,
            amount,
            paymentMethod: mode,
            description:   validity?.reason === 'DIFFERENT_DOCTOR'
              ? `OPD Consultation – Visit #${visit.queueNumber} (New Doctor)`
              : paymentForced
              ? `OPD Consultation – Visit #${visit.queueNumber} (OPD Renewal)`
              : `OPD Consultation – Visit #${visit.queueNumber}`,
            referenceType: 'OPD_VISIT',
            referenceId:   visit.visitId,
            transactionId: (mode === 'UPI' || mode === 'CARD') && transactionId.trim()
              ? transactionId.trim()
              : undefined,
          }).unwrap();
        } catch (err: any) {
          setError(
            `Visit #${visit.queueNumber} was created, but recording the payment failed: ${err?.data?.message ?? 'please record the payment manually.'}`,
          );
          return;
        }
      }

      onClose();
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <>
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
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
              <div className="flex gap-2">
                <div className="relative flex-1">
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
                <Button type="button" onClick={() => setShowAddPatient(true)} className="shrink-0 h-10">
                  <UserPlus className="h-4 w-4 mr-1.5" />
                  Add Patient
                </Button>
              </div>
            )}
          </div>

          {/* Department + Visit Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div className="space-y-1.5">
              <Label htmlFor="nv-date">Visit Date</Label>
              <Input
                id="nv-date"
                type="date"
                min={canBackdate ? undefined : todayISO()}
                value={form.visitDate ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, visitDate: e.target.value }))}
                className="relative pr-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-3 [&::-webkit-calendar-picker-indicator]:top-0 [&::-webkit-calendar-picker-indicator]:bottom-0 [&::-webkit-calendar-picker-indicator]:my-auto [&::-webkit-calendar-picker-indicator]:h-5 [&::-webkit-calendar-picker-indicator]:w-5 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
              />
            </div>
          </div>

          {/* Doctors */}
          <div className="space-y-1.5">
            <Label>Assign Doctors</Label>
            {selectedDoctorIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedDoctorIds.map((id) => {
                  const d = allDoctors.find((u) => u.userId === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2.5 py-0.5 text-xs font-medium text-info max-w-[160px]">
                      <span className="truncate min-w-0" title={d?.name ?? id}>{d?.name ?? id}</span>
                      <button type="button" onClick={() => setSelectedDoctorIds((prev) => prev.filter((x) => x !== id))} className="ml-0.5 shrink-0 hover:text-destructive">
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
              <Button
                type="button"
                disabled={!addDoctorId}
                onClick={() => {
                  if (addDoctorId && !selectedDoctorIds.includes(addDoctorId)) {
                    setSelectedDoctorIds((prev) => [...prev, addDoctorId]);
                    setAddDoctorId('');
                  }
                }}
                className="shrink-0 h-10"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add Doctor
              </Button>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="nv-notes">Notes (optional)</Label>
            <RichTextEditor
              id="nv-notes"
              rows={2}
              value={form.notes ?? ''}
              onChange={(html) => setForm((f) => ({ ...f, notes: html }))}
              maxLength={2000}
            />
          </div>

          {/* Registration Type / Payment — driven by the backend's OPD payment
              validity check for the selected patient + doctor(s) (see getOPDPaymentValidity). */}
          <div className="rounded-md border border-input p-4 space-y-3 bg-muted/30">
            <p className="text-sm font-medium">OPD Payment</p>

            {!selectedPatient ? (
              <p className="text-sm text-muted-foreground">Select a patient to check OPD payment status.</p>
            ) : checkingValidity && !paymentValidity ? (
              <p className="text-sm text-muted-foreground">Checking previous OPD payment…</p>
            ) : paymentValidity?.reason === 'VALID' ? (
              <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
                Existing OPD payment is valid until {formatDate(paymentValidity.validUntil!)}. No new payment is required for this visit.
              </p>
            ) : (
              <>
                {paymentValidity?.reason === 'EXPIRED' && (
                  <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                    Previous OPD payment validity expired on {formatDate(paymentValidity.validUntil!)}. A new OPD payment is required to continue.
                  </p>
                )}

                {paymentValidity?.reason === 'DIFFERENT_DOCTOR' && (
                  <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                    This patient&apos;s existing OPD payment does not cover the selected doctor(s). A new OPD payment is required to continue.
                  </p>
                )}

                {paymentValidity?.reason !== 'EXPIRED' && paymentValidity?.reason !== 'DIFFERENT_DOCTOR' && (
                  <>
                    <p className="text-xs text-muted-foreground -mt-1">Registration Type *</p>
                    <div className="flex gap-2">
                      {(['free', 'paid'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            setRegType(t);
                            if (t === 'free') { setPaymentAmount(''); setPaymentMode(''); setTransactionId(''); }
                            setError('');
                          }}
                          className={[
                            'flex-1 rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors',
                            regType === t
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input bg-background hover:bg-muted',
                          ].join(' ')}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {regType === 'paid' && (
                  <>
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
                            onClick={() => {
                              setPaymentMode(value);
                              if (value === 'CASH') setTransactionId('');
                            }}
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

                    {(paymentMode === 'UPI' || paymentMode === 'CARD') && (
                      <div className="space-y-1.5">
                        <Label htmlFor="nv-pay-txn">Transaction ID (optional)</Label>
                        <Input
                          id="nv-pay-txn"
                          type="text"
                          placeholder="e.g. UPI reference / last 4 digits"
                          value={transactionId}
                          onChange={(e) => setTransactionId(e.target.value)}
                        />
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !selectedPatient}>
              {isLoading ? 'Creating…' : 'Create Visit'}
            </Button>
          </div>
        </form>
      </div>
    </DialogOverlay>
    {showAddPatient && (
      <PatientFormModal
        mode="register"
        onClose={() => setShowAddPatient(false)}
        onSuccess={(p) => { setSelectedPatient(p); setShowAddPatient(false); }}
      />
    )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabType = 'queue' | 'new';

export default function OPDPage() {
  const role   = useAppSelector((s) => s.auth.profile?.role);
  const userId = useAppSelector((s) => s.auth.profile?.userId);

  const { data: wards = [] } = useListWardsQuery(undefined, { skip: role !== 'NURSE' });
  const nurseHasNoWard = role === 'NURSE' && !wards.some((w) => w.assignedNurseIds.includes(userId ?? ''));

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

  // DOCTOR is deliberately excluded — doctors may view/act on visits assigned to
  // them but must not be able to create new OPD visits (also enforced server-side).
  // NURSE is view-only on Doctor Visits — no create/edit/complete/cancel (also
  // enforced server-side).
  const canCreateVisit = ['RECEPTIONIST', 'HOSPITAL_ADMIN', 'MANAGER'].includes(role ?? '');
  const canEdit        = ['DOCTOR', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canComplete    = ['DOCTOR', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canCancel      = ['RECEPTIONIST', 'DOCTOR', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canViewPayment = PAYMENT_VIEW_ROLES.includes(role ?? '');

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
              {nurseHasNoWard ? 'No ward has been assigned to your account.' : 'No visits for the selected filters.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Doctor</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr
                      key={v.visitId}
                      // Finished visits are tinted, not faded. Row-level opacity
                      // dropped the doctor name to 2.3:1 and the action link to
                      // 2.55:1 — both below the 4.5:1 AA floor, and the dimmed
                      // link read as disabled. The status badge already carries
                      // the state, so the tint is only a scanning aid.
                      className={cn(
                        'border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/30',
                        TERMINAL.has(v.status) && 'bg-muted/30',
                      )}
                      onClick={() => setSelectedVisit(v)}
                    >
                      <td className="px-4 py-3 max-w-[180px]">
                        <p className="font-medium truncate" title={v.fullName ?? v.patientId}>{v.fullName ?? v.patientId}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.patientId} · {formatDate(v.visitDate)}
                        </p>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground max-w-[180px] truncate" title={doctorNames(v.doctorIds ?? [])}>
                        {doctorNames(v.doctorIds ?? [])}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={opdStatusVariant(v.status)}
                          className="h-6 w-28 justify-center whitespace-nowrap"
                        >
                          {opdStatusLabel(v.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            title="Print OPD "
                            aria-label="Print OPD "
                            className="text-muted-foreground hover:text-primary transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(`/opd/${v.visitId}/print`, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          {/* Both states open the same panel — "Open" also read
                              as the old OPEN status, which now displays as
                              "Waiting". */}
                          <button className="text-xs text-primary hover:underline">
                            View
                          </button>
                        </div>
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
          canViewPayment={canViewPayment}
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
