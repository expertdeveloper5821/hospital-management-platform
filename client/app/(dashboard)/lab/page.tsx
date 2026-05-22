'use client';

import { useState, useEffect, useRef } from 'react';
import {
  useListPathologyRequestsQuery,
  useCreatePathologyRequestMutation,
  useUploadPathologyReportMutation,
  useListRadiologyRequestsQuery,
  useCreateRadiologyRequestMutation,
  useUploadRadiologyReportMutation,
} from '@/store/api/lab.api';
import { useSearchPatientsQuery } from '@/store/api/patient.api';
import { useAppSelector } from '@/store/hooks';
import type {
  PathologyRequestResponse,
  RadiologyRequestResponse,
  LabRequestStatus,
  PatientResponse,
} from '@/store/types';
import { Button }                        from '@/components/ui/button';
import { Input }                         from '@/components/ui/input';
import { Label }                         from '@/components/ui/label';
import { Badge }                         from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  FlaskConical,
  Plus,
  X,
  Upload,
  ExternalLink,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusVariant(s: LabRequestStatus): 'default' | 'secondary' | 'outline' {
  if (s === 'PENDING')     return 'default';
  if (s === 'IN_PROGRESS') return 'secondary';
  return 'outline';
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',            label: 'All Status' },
  { value: 'PENDING',     label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED',   label: 'Completed' },
];

// ─── Patient Search Combobox ──────────────────────────────────────────────────

interface PatientComboboxProps {
  selected:    PatientResponse | null;
  onSelect:    (p: PatientResponse) => void;
  onClear:     () => void;
}

function PatientCombobox({ selected, onSelect, onClear }: PatientComboboxProps) {
  const [query, setQuery]       = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useSearchPatientsQuery(
    { q: debounced || undefined, limit: 8 },
    { skip: !debounced },
  );
  const patients = data?.data ?? [];

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div>
          <p className="text-sm font-medium">{selected.fullName}</p>
          <p className="text-xs text-muted-foreground">{selected.patientId} · {selected.mobileNumber}</p>
        </div>
        <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        className="pl-9"
        placeholder="Search patient by name or mobile…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {debounced && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg max-h-48 overflow-y-auto">
          {isFetching && <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>}
          {!isFetching && patients.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No patients found.</p>
          )}
          {patients.map((p) => (
            <button
              key={p.patientId}
              type="button"
              className="flex flex-col w-full text-left px-3 py-2 hover:bg-muted transition-colors"
              onClick={() => { onSelect(p); setQuery(''); }}
            >
              <span className="text-sm font-medium">{p.fullName}</span>
              <span className="text-xs text-muted-foreground">{p.patientId} · {p.mobileNumber}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── New Request Modal ────────────────────────────────────────────────────────

interface NewRequestModalProps {
  type:    'pathology' | 'radiology';
  onClose: () => void;
}

function NewRequestModal({ type, onClose }: NewRequestModalProps) {
  const [patient,  setPatient]  = useState<PatientResponse | null>(null);
  const [testType, setTestType] = useState('');
  const [notes,    setNotes]    = useState('');
  const [error,    setError]    = useState('');

  const [createPathology, { isLoading: creatingPath }] = useCreatePathologyRequestMutation();
  const [createRadiology, { isLoading: creatingRad  }] = useCreateRadiologyRequestMutation();
  const isLoading = creatingPath || creatingRad;

  const fieldLabel = type === 'pathology' ? 'Test Type' : 'Imaging Type';
  const fieldPlaceholder = type === 'pathology'
    ? 'e.g. Complete Blood Count, Urine Analysis…'
    : 'e.g. Chest X-Ray, CT Scan, MRI Brain…';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!patient)           { setError('Please select a patient.'); return; }
    if (!testType.trim())   { setError(`${fieldLabel} is required.`); return; }

    try {
      if (type === 'pathology') {
        await createPathology({
          patientId: patient.patientId,
          testType:  testType.trim(),
          notes:     notes.trim() || undefined,
        }).unwrap();
      } else {
        await createRadiology({
          patientId:   patient.patientId,
          imagingType: testType.trim(),
          notes:       notes.trim() || undefined,
        }).unwrap();
      }
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to create request.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">
            New {type === 'pathology' ? 'Pathology' : 'Radiology'} Request
          </h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label>Patient *</Label>
            <PatientCombobox
              selected={patient}
              onSelect={setPatient}
              onClear={() => setPatient(null)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nr-testtype">{fieldLabel} *</Label>
            <Input
              id="nr-testtype"
              value={testType}
              onChange={(e) => setTestType(e.target.value)}
              placeholder={fieldPlaceholder}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nr-notes">Clinical Notes (optional)</Label>
            <textarea
              id="nr-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any relevant clinical information for the lab…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !patient}>
              {isLoading ? 'Submitting…' : 'Submit Request'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Report Upload Modal ──────────────────────────────────────────────────────

interface ReportUploadModalProps {
  requestId: string;
  type:      'pathology' | 'radiology';
  onClose:   () => void;
}

function ReportUploadModal({ requestId, type, onClose }: ReportUploadModalProps) {
  const [file,  setFile]  = useState<File | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploadPathology, { isLoading: uploadingPath }] = useUploadPathologyReportMutation();
  const [uploadRadiology, { isLoading: uploadingRad  }] = useUploadRadiologyReportMutation();
  const isLoading = uploadingPath || uploadingRad;

  const maxMB = type === 'pathology' ? 10 : 20;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > maxMB * 1024 * 1024) {
      setError(`File exceeds ${maxMB} MB limit.`);
      return;
    }
    setFile(f);
    setError('');
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError('Please select a file.'); return; }
    setError('');
    try {
      if (type === 'pathology') {
        await uploadPathology({ requestId, file }).unwrap();
      } else {
        await uploadRadiology({ requestId, file }).unwrap();
      }
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Upload failed. Please try again.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">Upload Report</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleUpload} className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label>Report File (max {maxMB} MB)</Label>
            <div
              className="flex flex-col items-center justify-center border-2 border-dashed rounded-md p-6 cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Click to select PDF or image file</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Max {maxMB} MB</p>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !file}>
              {isLoading ? 'Uploading…' : 'Upload Report'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Request Detail Panel ─────────────────────────────────────────────────────

interface RequestDetailPanelProps {
  request:   PathologyRequestResponse | RadiologyRequestResponse;
  type:      'pathology' | 'radiology';
  canUpload: boolean;
  onClose:   () => void;
}

function RequestDetailPanel({ request, type, canUpload, onClose }: RequestDetailPanelProps) {
  const [showUpload, setShowUpload] = useState(false);

  const testLabel = type === 'pathology'
    ? (request as PathologyRequestResponse).testType
    : (request as RadiologyRequestResponse).imagingType;

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-5 gap-2 py-2 border-b last:border-0">
      <span className="col-span-2 text-sm text-muted-foreground">{label}</span>
      <span className="col-span-3 text-sm font-medium break-words">{value ?? '—'}</span>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
        <div
          className="relative flex flex-col h-full w-full max-w-md bg-background shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between p-5 border-b shrink-0">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(request.status)}>{request.status.replace('_', ' ')}</Badge>
                <span className="text-xs text-muted-foreground capitalize">{type}</span>
              </div>
              <p className="text-sm font-semibold">{testLabel}</p>
            </div>
            <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {row('Request ID',  <span className="font-mono text-xs">{request.requestId}</span>)}
            {row('Patient ID',  <span className="font-mono text-xs">{request.patientId}</span>)}
            {row('Requested By', <span className="font-mono text-xs">{request.requestedBy}</span>)}
            {row('Requested At', formatDate(request.requestedAt))}
            {row('Updated At',   formatDate(request.updatedAt))}
            {row('Notes',        request.notes)}
            {row('Report', request.reportUrl ? (
              <a
                href={request.reportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                View Report
              </a>
            ) : 'Not uploaded yet')}
          </div>

          {canUpload && request.status !== 'COMPLETED' && (
            <div className="shrink-0 p-5 border-t">
              <Button className="w-full" onClick={() => setShowUpload(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Report
              </Button>
            </div>
          )}
        </div>
      </div>

      {showUpload && (
        <ReportUploadModal
          requestId={request.requestId}
          type={type}
          onClose={() => { setShowUpload(false); onClose(); }}
        />
      )}
    </>
  );
}

// ─── Requests Table ───────────────────────────────────────────────────────────

interface RequestsTableProps {
  type:      'pathology' | 'radiology';
  canCreate: boolean;
  canUpload: boolean;
}

function RequestsTable({ type, canCreate, canUpload }: RequestsTableProps) {
  const [statusFilter,    setStatusFilter]    = useState('');
  const [patientIdFilter, setPatientIdFilter] = useState('');
  const [patientInput,    setPatientInput]    = useState('');
  const [page,            setPage]            = useState(1);
  const [showNewRequest,  setShowNewRequest]  = useState(false);
  const [selected,        setSelected]        = useState<PathologyRequestResponse | RadiologyRequestResponse | null>(null);

  const pathologyResult = useListPathologyRequestsQuery(
    { patientId: patientIdFilter || undefined, status: statusFilter || undefined, page, limit: 20 },
    { skip: type !== 'pathology' },
  );
  const radiologyResult = useListRadiologyRequestsQuery(
    { patientId: patientIdFilter || undefined, status: statusFilter || undefined, page, limit: 20 },
    { skip: type !== 'radiology' },
  );

  const result      = type === 'pathology' ? pathologyResult : radiologyResult;
  const requests    = result.data?.data ?? [];
  const total       = result.data?.total ?? 0;
  const totalPages  = result.data?.totalPages ?? 1;
  const isFetching  = result.isFetching;

  function handlePatientFilter() {
    setPatientIdFilter(patientInput.trim());
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 flex-1 min-w-40">
          <Label className="text-xs">Filter by Patient ID</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Patient ID…"
              value={patientInput}
              onChange={(e) => setPatientInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePatientFilter()}
              className="h-9"
            />
            <Button variant="outline" size="sm" onClick={handlePatientFilter} className="h-9">
              <Search className="h-4 w-4" />
            </Button>
            {patientIdFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => { setPatientIdFilter(''); setPatientInput(''); setPage(1); }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <Button variant="outline" size="sm" className="h-9" onClick={() => result.refetch()} disabled={isFetching}>
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        </Button>

        {canCreate && (
          <Button size="sm" className="h-9" onClick={() => setShowNewRequest(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Request
          </Button>
        )}
      </div>

      {/* Stats */}
      <p className="text-xs text-muted-foreground">{total} request{total !== 1 ? 's' : ''} found</p>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isFetching ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Loading…</div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
              <FileText className="h-8 w-8 opacity-30" />
              No requests found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      {type === 'pathology' ? 'Test Type' : 'Imaging Type'}
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Requested</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Report</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => {
                    const label = type === 'pathology'
                      ? (r as PathologyRequestResponse).testType
                      : (r as RadiologyRequestResponse).imagingType;
                    return (
                      <tr
                        key={r.requestId}
                        className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelected(r)}
                      >
                        <td className="px-4 py-3 font-medium max-w-xs truncate">{label}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium">{r.fullName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{r.patientId}</p>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                          {formatDate(r.requestedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariant(r.status)}>{r.status.replace('_', ' ')}</Badge>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {r.reportUrl ? (
                            <span className="text-xs text-green-600 font-medium">Uploaded</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="text-xs text-primary hover:underline"
                            onClick={(e) => { e.stopPropagation(); setSelected(r); }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New request modal */}
      {showNewRequest && (
        <NewRequestModal type={type} onClose={() => setShowNewRequest(false)} />
      )}

      {/* Request detail panel */}
      {selected && (
        <RequestDetailPanel
          request={selected}
          type={type}
          canUpload={canUpload}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabType = 'pathology' | 'radiology';

export default function LabPage() {
  const role = useAppSelector((s) => s.auth.profile?.role);
  const [activeTab, setActiveTab] = useState<TabType>('pathology');

  const canCreate = ['DOCTOR', 'HOSPITAL_ADMIN', 'RECEPTIONIST'].includes(role ?? '');
  const canUploadPathology = ['PATHOLOGIST', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canUploadRadiology = ['RADIOLOGIST', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canUpload = activeTab === 'pathology' ? canUploadPathology : canUploadRadiology;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Lab</h1>
        <p className="text-sm text-muted-foreground">Pathology and radiology request management</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b gap-1">
        {(['pathology', 'radiology'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors capitalize',
              activeTab === tab
                ? 'border-b-2 border-primary text-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FlaskConical className="inline h-4 w-4 mr-1.5 -mt-0.5" />
            {tab === 'pathology' ? 'Pathology' : 'Radiology'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <RequestsTable
        key={activeTab}
        type={activeTab}
        canCreate={canCreate}
        canUpload={canUpload}
      />
    </div>
  );
}
