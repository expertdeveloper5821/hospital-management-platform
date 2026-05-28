'use client';

import Link from 'next/link';
import { ArrowLeft, User, ScanLine, FileText, Calendar, Activity, Download } from 'lucide-react';
import { useGetRadiologyRequestQuery } from '@/store/api/lab.api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:     'bg-yellow-100 text-yellow-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED:   'bg-green-100 text-green-700',
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

export default function RadiologyDetailPage({ params }: { params: { requestId: string } }) {
  const { requestId } = params;
  const { data: request, isLoading, isError } = useGetRadiologyRequestQuery(requestId);

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto space-y-4 animate-pulse">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="rounded-xl border bg-card h-48" />
      </div>
    );
  }

  if (isError || !request) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <Link href="/lab" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Lab
        </Link>
        <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
          Request not found or you do not have permission to view it.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Link href="/lab" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Lab
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Radiology Request</h1>
          <p className="text-sm text-muted-foreground font-mono">{request.requestId}</p>
        </div>
        <span className={`shrink-0 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[request.status] ?? 'bg-muted text-muted-foreground'}`}>
          {request.status.replace('_', ' ')}
        </span>
      </div>

      <div className="rounded-xl border bg-card divide-y">
        <DetailRow icon={<User className="h-4 w-4" />}     label="Patient"       value={request.fullName || request.patientId} />
        <DetailRow icon={<ScanLine className="h-4 w-4" />} label="Imaging Type"  value={request.imagingType} />
        <DetailRow icon={<Activity className="h-4 w-4" />} label="Requested By"  value={request.requestedBy} />
        <DetailRow icon={<Calendar className="h-4 w-4" />} label="Requested On"  value={formatDate(request.requestedAt)} />
        {request.notes && (
          <DetailRow icon={<FileText className="h-4 w-4" />} label="Notes"       value={request.notes} />
        )}
      </div>

      {request.reportUrl && (
        <a
          href={request.reportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 w-full rounded-xl border bg-card px-5 py-4 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          Download Report
        </a>
      )}
    </div>
  );
}
