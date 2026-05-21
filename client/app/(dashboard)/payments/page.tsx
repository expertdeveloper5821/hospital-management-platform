'use client';

import { useState, useCallback } from 'react';
import {
  useListPaymentsQuery,
  useCreateManualPaymentMutation,
  useCreateRazorpayOrderMutation,
  useLazyGetReceiptUrlQuery,
  useGetPaymentSummaryQuery,
} from '@/store/api/payment.api';
import { useAppSelector } from '@/store/hooks';
import type {
  PaymentResponse,
  PaymentMethod,
  CreateManualPaymentRequest,
  CreateRazorpayOrderRequest,
} from '@/store/types';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Badge }    from '@/components/ui/badge';
import {
  Card, CardHeader, CardTitle, CardContent,
} from '@/components/ui/card';
import {
  CreditCard,
  Plus,
  X,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  IndianRupee,
  CheckCircle2,
  Clock,
  XCircle,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH:   'Cash',
  CHEQUE: 'Cheque',
  UPI:    'UPI',
  CARD:   'Card',
};

const METHOD_COLORS: Record<PaymentMethod, string> = {
  CASH:   'bg-green-100 text-green-800 border-green-300',
  CHEQUE: 'bg-blue-100 text-blue-800 border-blue-300',
  UPI:    'bg-purple-100 text-purple-800 border-purple-300',
  CARD:   'bg-orange-100 text-orange-800 border-orange-300',
};

// Dynamically loads the Razorpay checkout script
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as any).Razorpay) { resolve(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload  = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

// ─── Manual Payment Modal ─────────────────────────────────────────────────────

interface ManualPaymentModalProps {
  onClose: () => void;
}

function ManualPaymentModal({ onClose }: ManualPaymentModalProps) {
  const [form, setForm] = useState<CreateManualPaymentRequest>({
    patientId:     '',
    amount:        0,
    paymentMethod: 'CASH',
    description:   '',
  });
  const [error, setError] = useState('');
  const [createManualPayment, { isLoading }] = useCreateManualPaymentMutation();

  function set<K extends keyof CreateManualPaymentRequest>(
    field: K, value: CreateManualPaymentRequest[K],
  ) {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.patientId.trim())   { setError('Patient ID is required.'); return; }
    if (form.amount <= 0)         { setError('Amount must be greater than zero.'); return; }
    if (!form.description.trim()) { setError('Description is required.'); return; }

    try {
      await createManualPayment(form).unwrap();
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to record payment.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-base font-semibold">Record Manual Payment</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Cash or Cheque</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mp-pid">Patient ID *</Label>
            <Input
              id="mp-pid"
              value={form.patientId}
              onChange={(e) => set('patientId', e.target.value)}
              placeholder="e.g. PAT-00123"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mp-amount">Amount (₹) *</Label>
            <Input
              id="mp-amount"
              type="number"
              min={1}
              step={0.01}
              value={form.amount || ''}
              onChange={(e) => set('amount', parseFloat(e.target.value) || 0)}
              placeholder="e.g. 500"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Payment Method *</Label>
            <div className="flex gap-3">
              {(['CASH', 'CHEQUE'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set('paymentMethod', m)}
                  className={cn(
                    'flex-1 rounded-md border py-2 text-sm font-medium transition-colors',
                    form.paymentMethod === m
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  {METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mp-desc">Description *</Label>
            <textarea
              id="mp-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="e.g. OPD consultation fee, Lab test charges…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Recording…' : 'Record Payment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Razorpay Payment Modal ───────────────────────────────────────────────────

interface RazorpayModalProps {
  onClose:   () => void;
  onSuccess: () => void;
}

function RazorpayModal({ onClose, onSuccess }: RazorpayModalProps) {
  const [form, setForm] = useState<CreateRazorpayOrderRequest>({
    patientId:     '',
    amount:        0,
    paymentMethod: 'UPI',
    description:   '',
  });
  const [error,      setError]      = useState('');
  const [isLaunching, setLaunching] = useState(false);
  const [createOrder]               = useCreateRazorpayOrderMutation();

  function set<K extends keyof CreateRazorpayOrderRequest>(
    field: K, value: CreateRazorpayOrderRequest[K],
  ) {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  }

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.patientId.trim())   { setError('Patient ID is required.'); return; }
    if (form.amount <= 0)         { setError('Amount must be greater than zero.'); return; }
    if (!form.description.trim()) { setError('Description is required.'); return; }

    setLaunching(true);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) { setError('Failed to load Razorpay checkout. Check your internet connection.'); setLaunching(false); return; }

      const order = await createOrder(form).unwrap();

      const rzpOptions = {
        key:         order.keyId,
        amount:      order.amountPaise,
        currency:    order.currency,
        order_id:    order.razorpayOrderId,
        name:        'Hospital Management',
        description: form.description,
        prefill:     { contact: '', email: '' },
        theme:       { color: '#1A73E8' },
        handler: () => {
          // Webhook handles backend update; show success on frontend
          onSuccess();
        },
        modal: {
          ondismiss: () => {
            setLaunching(false);
          },
        },
      };

      const rzp = new (window as any).Razorpay(rzpOptions);
      rzp.on('payment.failed', () => {
        setError('Payment failed. Please try again.');
        setLaunching(false);
      });
      rzp.open();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to initiate payment.');
      setLaunching(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-base font-semibold">Pay via Razorpay</h2>
            <p className="text-xs text-muted-foreground mt-0.5">UPI or Card</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleLaunch} className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rp-pid">Patient ID *</Label>
            <Input
              id="rp-pid"
              value={form.patientId}
              onChange={(e) => set('patientId', e.target.value)}
              placeholder="e.g. PAT-00123"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-amount">Amount (₹) *</Label>
            <Input
              id="rp-amount"
              type="number"
              min={1}
              step={0.01}
              value={form.amount || ''}
              onChange={(e) => set('amount', parseFloat(e.target.value) || 0)}
              placeholder="e.g. 1000"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Payment Method *</Label>
            <div className="flex gap-3">
              {(['UPI', 'CARD'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set('paymentMethod', m)}
                  className={cn(
                    'flex-1 rounded-md border py-2 text-sm font-medium transition-colors',
                    form.paymentMethod === m
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  {METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-desc">Description *</Label>
            <textarea
              id="rp-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="e.g. IPD admission fee, Surgery charges…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              required
            />
          </div>

          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
            You will be redirected to Razorpay's secure checkout. The receipt is generated automatically after payment confirmation.
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLaunching}>Cancel</Button>
            <Button type="submit" disabled={isLaunching}>
              {isLaunching ? 'Launching checkout…' : 'Open Razorpay Checkout'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Razorpay Success Banner ──────────────────────────────────────────────────

function RazorpaySuccessBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-green-400 bg-green-50 px-4 py-3">
      <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
      <p className="flex-1 text-sm text-green-800">
        Payment initiated via Razorpay. The receipt will be available once the webhook confirms the transaction.
      </p>
      <button onClick={onDismiss} className="text-green-600 hover:text-green-800">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Receipt Download Button ──────────────────────────────────────────────────

function ReceiptButton({ paymentId, status }: { paymentId: string; status: string }) {
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

  if (status !== 'COMPLETED') return null;

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        onClick={handleDownload}
        disabled={isFetching}
        className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
      >
        <Download className="h-3 w-3" />
        {isFetching ? 'Loading…' : 'Receipt'}
      </button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}

// ─── Payment Detail Panel ─────────────────────────────────────────────────────

interface PaymentDetailPanelProps {
  payment: PaymentResponse;
  onClose: () => void;
}

function PaymentDetailPanel({ payment, onClose }: PaymentDetailPanelProps) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-5 gap-2 py-2 border-b last:border-0">
      <span className="col-span-2 text-sm text-muted-foreground">{label}</span>
      <span className="col-span-3 text-sm font-medium break-words">{value ?? '—'}</span>
    </div>
  );

  const statusIcon = {
    COMPLETED: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    PENDING:   <Clock className="h-4 w-4 text-yellow-600" />,
    FAILED:    <XCircle className="h-4 w-4 text-red-600" />,
  }[payment.status];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="relative flex flex-col h-full w-full max-w-md bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', METHOD_COLORS[payment.paymentMethod])}>
                {METHOD_LABELS[payment.paymentMethod]}
              </span>
              <div className="flex items-center gap-1">
                {statusIcon}
                <span className="text-xs text-muted-foreground">{payment.status}</span>
              </div>
            </div>
            <p className="text-2xl font-bold">{formatINR(payment.amount)}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {row('Payment ID',   <span className="font-mono text-xs">{payment.paymentId}</span>)}
          {row('Patient ID',   <span className="font-mono text-xs">{payment.patientId}</span>)}
          {row('Method',       METHOD_LABELS[payment.paymentMethod])}
          {row('Amount',       formatINR(payment.amount))}
          {row('Description',  payment.description)}
          {row('Status',       payment.status)}
          {payment.razorpayOrderId && row('Razorpay Order', <span className="font-mono text-xs break-all">{payment.razorpayOrderId}</span>)}
          {payment.razorpayPaymentId && row('Razorpay Payment', <span className="font-mono text-xs break-all">{payment.razorpayPaymentId}</span>)}
          {row('Created',      formatDateTime(payment.createdAt))}
          {row('Updated',      formatDateTime(payment.updatedAt))}
        </div>

        {payment.status === 'COMPLETED' && (
          <div className="shrink-0 p-5 border-t">
            <ReceiptButton paymentId={payment.paymentId} status={payment.status} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

type SummaryKey = 'CASH' | 'CHEQUE' | 'UPI' | 'CARD';

const SUMMARY_ITEMS: Array<{ label: string; key: SummaryKey; color: string }> = [
  { label: 'Cash',   key: 'CASH',   color: 'text-green-700'  },
  { label: 'Cheque', key: 'CHEQUE', color: 'text-blue-700'   },
  { label: 'UPI',    key: 'UPI',    color: 'text-purple-700' },
  { label: 'Card',   key: 'CARD',   color: 'text-orange-700' },
];

interface SummaryCardProps {
  dateFrom: string;
  dateTo:   string;
}

function SummaryCard({ dateFrom, dateTo }: SummaryCardProps) {
  const { data, isFetching } = useGetPaymentSummaryQuery(
    {
      dateFrom: dateFrom || undefined,
      dateTo:   dateTo   || undefined,
    },
    { skip: false },
  );

  const items = SUMMARY_ITEMS;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Payment Summary</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isFetching ? (
          <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
        ) : data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {items.map(({ label, key, color }) => (
                <div key={key} className="rounded-md border bg-muted/20 p-3 space-y-0.5">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={cn('text-base font-bold tabular-nums', color)}>
                    {formatINR(data[key as keyof typeof data] as number)}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-md border px-4 py-3 bg-muted/30">
              <span className="text-sm font-medium">Total Collected</span>
              <span className="text-xl font-bold tabular-nums">{formatINR(data.total)}</span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'COMPLETED') {
    return (
      <Badge variant="outline" className="text-xs text-green-700 border-green-400 gap-1">
        <CheckCircle2 className="h-3 w-3" />Completed
      </Badge>
    );
  }
  if (status === 'PENDING') {
    return (
      <Badge variant="outline" className="text-xs text-yellow-700 border-yellow-400 gap-1">
        <Clock className="h-3 w-3" />Pending
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="text-xs gap-1">
      <XCircle className="h-3 w-3" />Failed
    </Badge>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const role = useAppSelector((s) => s.auth.profile?.role);

  const [dateFrom,       setDateFrom]       = useState('');
  const [dateTo,         setDateTo]         = useState('');
  const [methodFilter,   setMethodFilter]   = useState('');
  const [page,           setPage]           = useState(1);
  const [showManual,     setShowManual]     = useState(false);
  const [showRazorpay,   setShowRazorpay]   = useState(false);
  const [razorpaySuccess, setRazorpaySuccess] = useState(false);
  const [selected,       setSelected]       = useState<PaymentResponse | null>(null);

  const canCreate  = ['RECEPTIONIST', 'FINANCE_MANAGER', 'HOSPITAL_ADMIN'].includes(role ?? '');
  const canView    = ['MANAGER', 'FINANCE_MANAGER', 'HOSPITAL_ADMIN', 'RECEPTIONIST'].includes(role ?? '');
  const canSummary = ['MANAGER', 'FINANCE_MANAGER', 'HOSPITAL_ADMIN'].includes(role ?? '');

  const { data, isFetching, refetch } = useListPaymentsQuery(
    {
      dateFrom:      dateFrom || undefined,
      dateTo:        dateTo   || undefined,
      paymentMethod: methodFilter || undefined,
      page,
      limit: 20,
    },
    { skip: !canView },
  );

  const payments   = data?.data       ?? [];
  const total      = data?.total      ?? 0;
  const totalPages = data?.totalPages ?? 1;

  function clearFilters() {
    setDateFrom('');
    setDateTo('');
    setMethodFilter('');
    setPage(1);
  }

  const hasFilters = !!(dateFrom || dateTo || methodFilter);

  const handleRazorpaySuccess = useCallback(() => {
    setShowRazorpay(false);
    setRazorpaySuccess(true);
    refetch();
  }, [refetch]);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <CreditCard className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm">You do not have access to the payments module.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-sm text-muted-foreground">
            {total} record{total !== 1 ? 's' : ''}
            {hasFilters && ' (filtered)'}
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setShowRazorpay(true)}>
              <CreditCard className="h-4 w-4 mr-2" />
              Razorpay (UPI / Card)
            </Button>
            <Button onClick={() => setShowManual(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Manual Payment
            </Button>
          </div>
        )}
      </div>

      {/* Razorpay success banner */}
      {razorpaySuccess && (
        <RazorpaySuccessBanner onDismiss={() => setRazorpaySuccess(false)} />
      )}

      {/* Summary report */}
      {canSummary && (
        <SummaryCard dateFrom={dateFrom} dateTo={dateTo} />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">From Date</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="h-9 w-40"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To Date</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="h-9 w-40"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Method</Label>
          <select
            value={methodFilter}
            onChange={(e) => { setMethodFilter(e.target.value); setPage(1); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Methods</option>
            <option value="CASH">Cash</option>
            <option value="CHEQUE">Cheque</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
          </select>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 self-end" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-9 self-end"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        </Button>
      </div>

      {/* Payment list table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payment Records</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isFetching ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
              <IndianRupee className="h-8 w-8 opacity-30" />
              {hasFilters ? 'No payments match the current filters.' : 'No payment records found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Method</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Amount</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Date</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr
                      key={p.paymentId}
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setSelected(p)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-muted-foreground">{p.patientId}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{p.description}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                          METHOD_COLORS[p.paymentMethod],
                        )}>
                          {METHOD_LABELS[p.paymentMethod]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatINR(p.amount)}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                        {formatDate(p.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-3">
                          <ReceiptButton paymentId={p.paymentId} status={p.status} />
                          <button
                            className="text-xs text-primary hover:underline"
                            onClick={() => setSelected(p)}
                          >
                            View
                          </button>
                        </div>
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
              <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
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

      {/* Modals */}
      {showManual && (
        <ManualPaymentModal onClose={() => setShowManual(false)} />
      )}
      {showRazorpay && (
        <RazorpayModal
          onClose={() => setShowRazorpay(false)}
          onSuccess={handleRazorpaySuccess}
        />
      )}

      {/* Payment detail panel */}
      {selected && (
        <PaymentDetailPanel
          payment={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
