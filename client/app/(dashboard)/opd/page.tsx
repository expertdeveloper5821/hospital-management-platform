'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useGetOPDQueueQuery,
  useCreateOPDVisitMutation,
  useUpdateOPDVisitMutation,
  useStartOPDConsultationMutation,
  useCompleteOPDVisitMutation,
  useCancelOPDVisitMutation,
  useDeleteOPDVisitMutation,
  useGetOPDPaymentValidityQuery,
  useGetAvailableOpdNursesQuery,
  useGetDoctorNurseAssignmentsQuery,
} from '@/store/api/opd.api';
import { useCreateManualPaymentMutation, useListPaymentsQuery } from '@/store/api/payment.api';
import { useSearchPatientsQuery, useGetPatientByIdQuery } from '@/store/api/patient.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useListDepartmentsQuery } from '@/store/api/department.api';
import { useListWardsQuery } from '@/store/api/ipd.api';
import { useAppSelector } from '@/store/hooks';
import { PatientFormModal } from '@/components/patients/patient-form-modal';
import type {
  OPDVisitResponse,
  OPDVisitStatus,
  OPDVitals,
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
  Trash2,
  PlayCircle,
  Search,
  ClipboardList,
  RefreshCw,
  UserPlus,
  Printer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { serialNumber, serialOffset } from '@/lib/serial-number';
import { NavForm } from '@/components/ui/form';
import { PeopleMultiSelect } from '@/components/ui/people-multi-select';
import {
  formatVitalValue,
  getVitalDefinitions,
  getVitalsCategory,
  getVitalsHeading,
  parsePatientVital,
  type VitalKey,
} from '@/lib/patient-vitals';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Local (not UTC) calendar date — the hospital's IST timezone, matching the
// browser's local clock, the same convention the Attendance page already
// relies on. toISOString() would return the *UTC* date, which is a day
// behind IST for the first ~5.5 hours after midnight IST.
function todayISO() {
  const d = new Date();
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Pinned to IST so the displayed date doesn't shift with the viewer's own
// machine/browser timezone.
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

// A stored visitDate (IST midnight as a UTC instant) as the YYYY-MM-DD value
// an <input type="date"> expects, in IST regardless of the viewer's timezone.
function toISTDateInput(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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

const DEPARTMENT_DOCTOR_MESSAGE = 'Changing the department requires selecting a doctor from the selected department.';

// ─── Vitals (OPD Edit form) ─────────────────────────────────────────────────
type VitalsInputState = Record<VitalKey, string>;

const EMPTY_VITALS_INPUTS: VitalsInputState = {
  weight: '', height: '', bloodPressure: '', sugar: '', bodyTemperature: '',
  spo2: '', pulse: '', respiratoryRate: '', headCircumference: '',
};

function vitalsToInputs(vitals?: OPDVitals | null): VitalsInputState {
  if (!vitals) return EMPTY_VITALS_INPUTS;
  return {
    weight:          vitals.weight          != null ? String(vitals.weight)          : '',
    height:          vitals.height          != null ? String(vitals.height)          : '',
    bloodPressure:   vitals.bloodPressure   ?? '',
    sugar:           vitals.sugar           != null ? String(vitals.sugar)           : '',
    bodyTemperature: vitals.bodyTemperature != null ? String(vitals.bodyTemperature) : '',
    spo2:            vitals.spo2            != null ? String(vitals.spo2)            : '',
    pulse:           vitals.pulse           != null ? String(vitals.pulse)           : '',
    respiratoryRate: vitals.respiratoryRate != null ? String(vitals.respiratoryRate) : '',
    headCircumference: vitals.headCircumference != null ? String(vitals.headCircumference) : '',
  };
}

// Per-field validation messages, keyed by the input they belong to so each
// one renders directly below its own field rather than in the form banner.
type VitalsErrors = Partial<Record<VitalKey, string>>;

// Converts the controlled-input strings into the partial vitals payload the
// PATCH endpoint expects — an empty field becomes `null` (explicitly clears
// that reading server-side, never leaves it untouched), matching the same
// ranges OPDController's vitalsSchema validates. Returns every failing field's
// message instead of a payload when any field fails.
function parseVitalsInputs(
  inputs: VitalsInputState,
  category: ReturnType<typeof getVitalsCategory>,
): { vitals: Partial<OPDVitals> } | { errors: VitalsErrors } {
  const vitals: Record<string, number | string | null> = {};
  const errors: VitalsErrors = {};

  getVitalDefinitions(category).forEach((definition) => {
    const parsed = parsePatientVital(definition.key, inputs[definition.key], definition);
    if (parsed.error) errors[definition.key] = parsed.error;
    else vitals[definition.key] = parsed.value;
  });

  return Object.keys(errors).length > 0 ? { errors } : { vitals: vitals as Partial<OPDVitals> };
}

// ─── Visit Detail Panel ───────────────────────────────────────────────────────

interface VisitPanelProps {
  visit:   OPDVisitResponse;
  onClose: () => void;
  onUpdate: (updated: OPDVisitResponse) => void;
  canEdit: boolean;    // DOCTOR, HOSPITAL_ADMIN
  canComplete: boolean; // DOCTOR, HOSPITAL_ADMIN
  canCancel: boolean;  // DOCTOR, HOSPITAL_ADMIN
  canDelete: boolean;  // RECEPTIONIST (replaces Cancel for that role)
  canViewPayment: boolean; // MANAGER, FINANCE_MANAGER, HOSPITAL_ADMIN, RECEPTIONIST — mirrors GET /api/payments requireRole
  doctorNames: (ids: string[]) => string;
  allDoctors:  UserResponse[];
  nurseNames:  (ids: string[]) => string;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CHEQUE: 'Cheque',
};

// Roles permitted to view payment details, matching the backend's GET /api/payments requireRole list.
const PAYMENT_VIEW_ROLES = ['MANAGER', 'FINANCE_MANAGER', 'HOSPITAL_ADMIN', 'RECEPTIONIST'];

function VisitPanel({ visit, onClose, onUpdate, canEdit, canComplete, canCancel, canDelete, canViewPayment, doctorNames, allDoctors, nurseNames }: VisitPanelProps) {
  const isTerminal = TERMINAL.has(visit.status);

  // A Nurse's Edit access is separate from `canEdit` (DOCTOR/HOSPITAL_ADMIN
  // only) — notes-only, and only for a visit she's personally listed on via
  // nurseIds (ward-based view access alone doesn't qualify). Mirrors the
  // server-side check in OPDService.updateVisit; this is UI convenience
  // only — the backend enforces both the assignment and the field
  // restriction independently of what this component renders.
  const role   = useAppSelector((s) => s.auth.profile?.role);
  const userId = useAppSelector((s) => s.auth.profile?.userId);
  const nurseNotesOnly = role === 'NURSE' && (visit.nurseIds ?? []).includes(userId ?? '');
  // A Receptionist's Edit access is the Patient, Visit Date, Notes,
  // Department/Doctor/Nurse assignment and Vitals — mirrors
  // RECEPTIONIST_EDITABLE_FIELDS in opd.controller.ts.
  const receptionistAssignOnly = role === 'RECEPTIONIST';

  // Receptionist-only Patient / Visit Date editing.
  const [editPatient, setEditPatient] = useState<{ patientId: string; fullName?: string | null; mobileNumber?: string }>(
    { patientId: visit.patientId, fullName: visit.fullName },
  );
  const [editPatientSearch,          setEditPatientSearch]          = useState('');
  const [debouncedEditPatientSearch, setDebouncedEditPatientSearch] = useState('');
  const [editPatientPicking,         setEditPatientPicking]         = useState(false);
  const [editVisitDate,              setEditVisitDate]              = useState(toISTDateInput(visit.visitDate));
  useEffect(() => {
    const t = setTimeout(() => setDebouncedEditPatientSearch(editPatientSearch), 400);
    return () => clearTimeout(t);
  }, [editPatientSearch]);
  const { data: editPatientData, isFetching: fetchingEditPatients } = useSearchPatientsQuery(
    { q: debouncedEditPatientSearch || undefined, limit: 10 },
    { skip: !receptionistAssignOnly || !debouncedEditPatientSearch },
  );
  const editPatientResults = editPatientData?.data ?? [];
  const editPatientChanged = editPatient.patientId !== visit.patientId;

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

  // Picking a specific department drops any assigned doctor who doesn't
  // belong to it. Changing away from the visit's saved department then
  // requires at least one doctor from the new one before Save is allowed —
  // the backend derives departmentId from the doctors, so this keeps the
  // saved Department/Doctor pair consistent.
  // Pruning runs in an effect (not the change handler) so it re-applies once
  // the doctor list arrives — pruning against a still-loading, empty list
  // would otherwise wrongly drop every assigned doctor. It only runs after a
  // user-initiated change, so Edit mode opens with the visit's existing
  // doctors preselected untouched.
  const [departmentTouched, setDepartmentTouched] = useState(false);
  function handleEditDepartmentChange(departmentId: string) {
    setSelectedDepartmentId(departmentId);
    setDepartmentTouched(true);
  }
  useEffect(() => {
    if (!departmentTouched || !selectedDepartmentId || !editUsersData) return;
    const doctors = editUsersData.data ?? [];
    setEditDoctorIds((prev) => {
      const next = prev.filter((id) =>
        doctors.find((d) => d.userId === id)?.departmentIds.includes(selectedDepartmentId));
      return next.length === prev.length ? prev : next;
    });
  }, [departmentTouched, selectedDepartmentId, editUsersData]);
  const departmentChanged = selectedDepartmentId !== (visit.departmentId ?? '');
  const departmentDoctorInvalid =
    !!selectedDepartmentId && departmentChanged && (
      editDoctorIds.length === 0 ||
      editDoctorIds.some((id) => !editAllDoctors.find((d) => d.userId === id)?.departmentIds.includes(selectedDepartmentId))
    );

  const { data: editNursesData } = useGetAvailableOpdNursesQuery(undefined, { skip: !(receptionistAssignOnly || canEdit) });
  const editAvailableNurses = editNursesData ?? [];
  const [editNurseIds,    setEditNurseIds]    = useState<string[]>(visit.nurseIds ?? []);

  const [form, setForm] = useState<UpdateOPDVisitRequest>({
    diagnosis:      visit.diagnosis      ?? '',
    prescription:   visit.prescription   ?? '',
    notes:          visit.notes          ?? '',
  });
  // Vitals — editable by Doctor, Nurse, Receptionist and Hospital Admin alike
  // (see canEdit/nurseNotesOnly/receptionistAssignOnly), unlike
  // diagnosis/prescription which stay read-only for a Nurse.
  const [vitalsForm, setVitalsForm] = useState<VitalsInputState>(vitalsToInputs(visit.vitals));
  const [vitalsErrors, setVitalsErrors] = useState<VitalsErrors>({});
  const [completeForm, setCompleteForm] = useState<CompleteOPDVisitRequest>({
    diagnosis:    visit.diagnosis    ?? '',
    prescription: visit.prescription ?? '',
    notes:        visit.notes        ?? '',
  });
  const [mode,              setMode]              = useState<'view' | 'edit' | 'complete'>('view');
  const [error,             setError]             = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // The visit's patient age drives the fallback vitals set (see below).
  const { data: patient } = useGetPatientByIdQuery(visit.patientId);
  // Vitals set follows the department — the one being picked while editing,
  // the saved one otherwise; with none, the patient's age decides (under 18
  // → pediatric set).
  const vitalsCategory = getVitalsCategory(
    mode === 'edit' ? selectedDepartmentId : visit.departmentId,
    editDepartments,
    patient,
  );

  const [updateVisit,   { isLoading: updating  }] = useUpdateOPDVisitMutation();
  const [startConsultation, { isLoading: starting }] = useStartOPDConsultationMutation();
  const [completeVisit, { isLoading: completing }] = useCompleteOPDVisitMutation();
  const [cancelVisit,   { isLoading: cancelling }] = useCancelOPDVisitMutation();
  const [deleteVisit,   { isLoading: deleting   }] = useDeleteOPDVisitMutation();

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
    setVitalsErrors({});
    if (!nurseNotesOnly && departmentDoctorInvalid) {
      setError(DEPARTMENT_DOCTOR_MESSAGE);
      return;
    }
    if (receptionistAssignOnly) {
      // Only changed patient/date/notes/assignments (plus vitals) are sent —
      // the backend rejects any other field from a Receptionist (see
      // RECEPTIONIST_EDITABLE_FIELDS). Vitals are per visit, so they stay with
      // this visit (and are always sent) even when the patient is corrected.
      const receptionistVitals = parseVitalsInputs(vitalsForm, vitalsCategory);
      if ('errors' in receptionistVitals) {
        setVitalsErrors(receptionistVitals.errors);
        return;
      }
      if (!editVisitDate) {
        setError('Visit date is required.');
        return;
      }
      const visitDateChanged = editVisitDate !== toISTDateInput(visit.visitDate);
      if (visitDateChanged && editVisitDate < todayISO()) {
        setError('Past dates are not allowed for OPD visits.');
        return;
      }
      const changed = (next: string[], prev: string[]) =>
        next.length !== prev.length || next.some((id) => !prev.includes(id));
      const notesChanged = (form.notes ?? '') !== (visit.notes ?? '');
      const body: UpdateOPDVisitRequest = {
        ...(editPatientChanged ? { patientId: editPatient.patientId } : {}),
        ...(visitDateChanged   ? { visitDate: editVisitDate }         : {}),
        ...(notesChanged       ? { notes:     form.notes ?? '' }      : {}),
        ...(changed(editDoctorIds, visit.doctorIds ?? []) ? { doctorIds: editDoctorIds } : {}),
        ...(changed(editNurseIds,  visit.nurseIds  ?? []) ? { nurseIds:  editNurseIds  } : {}),
        ...(departmentChanged && selectedDepartmentId ? { departmentId: selectedDepartmentId } : {}),
        vitals: receptionistVitals.vitals,
      };
      updatingRef.current = true;
      try {
        const updated = await updateVisit({ visitId: visit.visitId, ...body }).unwrap();
        onUpdate(updated);
        setMode('view');
      } catch (err: any) {
        setError(opdErrorMessage(err, 'Failed to update visit.'));
      } finally {
        updatingRef.current = false;
      }
      return;
    }
    if ((form.diagnosis ?? '').trim().length > 2000) {
      setError('Diagnosis cannot exceed 2000 characters.');
      return;
    }
    if ((form.prescription ?? '').length > 5000) {
      setError('Prescription cannot exceed 5000 characters.');
      return;
    }
    // Vitals are editable by both the full edit form and the Nurse's
    // notes-only form (see the Vitals section rendered in each below), so
    // validate/include them regardless of which form is active.
    const vitalsResult = parseVitalsInputs(vitalsForm, vitalsCategory);
    if ('errors' in vitalsResult) {
      setVitalsErrors(vitalsResult.errors);
      return;
    }
    updatingRef.current = true;
    try {
      // doctorIds is only sent when it actually changed from the visit's
      // current assignment. It's deliberately excluded from the offline
      // mutation-policy allowlist (see updateOPDVisit's allowedBodyFields in
      // lib/offline/mutation-policy.ts) because reassigning doctors needs the
      // server to re-resolve the department — always resending it here would
      // silently disqualify every offline diagnosis/prescription/notes/vitals
      // edit from being queued, which is the one case offline editing exists
      // to support in the first place.
      const doctorIdsChanged =
        editDoctorIds.length !== (visit.doctorIds ?? []).length ||
        editDoctorIds.some((id) => !(visit.doctorIds ?? []).includes(id));
      const nurseIdsChanged =
        editNurseIds.length !== (visit.nurseIds ?? []).length ||
        editNurseIds.some((id) => !(visit.nurseIds ?? []).includes(id));

      // A notes-only nurse edit must send *only* notes/vitals — the backend
      // rejects the request outright if any other field is present (see
      // NURSE_EDITABLE_FIELDS in opd.controller.ts), so doctorIds/diagnosis/
      // prescription are deliberately omitted here rather than resent unchanged.
      const body: UpdateOPDVisitRequest = nurseNotesOnly
        ? {
            ...(form.notes != null ? { notes: form.notes } : {}),
            vitals: vitalsResult.vitals,
          }
        : {
            ...(doctorIdsChanged ? { doctorIds: editDoctorIds } : {}),
            // Like doctorIds, only sent when changed (keeps offline-queueable
            // diagnosis/prescription/notes/vitals edits unaffected).
            ...(nurseIdsChanged ? { nurseIds: editNurseIds } : {}),
            // The picked department is saved as-is (Pediatric / Non-Pediatric
            // pick the vitals set) — only sent when changed, like doctorIds.
            ...(departmentChanged && selectedDepartmentId ? { departmentId: selectedDepartmentId } : {}),
            // Sent unconditionally (like prescription/notes below) so
            // intentionally clearing diagnosis down to blank is actually
            // submitted instead of silently dropped and left unchanged —
            // the backend now accepts (and audits) an explicit clear.
            diagnosis:    (form.diagnosis ?? '').trim(),
            ...(form.prescription != null   ? { prescription: form.prescription }            : {}),
            ...(form.notes        != null   ? { notes: form.notes }                          : {}),
            vitals: vitalsResult.vitals,
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

  // `form`/`completeForm` are only seeded from `visit` once, at whichever
  // render first created that state — they don't auto-resync when the
  // `visit` prop is later replaced with a fresher object (e.g. right after
  // Edit is saved via onUpdate, without the panel unmounting). Re-seeding
  // both from the current `visit` on the way into Edit/Complete mode is what
  // guarantees each flow always pre-fills with the latest persisted
  // Diagnosis/Prescription/Notes instead of whatever snapshot happened to be
  // sitting in state — including a diagnosis just saved via Edit but never
  // reflected into `completeForm`.
  function openEdit() {
    setForm({
      diagnosis:    visit.diagnosis    ?? '',
      prescription: visit.prescription ?? '',
      notes:        visit.notes        ?? '',
    });
    setVitalsForm(vitalsToInputs(visit.vitals));
    setVitalsErrors({});
    setSelectedDepartmentId(visit.departmentId ?? '');
    setDepartmentTouched(false);
    setEditDoctorIds(visit.doctorIds ?? []);
    setEditNurseIds(visit.nurseIds ?? []);
    setEditPatient({ patientId: visit.patientId, fullName: visit.fullName });
    setEditPatientSearch('');
    setEditPatientPicking(false);
    setEditVisitDate(toISTDateInput(visit.visitDate));
    setMode('edit');
  }

  function openComplete() {
    setCompleteForm({
      diagnosis:    visit.diagnosis    ?? '',
      prescription: visit.prescription ?? '',
      notes:        visit.notes        ?? '',
    });
    setMode('complete');
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

  async function handleDeleteConfirm() {
    setError('');
    try {
      await deleteVisit(visit.visitId).unwrap();
      setShowDeleteConfirm(false);
      onClose();
    } catch (err: any) {
      setShowDeleteConfirm(false);
      setError(err?.data?.message ?? 'Failed to delete visit.');
    }
  }

  const f = (label: string, val: React.ReactNode) => (
    <div className="py-2 border-b last:border-0 grid grid-cols-5 gap-2">
      <span className="col-span-2 text-sm text-muted-foreground">{label}</span>
      <span className="col-span-3 text-sm font-medium break-words">{val ?? '—'}</span>
    </div>
  );

  // Shared by all three edit forms below (full, Nurse notes-only and
  // Receptionist) — Doctor, Nurse, Receptionist and Hospital Admin can all
  // record vitals, unlike diagnosis/
  // prescription which stay read-only for a Nurse. Only one of the two forms
  // is ever mounted at a time, so the shared `ep-*` input ids never collide.
  // Editing a field clears its own stale message; the rest stay until the
  // next submit re-validates.
  const updateVital = (key: keyof VitalsInputState, value: string) => {
    setVitalsForm((v) => ({ ...v, [key]: value }));
    setVitalsErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  };
  const vitalErrorProps = (key: keyof VitalsInputState, id: string) =>
    vitalsErrors[key] ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {};
  const vitalError = (key: keyof VitalsInputState, id: string) =>
    vitalsErrors[key] ? <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{vitalsErrors[key]}</p> : null;

  const vitalsFields = (
    <div className="space-y-3 pt-2 border-t">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {getVitalsHeading(vitalsCategory)}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {getVitalDefinitions(vitalsCategory).map((definition) => {
          const id = `ep-${definition.key}`;
          return (
            <div className="space-y-1.5" key={definition.key}>
              <Label htmlFor={id}>{definition.label} ({definition.unit})</Label>
              <Input
                id={id}
                type={definition.key === 'bloodPressure' ? 'text' : 'number'}
                min={definition.min}
                max={definition.max}
                step={definition.step}
                placeholder={definition.placeholder}
                value={vitalsForm[definition.key]}
                onChange={(e) => updateVital(definition.key, e.target.value)}
                {...vitalErrorProps(definition.key, id)}
              />
              {vitalError(definition.key, id)}
            </div>
          );
        })}
      </div>
    </div>
  );

  // Assigned Nurses — shared by the Receptionist assignment-only form and the
  // full Doctor/Hospital Admin edit form (a Nurse's form never shows it).
  const nurseAssignFields = (
    <div className="space-y-1.5">
      <Label id="ep-nurses-label">Assigned Nurses</Label>
      <PeopleMultiSelect
        labelId="ep-nurses-label"
        noun="nurses"
        options={editAvailableNurses}
        getLabel={(id) => editAvailableNurses.find((n) => n.userId === id)?.name ?? nurseNames([id])}
        selectedIds={editNurseIds}
        onChange={setEditNurseIds}
      />
    </div>
  );

  // Department filter + Assigned Doctors — shared by the full edit form and
  // the Receptionist assignment-only form below.
  const departmentDoctorFields = (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="ep-dept">Department</Label>
        <select
          id="ep-dept"
          value={selectedDepartmentId}
          onChange={(e) => handleEditDepartmentChange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">— All Departments —</option>
          {editDepartments.map((dept) => (
            <option key={dept.departmentId} value={dept.departmentId}>{dept.name}</option>
          ))}
        </select>
        {departmentDoctorInvalid && (
          <p role="alert" className="text-xs text-destructive">{DEPARTMENT_DOCTOR_MESSAGE}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label id="ep-doctors-label">Assigned Doctors</Label>
        <PeopleMultiSelect
          labelId="ep-doctors-label"
          noun="doctors"
          options={editDoctors}
          getLabel={(id) => (allDoctors.find((u) => u.userId === id) ?? editAllDoctors.find((u) => u.userId === id))?.name ?? id}
          selectedIds={editDoctorIds}
          onChange={setEditDoctorIds}
        />
      </div>
    </>
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
              <span className="text-xs font-mono text-muted-foreground">
                {visit.queueNumber > 0 ? `#${visit.queueNumber}` : 'Pending sync'}
              </span>
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
              {f('Department',       visit.departmentId
                ? (editDepartments.find((d) => d.departmentId === visit.departmentId)?.name ?? visit.departmentId)
                : null)}
              {f('Doctor(s)',        doctorNames(visit.doctorIds ?? []))}
              {f('Nurse(s)',         nurseNames(visit.nurseIds ?? []))}
              {f('Diagnosis',       visit.diagnosis)}
              {f('Prescription',    visit.prescription ? (
                <pre className="whitespace-pre-wrap font-sans text-sm">{visit.prescription}</pre>
              ) : null)}
              {f('Notes',           <RichTextDisplay value={visit.notes} />)}
              <div className="mt-3 pt-3 border-t space-y-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {getVitalsHeading(vitalsCategory)}
                </p>
                {getVitalDefinitions(vitalsCategory).map((definition) => (
                  <div key={definition.key}>
                    {f(definition.label, formatVitalValue(visit.vitals, definition))}
                  </div>
                ))}
              </div>
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

          {/* Edit mode — Nurse gets a reduced, notes-only form: everything
              else (patient, department, doctors, nurses, diagnosis,
              prescription, status, payment) is shown read-only, matching the
              view mode's rows, and is never part of the submitted body
              (see handleUpdate) nor accepted by the backend if it were. */}
          {mode === 'edit' && nurseNotesOnly && (
            // noValidate: the Vitals number inputs' min/max are UX hints only
            // — without this, a browser/jsdom blocks the submit event
            // entirely on an out-of-range value before handleUpdate ever
            // runs, showing a native tooltip instead of our own styled error
            // banner (the same one every other validation error uses).
            <NavForm id="editForm" onSubmit={handleUpdate} className="space-y-4" noValidate>
              <p className="text-xs text-muted-foreground">Only the notes and vitals fields can be edited.</p>
              {f('Doctor(s)',     doctorNames(visit.doctorIds ?? []))}
              {f('Nurse(s)',      nurseNames(visit.nurseIds ?? []))}
              {f('Diagnosis',    visit.diagnosis)}
              {f('Prescription', visit.prescription ? (
                <pre className="whitespace-pre-wrap font-sans text-sm">{visit.prescription}</pre>
              ) : null)}
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
              {vitalsFields}
            </NavForm>
          )}
          {/* Edit mode — Receptionist form: Patient, Visit Date, Notes,
              Department/Doctors/Nurses and Vitals are editable; diagnosis and
              prescription are shown read-only and never submitted (see
              handleUpdate). */}
          {mode === 'edit' && receptionistAssignOnly && (
            <NavForm id="editForm" onSubmit={handleUpdate} className="space-y-4" noValidate>
              {/* <p className="text-xs text-muted-foreground">Only the patient, visit date, notes, department, doctor, nurse and vitals fields can be edited.</p> */}
              <div className="space-y-1.5">
                <Label>Patient</Label>
                {!editPatientPicking ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 rounded-md border px-3 py-2">
                      <p className="text-sm font-medium truncate">{editPatient.fullName ?? editPatient.patientId}</p>
                      <p className="text-xs text-muted-foreground">
                        {editPatient.patientId}{editPatient.mobileNumber ? ` · ${editPatient.mobileNumber}` : ''}
                      </p>
                    </div>
                    <Button type="button" className="shrink-0 h-10" onClick={() => setEditPatientPicking(true)}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="Search patient by name or mobile…"
                        value={editPatientSearch}
                        onChange={(e) => setEditPatientSearch(e.target.value)}
                        autoFocus
                      />
                      {debouncedEditPatientSearch && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg max-h-48 overflow-y-auto">
                          {fetchingEditPatients && (
                            <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
                          )}
                          {!fetchingEditPatients && editPatientResults.length === 0 && (
                            <p className="px-3 py-2 text-sm text-muted-foreground">No patients found.</p>
                          )}
                          {editPatientResults.map((p) => (
                            <button
                              key={p.patientId}
                              type="button"
                              className="flex flex-col w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                              onClick={() => {
                                setEditPatient({ patientId: p.patientId, fullName: p.fullName, mobileNumber: p.mobileNumber });
                                setEditPatientSearch('');
                                setEditPatientPicking(false);
                              }}
                            >
                              <span className="text-sm font-medium">{p.fullName}</span>
                              <span className="text-xs text-muted-foreground">{p.patientId} · {p.mobileNumber}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0 h-10"
                      onClick={() => { setEditPatientSearch(''); setEditPatientPicking(false); }}
                    >
                      Keep
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-date">Visit Date</Label>
                <Input
                  id="ep-date"
                  type="date"
                  min={todayISO()}
                  value={editVisitDate}
                  onChange={(e) => setEditVisitDate(e.target.value)}
                  className="relative pr-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-3 [&::-webkit-calendar-picker-indicator]:top-0 [&::-webkit-calendar-picker-indicator]:bottom-0 [&::-webkit-calendar-picker-indicator]:my-auto [&::-webkit-calendar-picker-indicator]:h-5 [&::-webkit-calendar-picker-indicator]:w-5 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                />
              </div>
              {departmentDoctorFields}
              {nurseAssignFields}
              {f('Diagnosis',    visit.diagnosis)}
              {f('Prescription', visit.prescription ? (
                <pre className="whitespace-pre-wrap font-sans text-sm">{visit.prescription}</pre>
              ) : null)}
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
              {vitalsFields}
            </NavForm>
          )}
          {mode === 'edit' && !nurseNotesOnly && !receptionistAssignOnly && (
            // noValidate: the Vitals number inputs' min/max are UX hints only
            // — without this, a browser/jsdom blocks the submit event
            // entirely on an out-of-range value before handleUpdate ever
            // runs, showing a native tooltip instead of our own styled error
            // banner (the same one every other validation error uses).
            <NavForm id="editForm" onSubmit={handleUpdate} className="space-y-4" noValidate>
              {departmentDoctorFields}
              {nurseAssignFields}
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
              {vitalsFields}
            </NavForm>
          )}

          {/* Complete mode */}
          {mode === 'complete' && (
            <NavForm id="completeForm" onSubmit={handleComplete} className="space-y-4">
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
            </NavForm>
          )}
        </div>

        {/* Footer actions */}
        {!isTerminal && (
          <div className="shrink-0 border-t border-border bg-white px-5 py-4">
            {mode === 'view' && (
              // Wraps to a second row rather than crushing four buttons into
              // the 448px panel when the visit is still waiting.
              <div className="flex flex-wrap items-stretch gap-3">
                {(canEdit || nurseNotesOnly || receptionistAssignOnly) && (
                  <Button
                    variant="outline"
                    className="min-w-[120px] flex-1 h-10 rounded-lg border-slate-300 bg-white font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
                    onClick={openEdit}
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
                    onClick={openComplete}
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
                {/* Waiting visits only — once the consultation has started
                    the visit is part of the record (enforced server-side too). */}
                {canDelete && visit.status === 'OPEN' && (
                  <Button
                    variant="destructive"
                    className="min-w-[120px] flex-1 h-10 rounded-lg border border-red-600 bg-red-600 font-medium text-white transition-colors hover:border-red-700 hover:bg-red-700"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleting}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {deleting ? '…' : 'Delete Visit'}
                  </Button>
                )}
              </div>
            )}
            {mode === 'edit' && (
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-10 rounded-lg" onClick={() => setMode('view')}>Back</Button>
                <Button type="submit" form="editForm" className="flex-1 h-10 rounded-lg" disabled={updating || (!nurseNotesOnly && departmentDoctorInvalid)}>
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

      {showDeleteConfirm && (
        <DialogOverlay className="items-center justify-center bg-black/50 p-4">
          <div role="alertdialog" aria-labelledby="delete-visit-title" className="bg-background rounded-lg border shadow-lg w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Trash2 className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <h2 id="delete-visit-title" className="font-semibold">Delete Visit?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  This will permanently delete OPD visit{' '}
                  <span className="font-medium text-foreground">{visit.queueNumber > 0 ? `#${visit.queueNumber}` : visit.visitId}</span>{' '}
                  for <span className="font-medium text-foreground">{visit.fullName ?? visit.patientId}</span>. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                Keep Visit
              </Button>
              <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, Delete Visit'}
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
  const [selectedNurseIds,     setSelectedNurseIds]     = useState<string[]>([]);
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

  // Keyboard navigation for the patient suggestions: -1 = nothing highlighted.
  // Reset whenever the result set changes so a stale index never points at a
  // different patient than the one the user saw highlighted.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const suggestionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { setHighlightedIndex(-1); }, [debouncedPSearch, patientData]);
  useEffect(() => {
    if (highlightedIndex < 0) return;
    suggestionRefs.current[highlightedIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightedIndex]);

  const selectPatient = (p: PatientResponse) => {
    setSelectedPatient(p);
    setPatientSearch('');
  };

  const handlePatientSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!debouncedPSearch || fetchingPatients || patients.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % patients.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? patients.length - 1 : i - 1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0 && highlightedIndex < patients.length) {
      // Prevent the surrounding New Visit form from submitting.
      e.preventDefault();
      selectPatient(patients[highlightedIndex]);
    }
  };

  const { data: departmentsData } = useListDepartmentsQuery();
  const departments = departmentsData ?? [];

  const { data: usersData } = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const allDoctors = usersData?.data ?? [];
  const doctors = selectedDepartmentId
    ? allDoctors.filter((d) => d.departmentIds.includes(selectedDepartmentId))
    : allDoctors;

  // Picking a specific department drops any selected doctor who doesn't
  // belong to it (same as the Edit flow's pruning in VisitPanel). Runs in an
  // effect keyed on the doctor list too, so a department picked while the
  // list is still loading prunes once it arrives instead of against an empty
  // list. "All Departments" keeps the current selection.
  useEffect(() => {
    if (!selectedDepartmentId || !usersData) return;
    const list = usersData.data ?? [];
    setSelectedDoctorIds((prev) => {
      const next = prev.filter((id) =>
        list.find((d) => d.userId === id)?.departmentIds.includes(selectedDepartmentId));
      return next.length === prev.length ? prev : next;
    });
  }, [selectedDepartmentId, usersData]);

  // Assign Nurse — doctor-wise, multi-nurse: nurse pool + the primary (first)
  // selected doctor's existing OPD nurse assignments, if any. Nurse selection
  // is optional and keyed to the first doctor picked, mirroring the same
  // "first doctor wins" convention the backend uses to resolve department.
  const { data: availableNursesData } = useGetAvailableOpdNursesQuery();
  const availableNurses = availableNursesData ?? [];
  const primaryDoctorId = selectedDoctorIds[0] ?? '';
  const { data: nurseAssignments } = useGetDoctorNurseAssignmentsQuery(primaryDoctorId, { skip: !primaryDoctorId });
  const assignedNurses = nurseAssignments?.nurses ?? [];

  // Re-sync the nurse suggestions whenever the primary doctor changes: clear
  // first so stale suggestions from the previous doctor never linger while
  // the new lookup is in flight, then pre-fill with every one of the doctor's
  // existing assignments once they resolve (only the ones still available).
  useEffect(() => {
    setSelectedNurseIds([]);
  }, [primaryDoctorId]);

  useEffect(() => {
    if (!nurseAssignments) return;
    const availableAssignedIds = nurseAssignments.nurses.filter((n) => n.isAvailable).map((n) => n.nurseId);
    if (availableAssignedIds.length) {
      setSelectedNurseIds((prev) => [...new Set([...prev, ...availableAssignedIds])]);
    }
  }, [nurseAssignments]);

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
    // Armed synchronously, before any `await` — a second click/Enter firing
    // while this submission is still mid-flight (e.g. during the payment
    // validity re-check below) must see the lock immediately, not only once
    // the createVisit call itself has started. Everything through to the end
    // of the function now runs inside this try, so every early `return`
    // below still releases the lock via `finally`, same as before.
    submittingRef.current = true;
    try {
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

      let visit: OPDVisitResponse;
      try {
        const body: CreateOPDVisitRequest = {
          patientId:      selectedPatient.patientId,
          doctorIds:      selectedDoctorIds.length ? selectedDoctorIds : undefined,
          nurseIds:       selectedNurseIds.length ? selectedNurseIds : undefined,
          // Saved as the visit's department (Pediatric / Non-Pediatric pick the vitals set).
          departmentId:   selectedDepartmentId || undefined,
          visitDate:      form.visitDate || undefined,
          notes:          form.notes    || undefined,
        };
        visit = await createVisit(body).unwrap();
      } catch (err: any) {
        setError(opdErrorMessage(err, 'Failed to create visit.'));
        return;
      }

      // The real queue number is assigned server-side and unknown until this
      // visit syncs (see PENDING_QUEUE_NUMBER in lib/offline/mutation-policy.ts)
      // — e.g. when it was just created offline. Never show a misleading "#-1".
      const visitLabel = visit.queueNumber > 0 ? `Visit #${visit.queueNumber}` : 'Visit (pending sync)';

      if (effectiveRegType === 'paid' && mode) {
        try {
          await createManualPayment({
            patientId:     selectedPatient.patientId,
            amount,
            paymentMethod: mode,
            description:   `OPD Consultation – ${visitLabel}`,
            referenceType: 'OPD_VISIT',
            referenceId:   visit.visitId,
            transactionId: (mode === 'UPI' || mode === 'CARD') && transactionId.trim()
              ? transactionId.trim()
              : undefined,
          }).unwrap();
        } catch (err: any) {
          setError(
            `${visitLabel} was created, but recording the payment failed: ${err?.data?.message ?? 'please record the payment manually.'}`,
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
      <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <h2 className="text-base font-semibold">New OPD Visit</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <NavForm onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
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
                      onKeyDown={handlePatientSearchKeyDown}
                      role="combobox"
                      aria-expanded={!!debouncedPSearch}
                      aria-controls="nv-patient-suggestions"
                      aria-autocomplete="list"
                      aria-activedescendant={
                        highlightedIndex >= 0 ? `nv-patient-option-${highlightedIndex}` : undefined
                      }
                    />
                    {debouncedPSearch && (
                      <div
                        id="nv-patient-suggestions"
                        role="listbox"
                        className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg max-h-48 overflow-y-auto"
                      >
                        {fetchingPatients && (
                          <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
                        )}
                        {!fetchingPatients && patients.length === 0 && (
                          <p className="px-3 py-2 text-sm text-muted-foreground">No patients found.</p>
                        )}
                        {patients.map((p, idx) => (
                          <button
                            key={p.patientId}
                            id={`nv-patient-option-${idx}`}
                            ref={(el) => { suggestionRefs.current[idx] = el; }}
                            type="button"
                            role="option"
                            aria-selected={idx === highlightedIndex}
                            className={`flex flex-col w-full text-left px-3 py-2 hover:bg-muted transition-colors ${
                              idx === highlightedIndex ? 'bg-primary/10 ring-1 ring-inset ring-primary' : ''
                            }`}
                            onMouseEnter={() => setHighlightedIndex(idx)}
                            onClick={() => selectPatient(p)}
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
                  onChange={(e) => setSelectedDepartmentId(e.target.value)}
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
              <Label id="nv-doctors-label">Assign Doctors</Label>
              <PeopleMultiSelect
                labelId="nv-doctors-label"
                noun="doctors"
                options={doctors}
                getLabel={(id) => allDoctors.find((u) => u.userId === id)?.name ?? id}
                selectedIds={selectedDoctorIds}
                onChange={setSelectedDoctorIds}
              />
            </div>

            {/* Nurse — doctor-wise, optional, multi-select (same dropdown as
                Assign Doctors). Keyed off the first assigned doctor, same
                convention the department resolution already uses. */}
            <div className="space-y-1.5">
              <Label id="nv-nurses-label">Assign Nurse (Optional)</Label>
              {primaryDoctorId && assignedNurses.filter((n) => n.isAvailable).length > 0 && (
                <p className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">
                  ✓ Already assigned nurse{assignedNurses.filter((n) => n.isAvailable).length > 1 ? 's' : ''}: {assignedNurses.filter((n) => n.isAvailable).map((n) => n.nurseName ?? n.nurseId).join(', ')}
                </p>
              )}
              {primaryDoctorId && assignedNurses.filter((n) => !n.isAvailable).length > 0 && (
                <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                  {assignedNurses.filter((n) => !n.isAvailable).map((n) => n.nurseName ?? n.nurseId).join(', ')} {assignedNurses.filter((n) => !n.isAvailable).length > 1 ? 'are' : 'is'} currently on IPD ward duty — select another nurse.
                </p>
              )}
              {availableNurses.length === 0 && selectedNurseIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">No available nurses</p>
              ) : (
                <PeopleMultiSelect
                  labelId="nv-nurses-label"
                  noun="nurses"
                  options={availableNurses}
                  getLabel={(id) =>
                    availableNurses.find((u) => u.userId === id)?.name
                    ?? assignedNurses.find((a) => a.nurseId === id)?.nurseName
                    ?? id}
                  selectedIds={selectedNurseIds}
                  onChange={setSelectedNurseIds}
                />
              )}
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
          </div>

          <div className="flex justify-end gap-3 shrink-0 px-5 pb-5">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !selectedPatient}>
              {isLoading ? 'Creating…' : 'Create Visit'}
            </Button>
          </div>
        </NavForm>
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

const OPD_QUEUE_PAGE_SIZE = 20;

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
  const [page,            setPage]            = useState(1);
  const [selectedVisit, setSelectedVisit] = useState<OPDVisitResponse | null>(null);
  const [showNewVisit,  setShowNewVisit]  = useState(false);

  // Only an actual change of term resets to page 1 — otherwise the mount-time
  // run would yank the user back to page 1 if they paged within 400ms.
  useEffect(() => {
    if (filterSearch === debouncedSearch) return;
    const t = setTimeout(() => { setDebouncedSearch(filterSearch); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [filterSearch, debouncedSearch]);

  const { data: queue, isFetching, refetch } = useGetOPDQueueQuery({
    date:     filterDate,
    doctorId: filterDoctor    || undefined,
    search:   debouncedSearch || undefined,
    page,
    limit:    OPD_QUEUE_PAGE_SIZE,
  });

  // A visit removed from the last page (delete/cancel) can leave `page` past
  // the end — step back so the table never sits on an empty page.
  // Skipped while a fetch is in flight so a stale previous-args result never
  // drives the clamp.
  useEffect(() => {
    if (!isFetching && queue && page > 1 && page > queue.totalPages) setPage(Math.max(1, queue.totalPages));
  }, [isFetching, queue, page]);

  const { data: usersData } = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const doctors = usersData?.data ?? [];

  const doctorNames = useCallback((ids: string[]) => {
    if (!ids?.length) return 'Unassigned';
    return ids.map((id) => {
      const d = doctors.find((u) => u.userId === id);
      return d ? d.name : id;
    }).join(', ');
  }, [doctors]);

  // Name resolution for the OPD View/Visit Details panel's Nurse(s) row —
  // same pattern as doctorNames above.
  const { data: nurseUsersData } = useListUsersQuery({ role: 'NURSE', isActive: true, limit: 100 });
  const nurses = nurseUsersData?.data ?? [];

  const nurseNames = useCallback((ids: string[]) => {
    if (!ids?.length) return 'Unassigned';
    return ids.map((id) => {
      const n = nurses.find((u) => u.userId === id);
      return n ? n.name : id;
    }).join(', ');
  }, [nurses]);

  const visits     = queue?.data ?? [];
  const total      = queue?.total ?? visits.length;
  const totalPages = queue?.totalPages ?? 1;
  // Upper bound counts the rows actually returned, so the offline-cache
  // fallback (all rows on one page) still reads "1–N of N".
  const rangeStart = total === 0 ? 0 : (page - 1) * OPD_QUEUE_PAGE_SIZE + 1;
  const rangeEnd   = total === 0 ? 0 : Math.min((page - 1) * OPD_QUEUE_PAGE_SIZE + visits.length, total);
  // Day-wise S. No.: the queue is always one IST calendar day (filterDate),
  // ordered oldest-created first (opd.repository.ts QUEUE_SORT), so the page
  // offset numbering restarts at 1 for each day and new visits land last.
  const serialStart = serialOffset(queue, page, OPD_QUEUE_PAGE_SIZE);

  // DOCTOR is deliberately excluded — doctors may view/act on visits assigned to
  // them but must not be able to create new OPD visits (also enforced server-side).
  // NURSE is view-only on Doctor Visits — no create/edit/complete/cancel (also
  // enforced server-side).
  const canCreateVisit = ['RECEPTIONIST', 'HOSPITAL_ADMIN', 'MANAGER'].includes(role ?? '');
  const canEdit        = ['DOCTOR', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canComplete    = ['DOCTOR', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canCancel      = ['DOCTOR', 'HOSPITAL_ADMIN'].includes(role ?? '');
  // RECEPTIONIST deletes instead of cancelling (DELETE /api/opd/visits/:visitId).
  const canDelete      = role === 'RECEPTIONIST';
  const canViewPayment = PAYMENT_VIEW_ROLES.includes(role ?? '');

  // Queue stats
  // Server-side counts span every page; the offline-cache fallback (one
  // unpaginated page, no counts) derives them from the rows it has.
  const open      = queue?.openCount      ?? visits.filter((v) => v.status === 'OPEN').length;
  const completed = queue?.completedCount ?? visits.filter((v) => v.status === 'COMPLETED').length;

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
            <p className="text-2xl font-bold">{total}</p>
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
                onChange={(e) => { setFilterDate(e.target.value); setPage(1); }}
                className="flex-1 sm:w-40 sm:flex-none"
              />
            </div>

            {/* Doctor */}
            <div className="flex items-center gap-2">
              <Label htmlFor="filterDoc" className="shrink-0 text-sm w-14 sm:w-auto">Doctor</Label>
              <select
                id="filterDoc"
                value={filterDoctor}
                onChange={(e) => { setFilterDoctor(e.target.value); setPage(1); }}
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
                  placeholder="Patient name or UHID…"
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
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16 whitespace-nowrap">S. No.</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Doctor</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v, idx) => (
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
                      <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">{serialNumber(serialStart, idx)}</td>
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

      {/* Pagination + count */}
      {queue && !isFetching && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
          <span>
            {total === 0
              ? 'No visits'
              : `Showing ${rangeStart}–${rangeEnd} of ${total} visit${total !== 1 ? 's' : ''}`}
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
      )}

      {/* Visit detail panel */}
      {selectedVisit && (
        <VisitPanel
          visit={selectedVisit}
          onClose={() => setSelectedVisit(null)}
          onUpdate={(updated) => setSelectedVisit(updated)}
          canEdit={canEdit}
          canComplete={canComplete}
          canCancel={canCancel}
          canDelete={canDelete}
          canViewPayment={canViewPayment}
          doctorNames={doctorNames}
          allDoctors={doctors}
          nurseNames={nurseNames}
        />
      )}

      {/* New visit modal */}
      {showNewVisit && (
        <NewVisitModal onClose={() => setShowNewVisit(false)} />
      )}
    </div>
  );
}
