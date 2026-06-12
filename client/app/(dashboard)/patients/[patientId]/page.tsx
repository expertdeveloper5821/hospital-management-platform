'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, User, Phone, MapPin, Droplets, Shield, Calendar,
  Trash2, Search, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useGetPatientByIdQuery, useDeletePatientMutation } from '@/store/api/patient.api';
import { useGetOPDPatientHistoryQuery } from '@/store/api/opd.api';
import { useGetIPDPatientHistoryQuery } from '@/store/api/ipd.api';
import { useAppSelector } from '@/store/hooks';
import { toastSuccess } from '@/lib/toast';
import { UserRole } from '@/store/types';

function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value ?? <span className="italic text-muted-foreground">—</span>}</p>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────
function DeleteModal({
  onConfirm,
  onCancel,
  isLoading,
  errorMessage,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
  errorMessage?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg space-y-4">
        <h2 className="text-base font-semibold">Delete Patient</h2>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete this patient? This action cannot be undone.
          All clinical history will be archived.
        </p>
        {errorMessage && (
          <p className="text-sm text-destructive rounded-md bg-destructive/10 px-3 py-2">{errorMessage}</p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Deleting…' : 'Delete Patient'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OPD History Tab ──────────────────────────────────────────────────────────
function OPDHistoryTab({ patientId }: { patientId: string }) {
  const [page,      setPage]      = useState(1);
  const [search,    setSearch]    = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status,    setStatus]    = useState<'ALL' | 'OPEN' | 'COMPLETED'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const resetPage = useCallback(() => setPage(1), []);

  const { data, isLoading, isFetching } = useGetOPDPatientHistoryQuery({
    patientId,
    page,
    limit: 10,
    startDate: startDate || undefined,
    endDate:   endDate   || undefined,
    status:    status !== 'ALL' ? status : undefined,
    search:    debouncedSearch || undefined,
  });

  const handleFilterChange = (fn: () => void) => {
    fn();
    resetPage();
  };

  const busy = isLoading || isFetching;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search complaint or diagnosis…"
            value={search}
            onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <select
          value={status}
          onChange={(e) => handleFilterChange(() => setStatus(e.target.value as typeof status))}
          className="px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="ALL">All Status</option>
          <option value="OPEN">Open</option>
          <option value="COMPLETED">Completed</option>
        </select>

        <input
          type="date"
          value={startDate}
          onChange={(e) => handleFilterChange(() => setStartDate(e.target.value))}
          className="px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="From"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => handleFilterChange(() => setEndDate(e.target.value))}
          className="px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="To"
        />
      </div>

      {/* Loading skeleton */}
      {busy && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-muted h-20" />
          ))}
        </div>
      )}

      {/* Visit list */}
      {!busy && data && data.data.length > 0 && (
        <div className="space-y-2">
          {data.data.map((visit) => (
            <div key={visit.visitId} className="rounded-lg border bg-card px-4 py-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-muted-foreground">{visit.visitId}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  visit.status === 'COMPLETED'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : visit.status === 'OPEN'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {visit.status}
                </span>
              </div>
              <p className="text-sm font-medium">{visit.chiefComplaint}</p>
              {visit.diagnosis && (
                <p className="text-xs text-muted-foreground">Dx: {visit.diagnosis}</p>
              )}
              <p className="text-xs text-muted-foreground">{formatDate(visit.visitDate)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!busy && data && data.data.length === 0 && (
        <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
          No visits found for the selected filters.
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.totalPages} ({data.total} visits)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || busy}
              className="p-1.5 rounded-md border hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages || busy}
              className="p-1.5 rounded-md border hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── IPD History Tab ──────────────────────────────────────────────────────────
function IPDHistoryTab({ patientId }: { patientId: string }) {
  const [page,   setPage]   = useState(1);
  const [status, setStatus] = useState<'ALL' | 'ADMITTED' | 'DISCHARGED'>('ALL');

  const { data, isLoading, isFetching } = useGetIPDPatientHistoryQuery({
    patientId,
    page,
    limit: 10,
    status: status !== 'ALL' ? status : undefined,
  });

  const resetPage = () => setPage(1);
  const busy = isLoading || isFetching;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof status); resetPage(); }}
          className="px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="ALL">All Status</option>
          <option value="ADMITTED">Admitted</option>
          <option value="DISCHARGED">Discharged</option>
        </select>
      </div>

      {/* Loading skeleton */}
      {busy && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="rounded-lg border bg-muted h-20" />)}
        </div>
      )}

      {/* Admission list */}
      {!busy && data && data.data.length > 0 && (
        <div className="space-y-2">
          {data.data.map((admission) => (
            <div key={admission.admissionId} className="rounded-lg border bg-card px-4 py-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-muted-foreground">{admission.admissionId}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  admission.status === 'ADMITTED'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                }`}>
                  {admission.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                <span><span className="text-muted-foreground">Ward: </span>{admission.wardName}</span>
                <span><span className="text-muted-foreground">Bed: </span>{admission.bedNumber}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span>Admitted: {formatDate(admission.admissionDate)}</span>
                {admission.dischargeDate && (
                  <span>Discharged: {formatDate(admission.dischargeDate)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!busy && data && data.data.length === 0 && (
        <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
          No IPD admissions found.
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.totalPages} ({data.total} admissions)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || busy}
              className="p-1.5 rounded-md border hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages || busy}
              className="p-1.5 rounded-md border hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PatientDetailPage({ params }: { params: { patientId: string } }) {
  const { patientId } = params;
  const router = useRouter();
  const role   = useAppSelector((s) => s.auth.profile?.role);

  const { data: patient, isLoading, isError } = useGetPatientByIdQuery(patientId);
  const [deletePatient, { isLoading: isDeleting }] = useDeletePatientMutation();

  const [activeTab,      setActiveTab]      = useState<'info' | 'opd' | 'ipd'>('info');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteError,     setDeleteError]    = useState<string | undefined>();

  const canDelete = role === UserRole.ADMIN || role === UserRole.MANAGER || role === UserRole.HOSPITAL_ADMIN;

  const handleDelete = async () => {
    setDeleteError(undefined);
    try {
      await deletePatient(patientId).unwrap();
      toastSuccess('Patient record deleted.');
      setShowDeleteModal(false);
      router.push('/patients');
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message
        ?? 'Failed to delete patient.';
      setDeleteError(msg);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="rounded-xl border bg-card h-64" />
      </div>
    );
  }

  if (isError || !patient) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Link href="/patients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Patients
        </Link>
        <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
          Patient not found or you do not have permission to view it.
        </div>
      </div>
    );
  }

  return (
    <>
      {showDeleteModal && (
        <DeleteModal
          onConfirm={handleDelete}
          onCancel={() => { setShowDeleteModal(false); setDeleteError(undefined); }}
          isLoading={isDeleting}
          errorMessage={deleteError}
        />
      )}

      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <Link href="/patients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to Patients
          </Link>
          {canDelete && (
            <button
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex items-center gap-1.5 text-sm text-destructive hover:text-destructive/80 border border-destructive/30 rounded-md px-3 py-1.5 hover:bg-destructive/5 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Delete Patient
            </button>
          )}
        </div>

        <div>
          <h1 className="text-xl font-semibold">{patient.fullName}</h1>
          <p className="text-sm text-muted-foreground font-mono">{patient.patientId}</p>
        </div>

        {/* Tabs */}
        <div className="border-b flex gap-6">
          {(['info', 'opd', 'ipd'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'info' ? 'Patient Info' : tab === 'opd' ? 'OPD History' : 'IPD History'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'info' && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-card divide-y">
              <DetailRow icon={<Calendar className="h-4 w-4" />} label="Date of Birth" value={formatDate(patient.dateOfBirth)} />
              <DetailRow icon={<User className="h-4 w-4" />}     label="Gender"        value={patient.gender} />
              <DetailRow icon={<Phone className="h-4 w-4" />}    label="Mobile"        value={patient.mobileNumber} />
              <DetailRow icon={<MapPin className="h-4 w-4" />}   label="Address"       value={patient.address} />
              <DetailRow icon={<Droplets className="h-4 w-4" />} label="Blood Group"   value={patient.bloodGroup} />
              <DetailRow icon={<Shield className="h-4 w-4" />}   label="Aadhaar"       value={patient.aadhaarNumber} />
            </div>

            {(patient.emergencyContactName || patient.emergencyContactMobile) && (
              <div className="rounded-xl border bg-card divide-y">
                <p className="px-5 pt-4 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Emergency Contact</p>
                {patient.emergencyContactName   && <DetailRow icon={<User className="h-4 w-4" />}  label="Name"   value={patient.emergencyContactName} />}
                {patient.emergencyContactMobile && <DetailRow icon={<Phone className="h-4 w-4" />} label="Mobile" value={patient.emergencyContactMobile} />}
              </div>
            )}

            <p className="text-xs text-muted-foreground">Registered on {formatDate(patient.createdAt)}</p>
          </div>
        )}

        {activeTab === 'opd' && <OPDHistoryTab patientId={patientId} />}
        {activeTab === 'ipd' && <IPDHistoryTab patientId={patientId} />}
      </div>
    </>
  );
}
