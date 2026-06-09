'use client';

import { useState, useEffect } from 'react';
import {
  useSearchPatientsQuery,
  useCreatePatientMutation,
  useUpdatePatientMutation,
  useDownloadMedicalCardMutation,
  useDeletePatientMutation,
} from '@/store/api/patient.api';
import { useGetOPDPatientHistoryQuery } from '@/store/api/opd.api';
import { useAppSelector } from '@/store/hooks';
import type { PatientResponse, Gender, BloodGroup, CreatePatientRequest, UpdatePatientRequest, OPDVisitResponse } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import {
  Search,
  UserPlus,
  Download,
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Pencil,
  ClipboardList,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import { toastSuccess } from '@/lib/toast';
import { UserRole } from '@/store/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GENDERS: Gender[] = ['MALE', 'FEMALE', 'OTHER'];
const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
// Matches backend: z.string().min(7).max(15).regex(/^\+?[0-9]+$/)
// Total length 7–15 chars; optional leading +; digits only.
const MOBILE_RE   = /^\+?[0-9]+$/;
const NAME_RE     = /^[a-zA-Z\s.\-']+$/;
const AADHAAR_RE  = /^\d{12}$/;

function genderLabel(g: Gender) {
  return g.charAt(0) + g.slice(1).toLowerCase();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function calcAge(dob: string) {
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

function sanitizeMobile(value: string) {
  const cleaned = value.replace(/[^\d+]/g, '');
  return cleaned.startsWith('+')
    ? `+${cleaned.slice(1).replace(/\+/g, '')}`.slice(0, 16)
    : cleaned.replace(/\+/g, '').slice(0, 15);
}

type PatientFormErrors = Partial<Record<string, string>>;

function validatePatientForm(form: CreatePatientRequest): PatientFormErrors {
  const errors: PatientFormErrors = {};

  const name = form.fullName.trim();
  if (!name) {
    errors.fullName = 'Full name is required.';
  } else if (name.length < 2) {
    errors.fullName = 'Name must be at least 2 characters.';
  } else if (name.length > 100) {
    errors.fullName = 'Name must be 100 characters or fewer.';
  } else if (!NAME_RE.test(name)) {
    errors.fullName = 'Name can only contain letters, spaces, dots, hyphens, and apostrophes.';
  }

  if (!form.dateOfBirth) {
    errors.dateOfBirth = 'Date of birth is required.';
  } else {
    const dob   = new Date(form.dateOfBirth);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ageYears = (today.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (dob >= today) {
      errors.dateOfBirth = 'Date of birth must be in the past.';
    } else if (ageYears > 150) {
      errors.dateOfBirth = 'Please enter a valid date of birth.';
    }
  }

  if (!form.mobileNumber) {
    errors.mobileNumber = 'Mobile number is required.';
  } else if (
    !MOBILE_RE.test(form.mobileNumber) ||
    form.mobileNumber.length < 9 ||
    form.mobileNumber.length > 12
  ) {
    errors.mobileNumber = 'Enter a valid mobile number (9–12 characters, optional leading +).';
  }

  const addr = form.address.trim();
  if (!addr) {
    errors.address = 'Address is required.';
  } else if (addr.length < 10) {
    errors.address = 'Address must be at least 10 characters.';
  } else if (addr.length > 300) {
    errors.address = 'Address must be 300 characters or fewer.';
  }

  if (form.aadhaarNumber && !AADHAAR_RE.test(form.aadhaarNumber)) {
    errors.aadhaarNumber = 'Aadhaar must be exactly 12 digits.';
  }

  if (form.emergencyContactName && form.emergencyContactName.trim().length < 2) {
    errors.emergencyContactName = 'Name must be at least 2 characters.';
  }

  if (
    form.emergencyContactMobile &&
    (!MOBILE_RE.test(form.emergencyContactMobile) ||
     form.emergencyContactMobile.length < 9 ||
     form.emergencyContactMobile.length > 12)
  ) {
    errors.emergencyContactMobile = 'Enter a valid mobile number (9–12 characters, optional leading +).';
  }

  return errors;
}

// ─── OPD status helpers ───────────────────────────────────────────────────────

function visitStatusVariant(s: OPDVisitResponse['status']): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (s === 'OPEN')        return 'default';
  if (s === 'IN_PROGRESS') return 'secondary';
  if (s === 'COMPLETED')   return 'outline';
  return 'destructive';
}

// ─── Register / Edit Modal ────────────────────────────────────────────────────

interface PatientFormModalProps {
  mode:       'register' | 'edit';
  initial?:   PatientResponse;
  onClose:    () => void;
  onSuccess?: (p: PatientResponse) => void;
}

function PatientFormModal({ mode, initial, onClose, onSuccess }: PatientFormModalProps) {
  const [form, setForm] = useState<CreatePatientRequest>({
    fullName:               initial?.fullName               ?? '',
    dateOfBirth:            initial?.dateOfBirth ? initial.dateOfBirth.substring(0, 10) : '',
    gender:                 initial?.gender                 ?? 'MALE',
    mobileNumber:           sanitizeMobile(initial?.mobileNumber ?? ''),
    address:                initial?.address                ?? '',
    aadhaarNumber:          initial?.aadhaarNumber          ?? '',
    emergencyContactName:   initial?.emergencyContactName   ?? '',
    emergencyContactMobile: sanitizeMobile(initial?.emergencyContactMobile ?? ''),
    bloodGroup:             initial?.bloodGroup             ?? undefined,
    forceCreate:            false,
  });

  const [touched,       setTouched]       = useState<Partial<Record<string, boolean>>>({});
  const [submitted,     setSubmitted]     = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<{ existingPatientId: string } | null>(null);
  const [apiError,      setApiError]      = useState('');

  const [createPatient, { isLoading: creating }] = useCreatePatientMutation();
  const [updatePatient, { isLoading: updating }] = useUpdatePatientMutation();
  const isLoading = creating || updating;

  const errors   = validatePatientForm(form);
  const hasErrors = Object.keys(errors).length > 0;

  function set(field: keyof CreatePatientRequest, value: string | boolean | undefined) {
    setForm((f) => ({ ...f, [field]: value }));
    setApiError('');
    setDuplicateInfo(null);
  }

  function touch(field: string) {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  function fe(field: string): string | undefined {
    return (submitted || touched[field]) ? errors[field] : undefined;
  }

  function inputClass(field: string) {
    return fe(field) ? 'border-destructive focus-visible:ring-destructive' : '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setApiError('');
    setDuplicateInfo(null);

    if (hasErrors) return;

    try {
      if (mode === 'edit' && initial) {
        const body: UpdatePatientRequest = {
          fullName:               form.fullName,
          dateOfBirth:            form.dateOfBirth,
          gender:                 form.gender,
          mobileNumber:           form.mobileNumber,
          address:                form.address,
          aadhaarNumber:          form.aadhaarNumber          || undefined,
          emergencyContactName:   form.emergencyContactName   || undefined,
          emergencyContactMobile: form.emergencyContactMobile || undefined,
          bloodGroup:             form.bloodGroup,
        };
        const result = await updatePatient({ patientId: initial.patientId, ...body }).unwrap();
        onSuccess?.(result);
        onClose();
      } else {
        const body: CreatePatientRequest = {
          ...form,
          aadhaarNumber:          form.aadhaarNumber          || undefined,
          emergencyContactName:   form.emergencyContactName   || undefined,
          emergencyContactMobile: form.emergencyContactMobile || undefined,
          bloodGroup:             form.bloodGroup             || undefined,
        };
        const result = await createPatient(body).unwrap();
        onSuccess?.(result);
        onClose();
      }
    } catch (err: any) {
      const payload = err?.data;
      if (payload?.data?.isDuplicateWarning) {
        setDuplicateInfo({ existingPatientId: payload.data.existingPatientId });
      } else {
        setApiError(payload?.message ?? 'Something went wrong. Please try again.');
      }
    }
  }

  async function handleForceCreate() {
    setApiError('');
    if (hasErrors) return;
    try {
      const body: CreatePatientRequest = {
        ...form,
        aadhaarNumber:          form.aadhaarNumber          || undefined,
        emergencyContactName:   form.emergencyContactName   || undefined,
        emergencyContactMobile: form.emergencyContactMobile || undefined,
        bloodGroup:             form.bloodGroup             || undefined,
        forceCreate:            true,
      };
      const result = await createPatient(body).unwrap();
      onSuccess?.(result);
      onClose();
    } catch (err: any) {
      setApiError(err?.data?.message ?? 'Something went wrong.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">
            {mode === 'edit' ? 'Edit Patient' : 'Register New Patient'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-6 space-y-5">
          {/* Duplicate warning */}
          {duplicateInfo && (
            <div className="flex gap-3 rounded-md border border-yellow-400 bg-yellow-50 p-4 text-sm text-yellow-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>
                  A patient with this mobile number already exists (ID:{' '}
                  <strong>{duplicateInfo.existingPatientId}</strong>). Do you want to register anyway?
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={handleForceCreate} disabled={isLoading}>
                    Yes, register anyway
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDuplicateInfo(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          {apiError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{apiError}</p>
          )}

          {/* Required fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                onBlur={() => touch('fullName')}
                placeholder="Enter full name"
                aria-invalid={!!fe('fullName')}
                className={inputClass('fullName')}
              />
              {fe('fullName') && <p className="text-xs text-destructive">{fe('fullName')}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="dob">Date of Birth *</Label>
              <Input
                id="dob"
                type="date"
                value={form.dateOfBirth}
                max={new Date().toISOString().substring(0, 10)}
                onChange={(e) => set('dateOfBirth', e.target.value)}
                onBlur={() => touch('dateOfBirth')}
                aria-invalid={!!fe('dateOfBirth')}
                className={inputClass('dateOfBirth')}
              />
              {fe('dateOfBirth') && <p className="text-xs text-destructive">{fe('dateOfBirth')}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="gender">Gender *</Label>
              <select
                id="gender"
                value={form.gender}
                onChange={(e) => set('gender', e.target.value as Gender)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {GENDERS.map((g) => (
                  <option key={g} value={g}>{genderLabel(g)}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="mobile">Mobile Number *</Label>
              <Input
                id="mobile"
                type="tel"
                inputMode="tel"
                maxLength={16}
                value={form.mobileNumber}
                onChange={(e) => set('mobileNumber', sanitizeMobile(e.target.value))}
                onBlur={() => touch('mobileNumber')}
                placeholder="+91XXXXXXXXXX"
                aria-invalid={!!fe('mobileNumber')}
                className={inputClass('mobileNumber')}
              />
              {fe('mobileNumber') && <p className="text-xs text-destructive">{fe('mobileNumber')}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="bloodGroup">Blood Group</Label>
              <select
                id="bloodGroup"
                value={form.bloodGroup ?? ''}
                onChange={(e) => set('bloodGroup', e.target.value as BloodGroup || undefined)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Select —</option>
                {BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>{bg}</option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="address">Address *</Label>
              <textarea
                id="address"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                onBlur={() => touch('address')}
                placeholder="Full address"
                rows={2}
                aria-invalid={!!fe('address')}
                className={`flex w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none ${fe('address') ? 'border-destructive focus:ring-destructive' : 'border-input'}`}
              />
              {fe('address') && <p className="text-xs text-destructive">{fe('address')}</p>}
            </div>
          </div>

          {/* Optional fields */}
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
              Optional details (Aadhaar, emergency contact)
            </summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="aadhaar">Aadhaar Number</Label>
                <Input
                  id="aadhaar"
                  value={form.aadhaarNumber ?? ''}
                  onChange={(e) => set('aadhaarNumber', e.target.value.replace(/\D/g, '').slice(0, 12))}
                  onBlur={() => touch('aadhaarNumber')}
                  placeholder="12-digit Aadhaar"
                  maxLength={12}
                  inputMode="numeric"
                  aria-invalid={!!fe('aadhaarNumber')}
                  className={inputClass('aadhaarNumber')}
                />
                {fe('aadhaarNumber') && <p className="text-xs text-destructive">{fe('aadhaarNumber')}</p>}
              </div>

              <div className="space-y-1">
                <Label htmlFor="ecName">Emergency Contact Name</Label>
                <Input
                  id="ecName"
                  value={form.emergencyContactName ?? ''}
                  onChange={(e) => set('emergencyContactName', e.target.value)}
                  onBlur={() => touch('emergencyContactName')}
                  placeholder="Contact name"
                  aria-invalid={!!fe('emergencyContactName')}
                  className={inputClass('emergencyContactName')}
                />
                {fe('emergencyContactName') && <p className="text-xs text-destructive">{fe('emergencyContactName')}</p>}
              </div>

              <div className="space-y-1">
                <Label htmlFor="ecMobile">Emergency Contact Mobile</Label>
                <Input
                  id="ecMobile"
                  type="tel"
                  inputMode="tel"
                  maxLength={16}
                  value={form.emergencyContactMobile ?? ''}
                  onChange={(e) => set('emergencyContactMobile', sanitizeMobile(e.target.value))}
                  onBlur={() => touch('emergencyContactMobile')}
                  placeholder="+91XXXXXXXXXX"
                  aria-invalid={!!fe('emergencyContactMobile')}
                  className={inputClass('emergencyContactMobile')}
                />
                {fe('emergencyContactMobile') && <p className="text-xs text-destructive">{fe('emergencyContactMobile')}</p>}
              </div>
            </div>
          </details>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !!duplicateInfo}>
              {isLoading ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Register Patient'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Patient Detail Panel ─────────────────────────────────────────────────────

interface PatientDetailPanelProps {
  patient:   PatientResponse;
  onClose:   () => void;
  onEdit:    () => void;
  onDeleted: () => void;
}

function PatientDetailPanel({ patient, onClose, onEdit, onDeleted }: PatientDetailPanelProps) {
  const role = useAppSelector((s) => s.auth.profile?.role);
  const canDelete = role === UserRole.ADMIN || role === UserRole.MANAGER || role === UserRole.HOSPITAL_ADMIN;

  const [tab,           setTab]           = useState<'details' | 'history'>('details');
  const [historyPage,   setHistoryPage]   = useState(1);
  const [downloadCard, { isLoading: downloading }] = useDownloadMedicalCardMutation();
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [deletePatient, { isLoading: isDeleting }] = useDeletePatientMutation();
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [deleteError,   setDeleteError]   = useState<string | undefined>();

  async function handleDelete() {
    setDeleteError(undefined);
    try {
      await deletePatient(patient.patientId).unwrap();
      toastSuccess('Patient record deleted.');
      onDeleted();
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message
        ?? 'Failed to delete patient.';
      setDeleteError(msg);
    }
  }

  const { data: historyData, isLoading: historyLoading } = useGetOPDPatientHistoryQuery(
    { patientId: patient.patientId, page: historyPage, limit: 10 },
    { skip: tab !== 'history' },
  );

  const visits      = historyData?.data  ?? [];
  const totalVisits = historyData?.total ?? 0;
  const totalPages  = Math.ceil(totalVisits / 10) || 1;

  async function handleDownload() {
    setDownloadError(null);
    const result = await downloadCard(patient.patientId);
    if ('data' in result && result.data) {
      const a = document.createElement('a');
      a.href = result.data;
      a.download = `medical-card-${patient.patientId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(result.data!), 100);
    } else {
      setDownloadError('Failed to download medical card. Please try again.');
    }
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-5 gap-2 py-2 border-b last:border-0">
      <span className="col-span-2 text-sm text-muted-foreground">{label}</span>
      <span className="col-span-3 text-sm font-medium break-words">{value ?? '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="relative flex flex-col h-full w-full max-w-md bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <div>
            <p className="text-xs text-muted-foreground">{patient.patientId}</p>
            <h2 className="text-base font-semibold">{patient.fullName}</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b shrink-0">
          {(['details', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === t
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t === 'details'
                ? <><Pencil className="h-3.5 w-3.5" /> Details</>
                : <><ClipboardList className="h-3.5 w-3.5" /> OPD History</>}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'details' && (
            <div className="p-5 space-y-1">
              {row('Date of Birth', `${formatDate(patient.dateOfBirth)} (${calcAge(patient.dateOfBirth)} yrs)`)}
              {row('Gender',        genderLabel(patient.gender))}
              {row('Mobile',        patient.mobileNumber)}
              {row('Blood Group',   patient.bloodGroup)}
              {row('Aadhaar',       patient.aadhaarNumber)}
              {row('Address',       patient.address)}
              {row('EC Name',       patient.emergencyContactName)}
              {row('EC Mobile',     patient.emergencyContactMobile)}
              {row('Registered',    formatDate(patient.createdAt))}
            </div>
          )}

          {tab === 'history' && (
            <div className="p-5 space-y-3">
              {historyLoading ? (
                <p className="text-sm text-muted-foreground text-center py-10">Loading history…</p>
              ) : visits.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Stethoscope className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No OPD visits recorded.</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{totalVisits} visit{totalVisits !== 1 ? 's' : ''} total</p>
                  {visits.map((v) => (
                    <div key={v.visitId} className="rounded-lg border bg-card p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {new Date(v.visitDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            <span className="ml-2 text-xs text-muted-foreground font-normal">Queue #{v.queueNumber}</span>
                          </p>
                        </div>
                        <Badge variant={visitStatusVariant(v.status)} className="text-xs shrink-0">
                          {v.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p><span className="font-medium text-foreground">Complaint:</span> {v.chiefComplaint}</p>
                        {v.diagnosis    && <p><span className="font-medium text-foreground">Diagnosis:</span> {v.diagnosis}</p>}
                        {v.prescription && <p><span className="font-medium text-foreground">Prescription:</span> {v.prescription}</p>}
                        {v.notes        && <p><span className="font-medium text-foreground">Notes:</span> {v.notes}</p>}
                      </div>
                    </div>
                  ))}

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted-foreground">Page {historyPage} of {totalPages}</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => p - 1)}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" disabled={historyPage >= totalPages} onClick={() => setHistoryPage((p) => p + 1)}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {downloadError && (
          <div className="mx-5 mb-0 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {downloadError}
          </div>
        )}

        {/* Delete confirmation inline */}
        {showConfirm && (
          <div className="mx-5 mb-0 rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
            <p className="text-sm font-medium text-destructive">Delete this patient?</p>
            <p className="text-xs text-muted-foreground">
              This action cannot be undone. All clinical history will be archived.
            </p>
            {deleteError && (
              <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{deleteError}</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => { setShowConfirm(false); setDeleteError(undefined); }} disabled={isDeleting}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" className="flex-1" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? 'Deleting…' : 'Confirm Delete'}
              </Button>
            </div>
          </div>
        )}

        <div className="shrink-0 flex gap-3 p-5 border-t">
          <Button variant="outline" className="flex-1" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button className="flex-1" onClick={handleDownload} disabled={downloading}>
            <Download className="h-4 w-4 mr-2" />
            {downloading ? 'Downloading…' : 'Medical Card'}
          </Button>
          {canDelete && (
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => { setShowConfirm(true); setDeleteError(undefined); }}
              title="Delete Patient"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PatientsPage() {
  const role = useAppSelector((s) => s.auth.profile?.role);

  const [search,          setSearch]          = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page,            setPage]            = useState(1);
  const [showRegister,    setShowRegister]    = useState(false);
  const [selected,        setSelected]        = useState<PatientResponse | null>(null);
  const [editing,         setEditing]         = useState(false);

  // Debounce search input by 400 ms
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = useSearchPatientsQuery({ q: debouncedSearch || undefined, page, limit: 10 });

  const patients    = data?.data    ?? [];
  const totalPages  = data ? Math.ceil(data.total / 20) : 1;

  const canRegister = role === 'RECEPTIONIST' || role === 'NURSE' || role === 'HOSPITAL_ADMIN';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Patients</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.total} patient${data.total !== 1 ? 's' : ''} found` : 'Search or browse patients'}
          </p>
        </div>
        {canRegister && (
          <Button onClick={() => setShowRegister(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Register Patient
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name, mobile, or patient ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Results table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Patient List</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isFetching ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : patients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
              <Search className="h-8 w-8 opacity-30" />
              {debouncedSearch ? `No patients found for "${debouncedSearch}"` : 'No patients registered yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient ID</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Age / Gender</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Mobile</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Blood Group</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((p) => (
                    <tr
                      key={p.patientId}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => { setSelected(p); setEditing(false); }}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.patientId}</td>
                      <td className="px-4 py-3 font-medium">{p.fullName}</td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                        {calcAge(p.dateOfBirth)} yrs · {genderLabel(p.gender)}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{p.mobileNumber}</td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {p.bloodGroup ? (
                          <Badge variant="outline">{p.bloodGroup}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={(e) => { e.stopPropagation(); setSelected(p); setEditing(false); }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Register modal */}
      {showRegister && (
        <PatientFormModal
          mode="register"
          onClose={() => setShowRegister(false)}
        />
      )}

      {/* Patient detail slide-over */}
      {selected && !editing && (
        <PatientDetailPanel
          patient={selected}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(true)}
          onDeleted={() => setSelected(null)}
        />
      )}

      {/* Edit modal */}
      {selected && editing && (
        <PatientFormModal
          mode="edit"
          initial={selected}
          onClose={() => { setEditing(false); setSelected(null); }}
          onSuccess={(updated) => setSelected(updated)}
        />
      )}
    </div>
  );
}
