'use client';

import { useState } from 'react';
import {
  useCreatePatientMutation,
  useUpdatePatientMutation,
} from '@/store/api/patient.api';
import type { PatientResponse, Gender, BloodGroup, CreatePatientRequest, UpdatePatientRequest } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { X, AlertTriangle } from 'lucide-react';
import { INDIAN_STATES } from '@/lib/constants';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const GENDERS: Gender[] = ['MALE', 'FEMALE', 'OTHER'];
export const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
// Matches backend: z.string().regex(/^\d{10}$/) — exactly 10 digits.
// The national number is stored bare; the +91 country code is shown in the UI only.
const MOBILE_RE   = /^\d{10}$/;
const NAME_RE     = /^[a-zA-Z\s.\-']+$/;
const AADHAAR_RE  = /^\d{12}$/;

export function genderLabel(g: Gender) {
  return g.charAt(0) + g.slice(1).toLowerCase();
}

// Keep digits only; drop a leading 91 country code (e.g. legacy +91XXXXXXXXXX); cap at 10.
function sanitizeMobile(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  return digits.slice(0, 10);
}

// Compose the structured address fields into the single `address` string that the
// backend stores and the medical card / detail view render.
function composeAddress(f: CreatePatientRequest): string {
  const parts = [f.addressLine1, f.addressLine2, f.city, f.state]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  let out = parts.join(', ');
  const pin = (f.pincode ?? '').trim();
  if (pin) out += ` - ${pin}`;
  const country = (f.country ?? '').trim();
  if (country) out += `${out ? ', ' : ''}${country}`;
  return out;
}

// Address payload sent on create/update: the derived `address` plus the structured
// fields (empty optionals normalised to undefined so backend validation passes).
function addressPayload(f: CreatePatientRequest) {
  return {
    address:      composeAddress(f),
    addressLine1: f.addressLine1?.trim() || undefined,
    addressLine2: f.addressLine2?.trim() || undefined,
    city:         f.city?.trim()         || undefined,
    state:        f.state?.trim()        || undefined,
    country:      f.country?.trim()      || undefined,
    pincode:      f.pincode?.trim()      || undefined,
  };
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
  } else if (!MOBILE_RE.test(form.mobileNumber)) {
    errors.mobileNumber = 'Enter a valid 10-digit mobile number.';
  }

  if (!form.addressLine1 || !form.addressLine1.trim()) {
    errors.addressLine1 = 'Address line 1 is required.';
  } else if (form.addressLine1.trim().length > 200) {
    errors.addressLine1 = 'Address line 1 must be 200 characters or fewer.';
  }
  if (!form.city || !form.city.trim()) {
    errors.city = 'City is required.';
  }
  if (!form.state || !form.state.trim()) {
    errors.state = 'State is required.';
  }
  if (!form.pincode || !form.pincode.trim()) {
    errors.pincode = 'Pincode is required.';
  } else if (!/^\d{6}$/.test(form.pincode.trim())) {
    errors.pincode = 'Pincode must be exactly 6 digits.';
  }

  if (form.aadhaarNumber && !AADHAAR_RE.test(form.aadhaarNumber)) {
    errors.aadhaarNumber = 'Aadhaar must be exactly 12 digits.';
  }

  if (form.emergencyContactName && form.emergencyContactName.trim().length < 2) {
    errors.emergencyContactName = 'Name must be at least 2 characters.';
  }

  if (form.emergencyContactMobile && !MOBILE_RE.test(form.emergencyContactMobile)) {
    errors.emergencyContactMobile = 'Enter a valid 10-digit mobile number.';
  }

  return errors;
}

// ─── Register / Edit Modal ────────────────────────────────────────────────────
//
// Shared across the Patients page (Register Patient / Edit Patient) and the OPD
// New Visit flow (Add Patient) so both entry points use the exact same form,
// validation, and submission logic — no duplicated patient-registration code.

export interface PatientFormModalProps {
  mode:       'register' | 'edit';
  initial?:   PatientResponse;
  onClose:    () => void;
  onSuccess?: (p: PatientResponse) => void;
}

export function PatientFormModal({ mode, initial, onClose, onSuccess }: PatientFormModalProps) {
  const [form, setForm] = useState<CreatePatientRequest>({
    fullName:               initial?.fullName               ?? '',
    dateOfBirth:            initial?.dateOfBirth ? initial.dateOfBirth.substring(0, 10) : '',
    gender:                 initial?.gender                 ?? 'MALE',
    mobileNumber:           sanitizeMobile(initial?.mobileNumber ?? ''),
    address:                initial?.address                ?? '',
    addressLine1:           initial?.addressLine1           ?? '',
    addressLine2:           initial?.addressLine2           ?? '',
    city:                   initial?.city                   ?? '',
    state:                  initial?.state                  ?? '',
    country:                'India',
    pincode:                initial?.pincode                ?? '',
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
          ...addressPayload(form),
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
          ...addressPayload(form),
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
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
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
                  Patient already exists — a patient with this name and mobile number already exists (ID:{' '}
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
              <div className="flex">
                <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground select-none">+91</span>
                <Input
                  id="mobile"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.mobileNumber}
                  onChange={(e) => set('mobileNumber', sanitizeMobile(e.target.value))}
                  onBlur={() => touch('mobileNumber')}
                  placeholder="XXXXXXXXXX"
                  aria-invalid={!!fe('mobileNumber')}
                  className={`${inputClass('mobileNumber')} rounded-l-none`}
                />
              </div>
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

            <div className="sm:col-span-2 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="addressLine1">Address Line 1 *</Label>
                <Input
                  id="addressLine1"
                  value={form.addressLine1 ?? ''}
                  onChange={(e) => set('addressLine1', e.target.value)}
                  onBlur={() => touch('addressLine1')}
                  placeholder="House/Flat No., Building, Street"
                  maxLength={200}
                  aria-invalid={!!fe('addressLine1')}
                  className={inputClass('addressLine1')}
                />
                {fe('addressLine1') && <p className="text-xs text-destructive">{fe('addressLine1')}</p>}
              </div>

              <div className="space-y-1">
                <Label htmlFor="addressLine2">Address Line 2</Label>
                <Input
                  id="addressLine2"
                  value={form.addressLine2 ?? ''}
                  onChange={(e) => set('addressLine2', e.target.value)}
                  placeholder="Area, Landmark - Optional"
                  maxLength={200}
                  className={inputClass('addressLine2')}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="pincode">Pincode *</Label>
                  <Input
                    id="pincode"
                    inputMode="numeric"
                    value={form.pincode ?? ''}
                    onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onBlur={() => touch('pincode')}
                    placeholder="6-digit PIN"
                    maxLength={6}
                    aria-invalid={!!fe('pincode')}
                    className={inputClass('pincode')}
                  />
                  {fe('pincode') && <p className="text-xs text-destructive">{fe('pincode')}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="city">City *</Label>
                  <Input
                    id="city"
                    value={form.city ?? ''}
                    onChange={(e) => set('city', e.target.value)}
                    onBlur={() => touch('city')}
                    placeholder="City"
                    maxLength={100}
                    aria-invalid={!!fe('city')}
                    className={inputClass('city')}
                  />
                  {fe('city') && <p className="text-xs text-destructive">{fe('city')}</p>}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="state">State *</Label>
                <select
                  id="state"
                  value={form.state ?? ''}
                  onChange={(e) => set('state', e.target.value)}
                  onBlur={() => touch('state')}
                  aria-invalid={!!fe('state')}
                  className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${inputClass('state')}`}
                >
                  <option value="">— Select state —</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {fe('state') && <p className="text-xs text-destructive">{fe('state')}</p>}
              </div>
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
                <div className="flex">
                  <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground select-none">+91</span>
                  <Input
                    id="ecMobile"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={form.emergencyContactMobile ?? ''}
                    onChange={(e) => set('emergencyContactMobile', sanitizeMobile(e.target.value))}
                    onBlur={() => touch('emergencyContactMobile')}
                    placeholder="XXXXXXXXXX"
                    aria-invalid={!!fe('emergencyContactMobile')}
                    className={`${inputClass('emergencyContactMobile')} rounded-l-none`}
                  />
                </div>
                {fe('emergencyContactMobile') && <p className="text-xs text-destructive">{fe('emergencyContactMobile')}</p>}
              </div>
            </div>
          </details>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !!duplicateInfo || hasErrors}>
              {isLoading ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Register Patient'}
            </Button>
          </div>
        </form>
      </div>
    </DialogOverlay>
  );
}
