'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  useListPathologyRequestsQuery,
  useCreatePathologyRequestMutation,
  useUploadPathologyReportMutation,
  useEditPathologyRequestMutation,
  useDeletePathologyRequestMutation,
  useListRadiologyRequestsQuery,
  useCreateRadiologyRequestMutation,
  useUploadRadiologyReportMutation,
  useEditRadiologyRequestMutation,
  useDeleteRadiologyRequestMutation,
  useCollectPathologyPaymentMutation,
  useCollectRadiologyPaymentMutation,
} from '@/store/api/lab.api';
import { useLazyGetReceiptUrlQuery } from '@/store/api/payment.api';
import { useSearchPatientsQuery } from '@/store/api/patient.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useAppSelector } from '@/store/hooks';
import type {
  PathologyRequestResponse,
  RadiologyRequestResponse,
  LabRequestStatus,
  LabRequestPriority,
  PatientResponse,
} from '@/store/types';
import { LAB_REFERRED_BY_SELF } from '@/store/types';
import { Button }                        from '@/components/ui/button';
import { Input }                         from '@/components/ui/input';
import { Label }                         from '@/components/ui/label';
import { Badge }                         from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { RichTextDisplay } from '@/components/ui/rich-text-display';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import {
  FlaskConical,
  Plus,
  X,
  Upload,
  ExternalLink,
  Search,
  RefreshCw,
  FileText,
  Pencil,
  Trash2,
  IndianRupee,
  Download,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavForm } from '@/components/ui/form';
import { isTempId } from '@/lib/offline/mutation-policy';
import { serialNumber, serialOffset } from '@/lib/serial-number';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Fixed width so every Status pill (PENDING / IN PROGRESS / COMPLETED) renders
// at the same size — content centered, text never clipped or wrapped.
const STATUS_BADGE_CLASS = 'w-28 justify-center text-center whitespace-nowrap';

function statusVariant(s: LabRequestStatus): 'warning' | 'info' | 'success' {
  // Fixed semantic statuses — never tenant-brand-colored.
  if (s === 'PENDING')     return 'warning';
  if (s === 'IN_PROGRESS') return 'info';
  return 'success';
}

type LabRequest = PathologyRequestResponse | RadiologyRequestResponse;

function testLabelOf(request: LabRequest, type: 'pathology' | 'radiology'): string {
  return type === 'pathology'
    ? (request as PathologyRequestResponse).testType
    : (request as RadiologyRequestResponse).imagingType;
}

const PAYMENT_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI',  label: 'UPI'  },
  { value: 'CARD', label: 'Card' },
] as const;

type LabPaymentMode = typeof PAYMENT_MODES[number]['value'];

const PAYMENT_MODE_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CHEQUE: 'Cheque' };

function formatINR(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// A ₹0 payment is a free test billed from Billing — its stored method is
// nominal, so it reads "Free" (same as its receipt).
function paymentModeLabel(payment: { amount: number; paymentMethod: string }): string {
  return payment.amount === 0 ? 'Free' : (PAYMENT_MODE_LABEL[payment.paymentMethod] ?? payment.paymentMethod);
}

// Mirrors the backend's CollectLabPaymentSchema amount rules.
function validateAmount(raw: string): string | null {
  if (!raw.trim()) return 'Amount is required.';
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 'Amount must be greater than zero.';
  if (Math.round(value * 100) !== value * 100) return 'Amount cannot have more than 2 decimal places.';
  if (String(value).replace(/[^0-9]/g, '').length > 10) return 'Amount cannot exceed 10 digits.';
  return null;
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
  type:       'pathology' | 'radiology';
  onClose:    () => void;
  // Called with the newly created request (before onClose) — lets roles that
  // collect lab payments move straight on to collecting it.
  onCreated?: (request: LabRequest) => void;
}

function NewRequestModal({ type, onClose, onCreated }: NewRequestModalProps) {
  const profile = useAppSelector((s) => s.auth.profile);
  // A Doctor referring their own lab request has no "Self" concept — the
  // referring doctor IS the logged-in user, so the Self option is hidden and
  // their own name is defaulted/pinned to the top instead. Every other role
  // that can create a request (Pathologist/Radiologist/Receptionist/
  // Hospital Admin/Nurse) keeps the existing Self-first behavior unchanged.
  const isDoctorSelf = profile?.role === 'DOCTOR';

  const [patient,    setPatient]    = useState<PatientResponse | null>(null);
  const [testType,   setTestType]   = useState('');
  const [referredBy, setReferredBy] = useState(isDoctorSelf ? (profile?.userId ?? LAB_REFERRED_BY_SELF) : LAB_REFERRED_BY_SELF);
  const [notes,      setNotes]      = useState('');
  const [error,      setError]      = useState('');

  const { data: doctorsData } = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const doctors = isDoctorSelf
    ? [...(doctorsData?.data ?? [])].sort((a, b) => (a.userId === profile?.userId ? -1 : b.userId === profile?.userId ? 1 : 0))
    : (doctorsData?.data ?? []);

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
      const created: LabRequest = type === 'pathology'
        ? await createPathology({
          patientId:  patient.patientId,
          testType:   testType.trim(),
          referredBy,
          notes:      notes.trim() || undefined,
        }).unwrap()
        : await createRadiology({
          patientId:   patient.patientId,
          imagingType: testType.trim(),
          referredBy,
          notes:       notes.trim() || undefined,
        }).unwrap();
      onCreated?.(created);
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to create request.');
    }
  }

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <h2 className="text-base font-semibold">
            New {type === 'pathology' ? 'Pathology' : 'Radiology'} Request
          </h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <NavForm onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
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
              <Label htmlFor="nr-referredby">Referred By</Label>
              <select
                id="nr-referredby"
                value={referredBy}
                onChange={(e) => setReferredBy(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {!isDoctorSelf && <option value={LAB_REFERRED_BY_SELF}>Self</option>}
                {doctors.map((d) => (
                  <option key={d.userId} value={d.userId}>{d.name}</option>
                ))}
              </select>
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
              <RichTextEditor
                id="nr-notes"
                rows={3}
                value={notes}
                onChange={setNotes}
                placeholder="Any relevant clinical information for the lab…"
                maxLength={2000}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 shrink-0 px-5 pb-5">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !patient}>
              {isLoading ? 'Submitting…' : 'Submit Request'}
            </Button>
          </div>
        </NavForm>
      </div>
    </DialogOverlay>
  );
}

// ─── Lab Receipt Download ─────────────────────────────────────────────────────
// Same flow as the Payments page's ReceiptButton: fetch a short-lived
// pre-signed URL for the stored A5 receipt PDF and open it in a new tab
// (download/print from the browser's PDF viewer).

function LabReceiptButton({ paymentId, className }: { paymentId: string; className?: string }) {
  const [trigger, { isFetching }] = useLazyGetReceiptUrlQuery();
  const [err, setErr] = useState('');

  async function handleDownload() {
    setErr('');
    try {
      const url = await trigger(paymentId).unwrap();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setErr('Receipt not available.');
    }
  }

  return (
    <div className={cn('space-y-1', className)}>
      <Button type="button" variant="outline" className="w-full" onClick={handleDownload} disabled={isFetching}>
        <Download className="h-4 w-4 mr-2" />
        {isFetching ? 'Loading…' : 'Download Receipt'}
      </Button>
      {err && <p className="text-xs text-destructive text-center">{err}</p>}
    </div>
  );
}

// ─── Collect Payment Modal ────────────────────────────────────────────────────

interface CollectPaymentModalProps {
  request: LabRequest;
  type:    'pathology' | 'radiology';
  // Shown when opened right after creating the request.
  justCreated?: boolean;
  onClose: () => void;
}

function CollectPaymentModal({ request, type, justCreated, onClose }: CollectPaymentModalProps) {
  const [amount,        setAmount]        = useState('');
  const [paymentMode,   setPaymentMode]   = useState<LabPaymentMode | ''>('');
  const [transactionId, setTransactionId] = useState('');
  const [error,         setError]         = useState('');
  const [paid,          setPaid]          = useState<{ paymentId: string; amount: number; paymentMethod: string; receiptAvailable: boolean } | null>(null);

  const [collectPathology, { isLoading: collectingPath }] = useCollectPathologyPaymentMutation();
  const [collectRadiology, { isLoading: collectingRad  }] = useCollectRadiologyPaymentMutation();
  const isLoading = collectingPath || collectingRad;

  const testLabel = testLabelOf(request, type);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const amountError = validateAmount(amount);
    if (amountError)  { setError(amountError); return; }
    if (!paymentMode) { setError('Please select a payment mode.'); return; }
    if (transactionId.trim().length > 100) { setError('Transaction ID cannot exceed 100 characters.'); return; }

    const body = {
      requestId:     request.requestId,
      amount:        Number(amount),
      paymentMethod: paymentMode,
      transactionId: paymentMode !== 'CASH' && transactionId.trim() ? transactionId.trim() : undefined,
    };
    try {
      const payment = type === 'pathology'
        ? await collectPathology(body).unwrap()
        : await collectRadiology(body).unwrap();
      setPaid({
        paymentId:        payment.paymentId,
        amount:           payment.amount,
        paymentMethod:    payment.paymentMethod,
        receiptAvailable: !!payment.receiptUrl,
      });
    } catch (err: any) {
      if (err?.status === 'FETCH_ERROR') {
        setError('You appear to be offline. Lab payments can only be collected online.');
      } else if (err?.status === 409) {
        setError('Payment has already been collected for this request.');
      } else if (err?.status === 404) {
        setError('This request no longer exists.');
      } else {
        setError(err?.data?.message ?? 'Failed to collect payment.');
      }
    }
  }

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md max-h-[90vh] flex flex-col rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <h2 className="text-base font-semibold">{paid ? 'Payment Collected' : 'Collect Payment'}</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {paid ? (
          <div className="p-5 space-y-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="h-10 w-10 text-success" />
              <p className="text-sm font-medium">
                {formatINR(paid.amount)} received via {PAYMENT_MODE_LABEL[paid.paymentMethod] ?? paid.paymentMethod}
              </p>
              <p className="text-xs text-muted-foreground break-words">{testLabel} · {request.fullName}</p>
            </div>
            {paid.receiptAvailable ? (
              <LabReceiptButton paymentId={paid.paymentId} />
            ) : (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground text-center">
                The payment was recorded, but its receipt is not available.
              </p>
            )}
            <div className="flex justify-end">
              <Button type="button" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form noValidate onSubmit={handleSubmit} className="flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
              {justCreated && (
                <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
                  Request created. Collect the lab payment now, or close to collect it later.
                </p>
              )}
              {error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}

              <div className="rounded-md border px-3 py-2 text-sm space-y-0.5">
                <p className="font-medium break-words">{testLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {request.fullName} · <span className="font-mono">{request.patientId}</span>
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lp-amount">Amount (₹) *</Label>
                <Input
                  id="lp-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Payment Mode *</Label>
                <div className="flex gap-2">
                  {PAYMENT_MODES.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={paymentMode === value}
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
                  <Label htmlFor="lp-txn">Transaction ID (optional)</Label>
                  <Input
                    id="lp-txn"
                    type="text"
                    maxLength={100}
                    placeholder="e.g. UPI reference / last 4 digits"
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 shrink-0 px-5 pb-5">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                {justCreated ? 'Later' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Collecting…' : 'Collect Payment'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </DialogOverlay>
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
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">Upload Report</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <NavForm onSubmit={handleUpload} className="p-5 space-y-4">
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
        </NavForm>
      </div>
    </DialogOverlay>
  );
}

// ─── Edit Request Modal ───────────────────────────────────────────────────────

interface EditRequestModalProps {
  request: PathologyRequestResponse | RadiologyRequestResponse;
  type:    'pathology' | 'radiology';
  onClose: () => void;
}

function EditRequestModal({ request, type, onClose }: EditRequestModalProps) {
  const isPathology = type === 'pathology';
  const pathDoc     = request as PathologyRequestResponse;
  const radioDoc    = request as RadiologyRequestResponse;

  const [typeField, setTypeField] = useState(isPathology ? pathDoc.testType : radioDoc.imagingType);
  const [notes,     setNotes]     = useState(request.notes ?? '');
  const [priority,  setPriority]  = useState<LabRequestPriority>(request.priority);
  const [status,    setStatus]    = useState<'PENDING' | 'IN_PROGRESS'>(
    request.status === 'COMPLETED' ? 'PENDING' : request.status as 'PENDING' | 'IN_PROGRESS',
  );
  const [error,     setError]     = useState('');

  const [editPathology, { isLoading: editingPath }] = useEditPathologyRequestMutation();
  const [editRadiology, { isLoading: editingRad  }] = useEditRadiologyRequestMutation();
  const isLoading = editingPath || editingRad;

  const fieldLabel = isPathology ? 'Test Type' : 'Imaging Type';

  // Status may only be changed by Hospital Admin, or the lab role that owns
  // this request type (Pathologist / Radiologist). Mirrors lab.service.ts.
  const role = useAppSelector((s) => s.auth.profile?.role);
  const canChangeStatus =
    role === 'HOSPITAL_ADMIN' || role === (isPathology ? 'PATHOLOGIST' : 'RADIOLOGIST');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (isPathology) {
        await editPathology({
          requestId: request.requestId,
          testType:  typeField.trim() || undefined,
          notes:     notes.trim() || null,
          priority,
          ...(canChangeStatus ? { status } : {}),
        }).unwrap();
      } else {
        await editRadiology({
          requestId:   request.requestId,
          imagingType: typeField.trim() || undefined,
          notes:       notes.trim() || null,
          priority,
          ...(canChangeStatus ? { status } : {}),
        }).unwrap();
      }
      onClose();
    } catch (err: any) {
      if (err?.status === 409) {
        setError('This request is already completed and cannot be edited.');
      } else {
        setError(err?.data?.message ?? 'Failed to update request.');
      }
    }
  }

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <h2 className="text-base font-semibold">
            Edit {isPathology ? 'Pathology' : 'Radiology'} Request
          </h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <NavForm onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="er-type">{fieldLabel}</Label>
              <Input
                id="er-type"
                value={typeField}
                onChange={(e) => setTypeField(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="er-notes">Clinical Notes</Label>
              <RichTextEditor
                id="er-notes"
                rows={3}
                value={notes}
                onChange={setNotes}
                maxLength={2000}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="er-priority">Priority</Label>
                <select
                  id="er-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as LabRequestPriority)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="NORMAL">Normal</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="er-status">Status</Label>
                <select
                  id="er-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'PENDING' | 'IN_PROGRESS')}
                  disabled={!canChangeStatus}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="PENDING">Pending</option>
                  <option value="IN_PROGRESS">In Progress</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 shrink-0 px-5 pb-5">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </NavForm>
      </div>
    </DialogOverlay>
  );
}

// ─── Delete Request Modal ─────────────────────────────────────────────────────

interface DeleteRequestModalProps {
  requestId: string;
  type:      'pathology' | 'radiology';
  onClose:   () => void;
}

function DeleteRequestModal({ requestId, type, onClose }: DeleteRequestModalProps) {
  const [error, setError] = useState('');

  const [deletePathology, { isLoading: deletingPath }] = useDeletePathologyRequestMutation();
  const [deleteRadiology, { isLoading: deletingRad  }] = useDeleteRadiologyRequestMutation();
  const isLoading = deletingPath || deletingRad;

  async function handleConfirm() {
    setError('');
    try {
      if (type === 'pathology') {
        await deletePathology(requestId).unwrap();
      } else {
        await deleteRadiology(requestId).unwrap();
      }
      onClose();
    } catch (err: any) {
      if (err?.status === 403) {
        setError('Only Hospital Admin or Manager can delete a completed request.');
      } else if (err?.status === 409) {
        setError('This request has been paid and cannot be deleted.');
      } else if (err?.status === 404) {
        setError('This request has already been deleted.');
      } else {
        setError(err?.data?.message ?? 'Failed to delete request.');
      }
    }
  }

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-sm rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">Delete Request</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}
          <p className="text-sm text-muted-foreground">
            This will archive the request. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirm}
              disabled={isLoading}
            >
              {isLoading ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      </div>
    </DialogOverlay>
  );
}

// ─── Request Detail Panel ─────────────────────────────────────────────────────

interface RequestDetailPanelProps {
  request:   PathologyRequestResponse | RadiologyRequestResponse;
  type:      'pathology' | 'radiology';
  canUpload: boolean;
  canEdit:   boolean;
  canDelete: boolean;
  canCollectPayment:  boolean;
  canDownloadReceipt: boolean;
  onClose:   () => void;
}

function RequestDetailPanel({
  request, type, canUpload, canEdit, canDelete, canCollectPayment, canDownloadReceipt, onClose,
}: RequestDetailPanelProps) {
  const [showUpload,  setShowUpload]  = useState(false);
  const [showEdit,    setShowEdit]    = useState(false);
  const [showDelete,  setShowDelete]  = useState(false);
  const [showCollect, setShowCollect] = useState(false);

  const testLabel = testLabelOf(request, type);
  const payment   = request.payment ?? null;
  // A paid request cannot be deleted (the backend also returns 409).
  const showDeleteButton  = canDelete && !payment;
  // Offline-created requests (temp id) don't exist server-side yet — payment
  // collection is online-only, so it waits until the request has synced.
  // A Billing-created request is paid in Billing (Mark Paid), never here.
  const billedInBilling   = !!request.chargeId;
  const showCollectButton = canCollectPayment && !payment && !billedInBilling && !isTempId(request.requestId);
  const showReceiptButton = canDownloadReceipt && !!payment?.receiptAvailable;
  // Reports can only be uploaded after payment is collected (the backend
  // rejects an unpaid upload with 409).
  const canUploadNow      = canUpload && request.status !== 'COMPLETED';
  const showUploadButton  = canUploadNow && !!payment;

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-5 gap-2 py-2 border-b last:border-0">
      <span className="col-span-2 text-sm text-muted-foreground">{label}</span>
      <span className="col-span-3 text-sm font-medium break-words">{value ?? '—'}</span>
    </div>
  );

  return (
    <>
      <DialogOverlay className="justify-end bg-black/40" onClick={onClose}>
        <div
          className="relative flex flex-col h-full w-full max-w-md bg-background shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between p-5 border-b shrink-0">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(request.status)} className={STATUS_BADGE_CLASS}>{request.status.replace('_', ' ')}</Badge>
                <span className="text-xs text-muted-foreground capitalize">{type}</span>
              </div>
              <p className="text-sm font-semibold">{testLabel}</p>
            </div>
            <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {row('Patient Name',  request.fullName ?? '—')}
            {row('UHID',         <span className="font-mono text-xs">{request.patientId}</span>)}
            {row('Requested By', request.requestedByName ?? '—')}
            {row('Referred By',  <span className="block truncate" title={request.referredByName}>{request.referredByName}</span>)}
            {row('Requested At', formatDate(request.requestedAt))}
            {row('Updated At',   formatDate(request.updatedAt))}
            {row('Priority', (
              <span className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                request.priority === 'URGENT'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-700',
              )}>
                {request.priority}
              </span>
            ))}
            {row('Notes', <RichTextDisplay value={request.notes} />)}
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
            ) : 'No report uploaded')}
            {row('Payment', payment ? (
              <span className="space-y-1 block">
                <Badge variant="success">Paid</Badge>
                <span className="block text-xs font-normal text-muted-foreground">
                  {formatINR(payment.amount)} · {paymentModeLabel(payment)} · {formatDate(payment.paidAt)}
                </span>
              </span>
            ) : (
              <span className="space-y-1 block">
                <Badge variant="warning">Unpaid</Badge>
                {billedInBilling && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    Billed in Billing (charge {request.chargeId}) — collect the payment there.
                  </span>
                )}
              </span>
            ))}
          </div>

          {(canUploadNow || canEdit || showDeleteButton || showCollectButton || showReceiptButton) && (
            <div className="shrink-0 p-5 border-t space-y-2">
              {showCollectButton && (
                <Button className="w-full" onClick={() => setShowCollect(true)}>
                  <IndianRupee className="h-4 w-4 mr-2" />
                  Collect Payment
                </Button>
              )}
              {showReceiptButton && payment && (
                <LabReceiptButton paymentId={payment.paymentId} />
              )}
              {showUploadButton && (
                <Button className="w-full" onClick={() => setShowUpload(true)}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Report
                </Button>
              )}
              {canUploadNow && !payment && (
                <p className="text-xs text-muted-foreground text-center">
                  {billedInBilling
                    ? 'The report can be uploaded once the payment has been collected in Billing.'
                    : 'The report can be uploaded once payment has been collected.'}
                </p>
              )}
              {canEdit && request.status !== 'COMPLETED' && (
                <Button variant="outline" className="w-full" onClick={() => setShowEdit(true)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Request
                </Button>
              )}
              {showDeleteButton && (
                <Button
                  variant="outline"
                  className="w-full text-destructive hover:bg-destructive/10"
                  onClick={() => setShowDelete(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Request
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogOverlay>

      {showUpload && (
        <ReportUploadModal
          requestId={request.requestId}
          type={type}
          onClose={() => { setShowUpload(false); onClose(); }}
        />
      )}
      {showEdit && (
        <EditRequestModal
          request={request}
          type={type}
          onClose={() => { setShowEdit(false); onClose(); }}
        />
      )}
      {showDelete && (
        <DeleteRequestModal
          requestId={request.requestId}
          type={type}
          onClose={() => { setShowDelete(false); onClose(); }}
        />
      )}
      {showCollect && (
        <CollectPaymentModal
          request={request}
          type={type}
          onClose={() => setShowCollect(false)}
        />
      )}
    </>
  );
}

// ─── Requests Table ───────────────────────────────────────────────────────────

const LAB_REQUESTS_PAGE_SIZE = 10;

interface RequestsTableProps {
  type:      'pathology' | 'radiology';
  canCreate: boolean;
  canUpload: boolean;
  canEdit:   boolean;
  canDelete: boolean;
  canCollectPayment:  boolean;
  canDownloadReceipt: boolean;
}

function RequestsTable({
  type, canCreate, canUpload, canEdit, canDelete, canCollectPayment, canDownloadReceipt,
}: RequestsTableProps) {
  // Initialize from the URL (e.g. the dashboard "Pending Lab Reports" card links
  // here as /lab?status=PENDING) so the first query already carries the filter.
  // SSR-guarded for static prerendering.
  const [statusFilter,  setStatusFilter]  = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const status = (new URLSearchParams(window.location.search).get('status') ?? '').toUpperCase();
    return ['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(status) ? status : '';
  });
  const [searchFilter,  setSearchFilter]  = useState('');
  const [searchInput,   setSearchInput]   = useState('');
  const [page,          setPage]          = useState(1);
  const [showNewRequest,setShowNewRequest]= useState(false);
  const [selected,      setSelected]      = useState<PathologyRequestResponse | RadiologyRequestResponse | null>(null);
  const [collectFor,    setCollectFor]    = useState<{ request: LabRequest; justCreated: boolean } | null>(null);

  const pathologyResult = useListPathologyRequestsQuery(
    { search: searchFilter || undefined, status: statusFilter || undefined, page, limit: LAB_REQUESTS_PAGE_SIZE },
    { skip: type !== 'pathology' },
  );
  const radiologyResult = useListRadiologyRequestsQuery(
    { search: searchFilter || undefined, status: statusFilter || undefined, page, limit: LAB_REQUESTS_PAGE_SIZE },
    { skip: type !== 'radiology' },
  );

  const result      = type === 'pathology' ? pathologyResult : radiologyResult;
  const requests    = result.data?.data ?? [];
  const total       = result.data?.total ?? requests.length;
  const totalPages  = result.data?.totalPages ?? 1;
  const isFetching  = result.isFetching;
  // Upper bound counts the rows actually returned, so the offline-cache
  // fallback (all cached matches on one page) still reads "1–N of N".
  const rangeStart  = total === 0 ? 0 : (page - 1) * LAB_REQUESTS_PAGE_SIZE + 1;
  const rangeEnd    = total === 0 ? 0 : Math.min((page - 1) * LAB_REQUESTS_PAGE_SIZE + requests.length, total);
  const serialStart = serialOffset(result.data, page, LAB_REQUESTS_PAGE_SIZE);

  // A request removed from the last page (delete, or a status change under an
  // active status filter) can leave `page` past the end — step back so the
  // table never sits on an empty page. Skipped while a fetch is in flight so a
  // stale previous-args result never drives the clamp.
  const listData = result.data;
  useEffect(() => {
    if (!isFetching && listData && page > 1 && page > listData.totalPages) setPage(Math.max(1, listData.totalPages));
  }, [isFetching, listData, page]);
  // The detail panel follows the refreshed list row (e.g. Paid after a
  // collection) instead of the snapshot taken when it was opened.
  const liveSelected = selected
    ? (requests.find((r) => r.requestId === selected.requestId) ?? selected)
    : null;

  function handleSearch() {
    setSearchFilter(searchInput.trim());
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 flex-1 min-w-40">
          <Label className="text-xs">Search</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Patient name or UHID…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="h-9"
            />
            <Button variant="outline" size="sm" onClick={handleSearch} className="h-9">
              <Search className="h-4 w-4" />
            </Button>
            {searchFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => { setSearchFilter(''); setSearchInput(''); setPage(1); }}
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
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16 whitespace-nowrap">S. No.</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      {type === 'pathology' ? 'Test Type' : 'Imaging Type'}
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Referred By</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Requested</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Priority</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Payment</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r, idx) => {
                    const label = type === 'pathology'
                      ? (r as PathologyRequestResponse).testType
                      : (r as RadiologyRequestResponse).imagingType;
                    return (
                      <tr
                        key={r.requestId}
                        className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelected(r)}
                      >
                        <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">{serialNumber(serialStart, idx)}</td>
                        <td className="px-4 py-3 font-medium max-w-xs truncate">{label}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium">{r.fullName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{r.patientId}</p>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                          <span className="block max-w-[10rem] truncate" title={r.referredByName}>
                            {r.referredByName}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                          {formatDate(r.requestedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariant(r.status)} className={STATUS_BADGE_CLASS}>{r.status.replace('_', ' ')}</Badge>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            r.priority === 'URGENT'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-600',
                          )}>
                            {r.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {r.payment
                            ? <Badge variant="success">Paid</Badge>
                            : <Badge variant="warning">Unpaid</Badge>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {canCollectPayment && !r.payment && !r.chargeId && !isTempId(r.requestId) && (
                              <button
                                className="text-xs text-primary hover:underline"
                                onClick={(e) => { e.stopPropagation(); setCollectFor({ request: r, justCreated: false }); }}
                              >
                                Collect
                              </button>
                            )}
                            <button
                              className="text-xs text-primary hover:underline"
                              onClick={(e) => { e.stopPropagation(); setSelected(r); }}
                            >
                              View
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination + count */}
          {result.data && !isFetching && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>
                {total === 0
                  ? 'No requests'
                  : `Showing ${rangeStart}–${rangeEnd} of ${total} request${total !== 1 ? 's' : ''}`}
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
        </CardContent>
      </Card>

      {/* New request modal */}
      {showNewRequest && (
        <NewRequestModal
          type={type}
          onClose={() => setShowNewRequest(false)}
          onCreated={(created) => {
            if (canCollectPayment && !isTempId(created.requestId)) {
              setCollectFor({ request: created, justCreated: true });
            }
          }}
        />
      )}

      {/* Request detail panel */}
      {liveSelected && (
        <RequestDetailPanel
          request={liveSelected}
          type={type}
          canUpload={canUpload}
          canEdit={canEdit}
          canDelete={canDelete}
          canCollectPayment={canCollectPayment}
          canDownloadReceipt={canDownloadReceipt}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Collect payment (row action, or straight after creating a request) */}
      {collectFor && (
        <CollectPaymentModal
          request={collectFor.request}
          type={type}
          justCreated={collectFor.justCreated}
          onClose={() => setCollectFor(null)}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabType = 'pathology' | 'radiology';

const LAB_ALLOWED_ROLES = ['DOCTOR', 'HOSPITAL_ADMIN', 'ADMIN', 'MANAGER', 'NURSE', 'PATHOLOGIST', 'RADIOLOGIST', 'RECEPTIONIST'];

export default function LabPage() {
  const router = useRouter();
  const role = useAppSelector((s) => s.auth.profile?.role);
  const [activeTab, setActiveTab] = useState<TabType>('pathology');

  useEffect(() => {
    if (role && !LAB_ALLOWED_ROLES.includes(role)) {
      router.replace('/dashboard');
    }
  }, [role, router]);

  // PATHOLOGIST/RADIOLOGIST may only create requests for their own request
  // type — mirrors the backend's per-route requireRole (also enforced there).
  const canCreatePathology = ['DOCTOR', 'HOSPITAL_ADMIN', 'NURSE', 'PATHOLOGIST', 'RECEPTIONIST'].includes(role ?? '');
  const canCreateRadiology = ['DOCTOR', 'HOSPITAL_ADMIN', 'NURSE', 'RADIOLOGIST', 'RECEPTIONIST'].includes(role ?? '');
  const canCreate = activeTab === 'pathology' ? canCreatePathology : canCreateRadiology;
  const canUploadPathology = ['PATHOLOGIST', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canUploadRadiology = ['RADIOLOGIST', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canUpload = activeTab === 'pathology' ? canUploadPathology : canUploadRadiology;

  const canEditPathology   = ['PATHOLOGIST', 'DOCTOR', 'HOSPITAL_ADMIN', 'MANAGER'].includes(role ?? '');
  const canEditRadiology   = ['RADIOLOGIST', 'DOCTOR', 'HOSPITAL_ADMIN', 'MANAGER'].includes(role ?? '');
  const canEdit   = activeTab === 'pathology' ? canEditPathology   : canEditRadiology;
  const canDelete = activeTab === 'pathology' ? canEditPathology   : canEditRadiology;

  // Lab payment collection — mirrors POST /api/lab/{type}/:requestId/payment's
  // requireRole. Receipt download mirrors GET /api/payments/:id/receipt's
  // roles (intersected with the roles that can open the Lab section).
  const canCollectPayment  = ['RECEPTIONIST', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canDownloadReceipt = ['RECEPTIONIST', 'HOSPITAL_ADMIN', 'MANAGER', 'ADMIN'].includes(role ?? '');

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
        canEdit={canEdit}
        canDelete={canDelete}
        canCollectPayment={canCollectPayment}
        canDownloadReceipt={canDownloadReceipt}
      />
    </div>
  );
}
