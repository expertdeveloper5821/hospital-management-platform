'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useListChargesQuery, useAddChargeMutation, useCancelChargeMutation, useMarkChargePaidMutation } from '@/store/api/charges.api';
import { useListLabTestTypesQuery } from '@/store/api/lab.api';
import { useLazyGetReceiptUrlQuery } from '@/store/api/payment.api';
import { useAppSelector } from '@/store/hooks';
import type { ChargeCategory, ChargeStatus } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { todayLocalISO, clampToToday } from '@/lib/date';
import { cn, toTitleCase } from '@/lib/utils';
import { Plus, X } from 'lucide-react';
import { NavForm } from '@/components/ui/form';

// Backend caps charges list pages at 20.
const CHARGES_PAGE_SIZE = 20;

const CATEGORIES: ChargeCategory[] = [
  'CONSULTATION', 'PROCEDURE', 'LAB_TEST', 'MEDICATION', 'ROOM', 'NURSING', 'PACKAGE', 'OTHER',
];

// Paid = settled (green), Unpaid = outstanding (amber), Cancelled = void (red).
const STATUS_STYLES: Record<ChargeStatus, string> = {
  PAID:      'bg-green-100 text-green-800 ring-green-600/20',
  UNPAID:    'bg-amber-100 text-amber-800 ring-amber-600/20',
  CANCELLED: 'bg-red-100 text-red-800 ring-red-600/20',
};

// Same flow as the Lab/Payments receipt buttons: fetch a short-lived
// pre-signed URL for the charge payment's stored receipt PDF and open it.
function ChargeReceiptButton({ paymentId }: { paymentId: string }) {
  const [trigger, { isFetching }] = useLazyGetReceiptUrlQuery();
  const [err, setErr] = useState(false);

  async function handleDownload() {
    setErr(false);
    try {
      const url = await trigger(paymentId).unwrap();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setErr(true);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      disabled={isFetching}
      onClick={handleDownload}
      title={err ? 'Receipt not available.' : undefined}
    >
      {isFetching ? 'Loading…' : err ? 'Receipt unavailable' : 'Receipt'}
    </Button>
  );
}

function ChargeStatusBadge({ status }: { status: ChargeStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700 ring-slate-600/20',
      )}
    >
      {toTitleCase(status)}
    </span>
  );
}

// ADMIN / HOSPITAL_ADMIN / FINANCE_MANAGER can create charges from this
// cross-patient screen, and the backend permits them every category. MANAGER
// can view the billing list but is rejected by the API on create, so no modal.
// RECEPTIONIST may add charges too, but the backend excludes ROOM and NURSING for it.
function AddChargeModal({ onClose }: { onClose: () => void }) {
  const role = useAppSelector((s) => s.auth.profile?.role);
  const categories = role === 'RECEPTIONIST'
    ? CATEGORIES.filter((c) => c !== 'ROOM' && c !== 'NURSING')
    : CATEGORIES;
  const [addCharge, { isLoading }] = useAddChargeMutation();
  const [patientId, setPatientId]     = useState('');
  const [category, setCategory]       = useState<ChargeCategory>('CONSULTATION');
  const [amount, setAmount]           = useState('');
  const [description, setDescription] = useState('');
  const [testTypeId, setTestTypeId]   = useState('');
  const [error, setError]             = useState<string | null>(null);

  const isLabTest = category === 'LAB_TEST';
  const { data: testTypes, isLoading: loadingTestTypes } = useListLabTestTypesQuery(undefined, { skip: !isLabTest });

  function handleCategoryChange(next: ChargeCategory) {
    setCategory(next);
    if (next !== 'LAB_TEST') setTestTypeId('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedAmount = Number(amount);
    if (!patientId.trim())    { setError('UHID is required.'); return; }
    if (!description.trim())  { setError('Description is required.'); return; }
    // A Lab Test may be free (₹0) — it is then marked Paid with a ₹0 receipt.
    if (isLabTest && (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      setError('Amount must be ₹0 or more.'); return;
    }
    if (!isLabTest && (!Number.isFinite(parsedAmount) || parsedAmount < 0.01)) {
      setError('Amount must be at least ₹0.01.'); return;
    }
    const selectedTestType = testTypes?.find((t) => t.id === testTypeId);
    if (isLabTest && !selectedTestType) {
      setError('Test Type is required for Lab Test charges.'); return;
    }

    try {
      await addCharge({
        patientId: patientId.trim(),
        category,
        description: description.trim(),
        amount: Math.round(parsedAmount * 100) / 100,
        ...(isLabTest && selectedTestType
          ? { testTypeId: selectedTestType.id, testTypeName: selectedTestType.name }
          : {}),
      }).unwrap();
      // The billing list refreshes automatically via invalidated cache tags.
      onClose();
    } catch {
      setError('Failed to add charge. Check the UHID and try again.');
    }
  }

  return (
    <DialogOverlay
      className="items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-lg space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Add Charge</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <NavForm onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="add-patient">UHID</Label>
              <Input
                id="add-patient"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="PAT-XXXXXXXX"
              />
            </div>
            <div>
              <Label htmlFor="add-category">Category</Label>
              <select
                id="add-category"
                className="w-full border rounded px-3 py-2 text-sm"
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value as ChargeCategory)}
              >
                {categories.map((c) => <option key={c} value={c}>{toTitleCase(c)}</option>)}
              </select>
            </div>
            {isLabTest && (
              <div>
                <Label htmlFor="add-test-type">Test Type</Label>
                <select
                  id="add-test-type"
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={testTypeId}
                  onChange={(e) => setTestTypeId(e.target.value)}
                  disabled={loadingTestTypes}
                >
                  <option value="">
                    {loadingTestTypes ? 'Loading test types…' : 'Select a test type'}
                  </option>
                  {testTypes?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({toTitleCase(t.category)})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="add-amount">Amount (₹)</Label>
              <Input
                id="add-amount"
                type="number"
                min={isLabTest ? '0' : '0.01'}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="add-description">Description</Label>
              <Input
                id="add-description"
                value={description}
                maxLength={500}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Consultation fee"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isLoading}>
              {isLoading ? 'Adding…' : 'Add Charge'}
            </Button>
          </div>
        </NavForm>
      </div>
    </DialogOverlay>
  );
}

export default function BillingPage() {
  const router  = useRouter();
  const profile = useAppSelector((s) => s.auth.profile);

  const allowedRoles = ['HOSPITAL_ADMIN', 'ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'RECEPTIONIST'];
  if (profile && !allowedRoles.includes(profile.role)) {
    router.replace('/dashboard');
    return null;
  }

  const [patientId, setPatientId]   = useState('');
  const [category, setCategory]     = useState<ChargeCategory | ''>('');
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [addedBy, setAddedBy]       = useState('');
  const [page, setPage]             = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  // Free-text filters are debounced (300ms) so typing doesn't fire a request
  // per keystroke; a new value always starts from page 1.
  const [debouncedPatientId, setDebouncedPatientId] = useState('');
  const [debouncedAddedBy, setDebouncedAddedBy]     = useState('');
  // One timer per field, so editing one never cancels the other's pending update.
  const debounceRefs = useRef<Partial<Record<'patientId' | 'addedBy', ReturnType<typeof setTimeout>>>>({});

  function handleTextFilterChange(field: 'patientId' | 'addedBy', value: string) {
    if (field === 'patientId') setPatientId(value); else setAddedBy(value);
    clearTimeout(debounceRefs.current[field]);
    debounceRefs.current[field] = setTimeout(() => {
      if (field === 'patientId') setDebouncedPatientId(value.trim()); else setDebouncedAddedBy(value.trim());
      setPage(1);
    }, 300);
  }
  useEffect(() => () => { Object.values(debounceRefs.current).forEach(clearTimeout); }, []);

  const { data, isLoading, isFetching, isError } = useListChargesQuery({
    patientId:   debouncedPatientId || undefined,
    category:    category  || undefined,
    startDate:   startDate ? clampToToday(startDate) : undefined,
    endDate:     endDate   ? clampToToday(endDate)   : undefined,
    addedByName: debouncedAddedBy   || undefined,
    page,
    limit: CHARGES_PAGE_SIZE,
  });

  const charges    = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  // Derived from the response rather than local state: an offline cache read
  // returns everything matching as a single page (page 1, totalPages 1).
  const rangeStart = total === 0 || !data ? 0 : (data.page - 1) * data.limit + 1;
  const rangeEnd   = rangeStart === 0 ? 0 : rangeStart + charges.length - 1;
  const hasFilters = !!(debouncedPatientId || category || startDate || endDate || debouncedAddedBy);

  // A shrinking result set would otherwise leave `page` past the end and
  // render an empty page.
  useEffect(() => {
    if (!isFetching && data && page > Math.max(1, totalPages)) setPage(Math.max(1, totalPages));
  }, [isFetching, data, page, totalPages]);

  const canManageCharge = ['HOSPITAL_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'RECEPTIONIST'].includes(profile?.role ?? '');
  const canAddCharge = canManageCharge;

  const [cancelCharge,   { isLoading: cancelling }] = useCancelChargeMutation();
  const [markChargePaid, { isLoading: paying     }] = useMarkChargePaidMutation();
  const busy = cancelling || paying;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Billing</h1>
        {canAddCharge && (
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Charge
          </Button>
        )}
      </div>

      {showAddModal && <AddChargeModal onClose={() => setShowAddModal(false)} />}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <Label>UHID</Label>
          <Input value={patientId} onChange={e => handleTextFilterChange('patientId', e.target.value)} placeholder="PAT-XXXXXXXX" />
        </div>
        <div>
          <Label>Category</Label>
          <select
            className="w-full border rounded px-3 py-2 text-sm"
            value={category}
            onChange={e => { setCategory(e.target.value as ChargeCategory | ''); setPage(1); }}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div>
          <Label>Added By</Label>
          <Input value={addedBy} onChange={e => handleTextFilterChange('addedBy', e.target.value)} placeholder="Staff name" />
        </div>
        <div>
          <Label>Start Date</Label>
          <Input type="date" max={todayLocalISO()} value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }} />
        </div>
        <div>
          <Label>End Date</Label>
          <Input type="date" max={todayLocalISO()} value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }} />
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading charges…</p>}
      {isError   && <p className="text-red-600">Failed to load charges.</p>}
      {data && charges.length === 0 && !isFetching && (
        <p className="text-muted-foreground">
          {hasFilters ? 'No charges match your filters.' : 'No charges found.'}
        </p>
      )}

      <div className="space-y-2">
        {charges.map((charge) => (
          <div key={charge.chargeId} className="border rounded p-3 flex items-start justify-between text-sm">
            <div className="space-y-0.5">
              <p className="font-medium">{charge.description}</p>
              <p className="text-muted-foreground">{charge.patientId} · {charge.category.replace(/_/g, ' ')}</p>
              <p className="text-muted-foreground">
                {new Date(charge.createdAt).toLocaleDateString()} · Added by {charge.addedByName ?? 'Unknown'}
              </p>
              {charge.labRequestKind && (
                <p className="text-muted-foreground">
                  {toTitleCase(charge.labRequestKind)} request sent to Lab{charge.testTypeName ? ` · ${charge.testTypeName}` : ''}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="font-medium">₹{charge.amount.toFixed(2)}</span>
              <ChargeStatusBadge status={charge.status} />
              {charge.status === 'PAID' && charge.paymentId && charge.receiptAvailable && (
                <ChargeReceiptButton paymentId={charge.paymentId} />
              )}
              {canManageCharge && charge.status === 'UNPAID' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs text-green-700 border-green-600/40 hover:bg-green-50"
                    disabled={busy}
                    onClick={() => markChargePaid(charge.chargeId)}
                  >
                    Mark Paid
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => cancelCharge(charge.chargeId)}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination + count */}
      {data && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
          <span>Showing {rangeStart}–{rangeEnd} of {total} charge{total !== 1 ? 's' : ''}</span>
          {totalPages > 1 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="flex items-center px-2 text-xs">{page} / {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
