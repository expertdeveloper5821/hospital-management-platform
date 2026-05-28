'use client';

import Link from 'next/link';
import { ArrowLeft, User, BedDouble, Stethoscope, Calendar, FileText, Activity } from 'lucide-react';
import { useGetAdmissionByIdQuery } from '@/store/api/ipd.api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_COLORS: Record<string, string> = {
  ADMITTED:   'bg-green-100 text-green-700',
  DISCHARGED: 'bg-gray-100 text-gray-600',
};

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">
          {value ?? <span className="italic text-muted-foreground">—</span>}
        </p>
      </div>
    </div>
  );
}

export default function IPDAdmissionDetailPage({ params }: { params: { admissionId: string } }) {
  const { admissionId } = params;
  const { data: admission, isLoading, isError } = useGetAdmissionByIdQuery(admissionId);

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto space-y-4 animate-pulse">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="rounded-xl border bg-card h-64" />
      </div>
    );
  }

  if (isError || !admission) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <Link href="/ipd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to IPD
        </Link>
        <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
          Admission not found or you do not have permission to view it.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Link href="/ipd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to IPD
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{admission.fullName || 'IPD Admission'}</h1>
          <p className="text-sm text-muted-foreground font-mono">{admission.admissionId}</p>
        </div>
        <span className={`shrink-0 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[admission.status] ?? 'bg-muted text-muted-foreground'}`}>
          {admission.status}
        </span>
      </div>

      <div className="rounded-xl border bg-card divide-y">
        <DetailRow icon={<User className="h-4 w-4" />}        label="Patient ID"       value={admission.patientId} />
        <DetailRow icon={<BedDouble className="h-4 w-4" />}   label="Ward"             value={`${admission.wardName} · Bed ${admission.bedNumber}`} />
        <DetailRow icon={<Stethoscope className="h-4 w-4" />} label="Assigned Doctor"  value={admission.assignedDoctorId} />
        <DetailRow icon={<Calendar className="h-4 w-4" />}    label="Admission Date"   value={formatDate(admission.admissionDate)} />
        {admission.dischargeDate && (
          <DetailRow icon={<Activity className="h-4 w-4" />}  label="Discharge Date"   value={formatDate(admission.dischargeDate)} />
        )}
      </div>

      {admission.progressNotes.length > 0 && (
        <div className="rounded-xl border bg-card">
          <p className="px-5 pt-4 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Progress Notes</p>
          <ul className="divide-y">
            {admission.progressNotes.map((note) => (
              <li key={note.noteId} className="flex items-start gap-3 px-5 py-4">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{formatDateTime(note.timestamp)} · Dr. {note.doctorId}</p>
                  <p className="text-sm mt-0.5 whitespace-pre-wrap break-words">{note.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
