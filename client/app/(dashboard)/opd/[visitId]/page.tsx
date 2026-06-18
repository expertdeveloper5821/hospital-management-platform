'use client';

import Link from 'next/link';
import { ArrowLeft, User, Stethoscope, ClipboardList, FileText, Calendar, Activity } from 'lucide-react';
import { useGetOPDVisitByIdQuery } from '@/store/api/opd.api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_COLORS: Record<string, string> = {
  OPEN:        'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
  COMPLETED:   'bg-green-100 text-green-700',
  CANCELLED:   'bg-red-100 text-red-700',
};

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words whitespace-pre-wrap">
          {value ?? <span className="italic text-muted-foreground">—</span>}
        </p>
      </div>
    </div>
  );
}

export default function OPDVisitDetailPage({ params }: { params: { visitId: string } }) {
  const { visitId } = params;
  const { data: visit, isLoading, isError } = useGetOPDVisitByIdQuery(visitId);

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto space-y-4 animate-pulse">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="rounded-xl border bg-card h-64" />
      </div>
    );
  }

  if (isError || !visit) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <Link href="/opd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to OPD
        </Link>
        <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
          Visit not found or you do not have permission to view it.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Link href="/opd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to OPD
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{visit.fullName || 'OPD Visit'}</h1>
          <p className="text-sm text-muted-foreground font-mono">{visit.visitId}</p>
        </div>
        <span className={`shrink-0 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[visit.status] ?? 'bg-muted text-muted-foreground'}`}>
          {visit.status.replace('_', ' ')}
        </span>
      </div>

      <div className="rounded-xl border bg-card divide-y">
        <DetailRow icon={<User className="h-4 w-4" />}          label="Patient ID"       value={visit.patientId} />
        <DetailRow icon={<Calendar className="h-4 w-4" />}       label="Visit Date"       value={formatDate(visit.visitDate)} />
        <DetailRow icon={<Activity className="h-4 w-4" />}       label="Queue Number"     value={`#${visit.queueNumber}`} />
        <DetailRow icon={<Stethoscope className="h-4 w-4" />}    label="Doctor(s)"        value={visit.doctorIds?.join(', ') || '—'} />
        <DetailRow icon={<ClipboardList className="h-4 w-4" />}  label="Chief Complaint"  value={visit.chiefComplaint} />
        {visit.diagnosis && (
          <DetailRow icon={<FileText className="h-4 w-4" />} label="Diagnosis" value={visit.diagnosis} />
        )}
        {visit.prescription && (
          <DetailRow icon={<FileText className="h-4 w-4" />} label="Prescription" value={visit.prescription} />
        )}
        {visit.notes && (
          <DetailRow icon={<FileText className="h-4 w-4" />} label="Notes" value={visit.notes} />
        )}
      </div>

      <p className="text-xs text-muted-foreground">Created on {formatDate(visit.createdAt)}</p>
    </div>
  );
}
