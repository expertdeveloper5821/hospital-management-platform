'use client';

import { useState, useEffect } from 'react';
import {
  useSearchPatientsQuery,
  useDownloadMedicalCardMutation,
  useDeletePatientMutation,
} from '@/store/api/patient.api';
import { useGetOPDPatientHistoryQuery } from '@/store/api/opd.api';
import { useGetIPDPatientHistoryQuery, useListWardsQuery } from '@/store/api/ipd.api';
import { useAppSelector } from '@/store/hooks';
import type { PatientResponse, OPDVisitResponse } from '@/store/types';
import { PatientFormModal, genderLabel } from '@/components/patients/patient-form-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { opdStatusLabel, opdStatusVariant } from '@/lib/opd-status';
import { CharCounter } from '@/components/ui/char-counter';
import { RichTextDisplay } from '@/components/ui/rich-text-display';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { DownloadDischargeSummaryButton } from '@/components/ipd/download-discharge-summary-button';
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
  Bed,
  Trash2,
} from 'lucide-react';
import { UserRole } from '@/store/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function calcAge(dob: string) {
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

// Fixed size so every Blood Group pill (A+, A-, B+, B-, AB+, AB-, O+, O-)
// renders at the same footprint — identical width, height, padding, font
// size, and border radius, with text centered regardless of label length.
const BLOOD_GROUP_BADGE_CLASS = 'inline-flex w-12 h-6 items-center justify-center whitespace-nowrap';

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
  // Nurses and Doctors may view patient details but not edit them — the backend
  // PATCH /api/patients/:patientId route already rejects these roles; this only
  // hides the action so they aren't led into a request that will 403.
  const canEdit = role !== UserRole.NURSE && role !== UserRole.DOCTOR;

  const [tab,           setTab]           = useState<'details' | 'history' | 'ipd'>('details');
  const [historyPage,   setHistoryPage]   = useState(1);
  const [ipdPage,       setIpdPage]       = useState(1);
  const [downloadCard, { isLoading: downloading }] = useDownloadMedicalCardMutation();
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [deletePatient, { isLoading: isDeleting }] = useDeletePatientMutation();
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [deleteError,   setDeleteError]   = useState<string | undefined>();

  async function handleDelete() {
    setDeleteError(undefined);
    try {
      await deletePatient(patient.patientId).unwrap();
      // Success toast is shown globally by the base API mutation handler.
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

  const { data: ipdHistoryData, isLoading: ipdHistoryLoading } = useGetIPDPatientHistoryQuery(
    { patientId: patient.patientId, page: ipdPage, limit: 10 },
    { skip: tab !== 'ipd' },
  );

  const visits      = historyData?.data  ?? [];
  const totalVisits = historyData?.total ?? 0;
  const totalPages  = Math.ceil(totalVisits / 10) || 1;

  const ipdAdmissions = ipdHistoryData?.data  ?? [];
  const totalIpd      = ipdHistoryData?.total ?? 0;
  const ipdTotalPages = Math.ceil(totalIpd / 10) || 1;

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
    <DialogOverlay className="justify-end bg-black/40" onClick={onClose}>
      <div
        className="relative flex flex-col h-full w-full max-w-md bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{patient.patientId}</p>
            <h2 className="text-base font-semibold truncate">{patient.fullName}</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b shrink-0">
          {(['details', 'history', 'ipd'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === t
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t === 'details'
                ? <><Pencil className="h-3.5 w-3.5" /> Details</>
                : t === 'history'
                ? <><ClipboardList className="h-3.5 w-3.5" /> OPD History</>
                : <><Bed className="h-3.5 w-3.5" /> IPD History</>}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'details' && (
            <div className="p-5 space-y-1">
              {row('Date of Birth', `${formatDate(patient.dateOfBirth)} (${calcAge(patient.dateOfBirth)} years)`)}
              {row('Gender',        genderLabel(patient.gender))}
              {row('Mobile',        patient.mobileNumber)}
              {row('Blood Group',   patient.bloodGroup)}
              {row('Aadhaar',       patient.aadhaarNumber)}
              {patient.addressLine1 ? (
                <>
                  {row('Address Line 1', patient.addressLine1)}
                  {patient.addressLine2 && row('Address Line 2', patient.addressLine2)}
                  {patient.pincode && row('Pincode', patient.pincode)}
                  {row('City',  patient.city)}
                  {row('State', patient.state)}
                </>
              ) : (
                row('Address', patient.address)
              )}
              {row('EC Name',       patient.emergencyContactName)}
              {row('EC Mobile',     patient.emergencyContactMobile)}
              {row('Registered',    formatDate(patient.createdAt))}
              <div className="pt-2 border-t mt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Registration</p>
                {patient.registrationFee != null ? (
                  <>
                    {row('Fee', <span className="font-semibold">₹{patient.registrationFee.toLocaleString('en-IN')}</span>)}
                    {row('Payment Mode', patient.registrationPaymentMethod ?? '—')}
                  </>
                ) : (
                  row('Fee', <span className="text-muted-foreground">Free</span>)
                )}
              </div>
            </div>
          )}

          {tab === 'ipd' && (
            <div className="p-5 space-y-3">
              {ipdHistoryLoading ? (
                <p className="text-sm text-muted-foreground text-center py-10">Loading history…</p>
              ) : ipdAdmissions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Bed className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No IPD admissions recorded.</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{totalIpd} admission{totalIpd !== 1 ? 's' : ''} total</p>
                  {ipdAdmissions.map((a) => (
                    <div key={a.admissionId} className="rounded-lg border bg-card p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">
                          {new Date(a.admissionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                          a.status === 'ADMITTED'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-green-100 text-green-700'
                        }`}>
                          {a.status}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p><span className="font-medium text-foreground">Ward:</span> {a.wardName}</p>
                        <p><span className="font-medium text-foreground">Bed:</span> {a.bedNumber}</p>
                        {a.dischargeDate && (
                          <p><span className="font-medium text-foreground">Discharged:</span> {new Date(a.dischargeDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                        )}
                      </div>
                      {a.status === 'DISCHARGED' && (
                        <DownloadDischargeSummaryButton admissionId={a.admissionId} />
                      )}
                    </div>
                  ))}
                  {ipdTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted-foreground">Page {ipdPage} of {ipdTotalPages}</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={ipdPage <= 1} onClick={() => setIpdPage((p) => p - 1)}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" disabled={ipdPage >= ipdTotalPages} onClick={() => setIpdPage((p) => p + 1)}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
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
                        <Badge variant={opdStatusVariant(v.status)} className="text-xs shrink-0">
                          {opdStatusLabel(v.status)}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {v.diagnosis    && <p><span className="font-medium text-foreground">Diagnosis:</span> {v.diagnosis}</p>}
                        {v.prescription && <p><span className="font-medium text-foreground">Prescription:</span> {v.prescription}</p>}
                        {v.notes        && (
                          <div>
                            <span className="font-medium text-foreground">Notes:</span>{' '}
                            <RichTextDisplay value={v.notes} />
                          </div>
                        )}
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
          {canEdit && (
            <Button variant="outline" className="flex-1" onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
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
    </DialogOverlay>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PatientsPage() {
  const role   = useAppSelector((s) => s.auth.profile?.role);
  const userId = useAppSelector((s) => s.auth.profile?.userId);

  const { data: wards = [] } = useListWardsQuery(undefined, { skip: role !== 'NURSE' });
  const nurseHasNoWard = role === 'NURSE' && !wards.some((w) => w.assignedNurseIds.includes(userId ?? ''));

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
              {nurseHasNoWard
                ? 'No ward has been assigned to your account.'
                : debouncedSearch ? `No patients found for "${debouncedSearch}"` : 'No patients registered yet.'}
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
                      <td className="px-4 py-3 font-medium max-w-[200px] truncate" title={p.fullName}>{p.fullName}</td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                        {calcAge(p.dateOfBirth)} years · {genderLabel(p.gender)}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{p.mobileNumber}</td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {p.bloodGroup ? (
                          <Badge variant="outline" className={BLOOD_GROUP_BADGE_CLASS}>{p.bloodGroup}</Badge>
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
