'use client';

import { useState, useEffect } from 'react';
import {
  useSearchPatientsQuery,
  useCreatePatientMutation,
  useUpdatePatientMutation,
  useDownloadMedicalCardMutation,
} from '@/store/api/patient.api';
import { useAppSelector } from '@/store/hooks';
import type { PatientResponse, Gender, BloodGroup, CreatePatientRequest, UpdatePatientRequest } from '@/store/types';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GENDERS: Gender[] = ['MALE', 'FEMALE', 'OTHER'];
const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

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
    mobileNumber:           initial?.mobileNumber           ?? '',
    address:                initial?.address                ?? '',
    aadhaarNumber:          initial?.aadhaarNumber          ?? '',
    emergencyContactName:   initial?.emergencyContactName   ?? '',
    emergencyContactMobile: initial?.emergencyContactMobile ?? '',
    bloodGroup:             initial?.bloodGroup             ?? undefined,
    forceCreate:            false,
  });

  const [duplicateInfo, setDuplicateInfo] = useState<{ existingPatientId: string } | null>(null);
  const [error, setError]   = useState('');

  const [createPatient, { isLoading: creating }] = useCreatePatientMutation();
  const [updatePatient, { isLoading: updating }] = useUpdatePatientMutation();
  const isLoading = creating || updating;

  function set(field: keyof CreatePatientRequest, value: string | boolean | undefined) {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
    setDuplicateInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setDuplicateInfo(null);

    try {
      if (mode === 'edit' && initial) {
        const body: UpdatePatientRequest = {
          fullName:               form.fullName,
          dateOfBirth:            form.dateOfBirth,
          gender:                 form.gender,
          mobileNumber:           form.mobileNumber,
          address:                form.address,
          aadhaarNumber:          form.aadhaarNumber   || undefined,
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
        setError(payload?.message ?? 'Something went wrong. Please try again.');
      }
    }
  }

  async function handleForceCreate() {
    setError('');
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
      setError(err?.data?.message ?? 'Something went wrong.');
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

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
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

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          {/* Required fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                placeholder="Enter full name"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dob">Date of Birth *</Label>
              <Input
                id="dob"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => set('dateOfBirth', e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gender">Gender *</Label>
              <select
                id="gender"
                value={form.gender}
                onChange={(e) => set('gender', e.target.value as Gender)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              >
                {GENDERS.map((g) => (
                  <option key={g} value={g}>{genderLabel(g)}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mobile">Mobile Number *</Label>
              <Input
                id="mobile"
                value={form.mobileNumber}
                onChange={(e) => set('mobileNumber', e.target.value)}
                placeholder="+91XXXXXXXXXX"
                required
              />
            </div>

            <div className="space-y-1.5">
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

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="address">Address *</Label>
              <textarea
                id="address"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="Full address"
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                required
              />
            </div>
          </div>

          {/* Optional fields */}
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
              Optional details (Aadhaar, emergency contact)
            </summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="aadhaar">Aadhaar Number</Label>
                <Input
                  id="aadhaar"
                  value={form.aadhaarNumber ?? ''}
                  onChange={(e) => set('aadhaarNumber', e.target.value)}
                  placeholder="12-digit Aadhaar"
                  maxLength={12}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ecName">Emergency Contact Name</Label>
                <Input
                  id="ecName"
                  value={form.emergencyContactName ?? ''}
                  onChange={(e) => set('emergencyContactName', e.target.value)}
                  placeholder="Contact name"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ecMobile">Emergency Contact Mobile</Label>
                <Input
                  id="ecMobile"
                  value={form.emergencyContactMobile ?? ''}
                  onChange={(e) => set('emergencyContactMobile', e.target.value)}
                  placeholder="+91XXXXXXXXXX"
                />
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
  patient:  PatientResponse;
  onClose:  () => void;
  onEdit:   () => void;
}

function PatientDetailPanel({ patient, onClose, onEdit }: PatientDetailPanelProps) {
  const [downloadCard, { isLoading: downloading }] = useDownloadMedicalCardMutation();

  async function handleDownload() {
    const result = await downloadCard(patient.patientId);
    if ('data' in result && result.data) {
      const a = document.createElement('a');
      a.href = result.data;
      a.download = `medical-card-${patient.patientId}.pdf`;
      a.click();
      URL.revokeObjectURL(result.data);
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
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <div>
            <p className="text-xs text-muted-foreground">{patient.patientId}</p>
            <h2 className="text-base font-semibold">{patient.fullName}</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
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

        <div className="shrink-0 flex gap-3 p-5 border-t">
          <Button variant="outline" className="flex-1" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button className="flex-1" onClick={handleDownload} disabled={downloading}>
            <Download className="h-4 w-4 mr-2" />
            {downloading ? 'Downloading…' : 'Medical Card'}
          </Button>
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

  const { data, isFetching } = useSearchPatientsQuery({ q: debouncedSearch || undefined, page, limit: 20 });

  const patients    = data?.data    ?? [];
  const totalPages  = data ? Math.ceil(data.total / 20) : 1;

  const canRegister = role === 'RECEPTIONIST' || role === 'NURSE' || role === 'HOSPITAL_ADMIN';
  const canEdit     = role === 'RECEPTIONIST' || role === 'HOSPITAL_ADMIN';

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
