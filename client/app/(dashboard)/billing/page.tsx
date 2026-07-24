'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useListChargesQuery, useAddChargeMutation, useCancelChargeMutation, useMarkChargePaidMutation } from '@/store/api/charges.api';
import { useListLabTestTypesQuery } from '@/store/api/lab.api';
import { useAppSelector } from '@/store/hooks';
import type { ChargeCategory, ChargeStatus } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { todayLocalISO, clampToToday } from '@/lib/date';
import { cn, toTitleCase } from '@/lib/utils';
import { Plus, X } from 'lucide-react';

const CATEGORIES: ChargeCategory[] = [
  'CONSULTATION', 'PROCEDURE', 'LAB_TEST', 'MEDICATION', 'ROOM', 'NURSING', 'PACKAGE', 'OTHER',
];

// Paid = settled (green), Unpaid = outstanding (amber), Cancelled = void (red).
const STATUS_STYLES: Record<ChargeStatus, string> = {
  PAID:      'bg-green-100 text-green-800 ring-green-600/20',
  UNPAID:    'bg-amber-100 text-amber-800 ring-amber-600/20',
  CANCELLED: 'bg-red-100 text-red-800 ring-red-600/20',
};

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
function AddChargeModal({ onClose }: { onClose: () => void }) {
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
    if (!patientId.trim())    { setError('Patient ID is required.'); return; }
    if (!description.trim())  { setError('Description is required.'); return; }
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0.01) {
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
      setError('Failed to add charge. Check the Patient ID and try again.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
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

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="add-patient">Patient ID</Label>
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
                {CATEGORIES.map((c) => <option key={c} value={c}>{toTitleCase(c)}</option>)}
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
                min="0.01"
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
        </form>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const router  = useRouter();
  const profile = useAppSelector((s) => s.auth.profile);

  const allowedRoles = ['HOSPITAL_ADMIN', 'ADMIN', 'MANAGER', 'FINANCE_MANAGER'];
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

  const { data, isLoading, isError } = useListChargesQuery({
    patientId:   patientId || undefined,
    category:    category  || undefined,
    startDate:   startDate ? clampToToday(startDate) : undefined,
    endDate:     endDate   ? clampToToday(endDate)   : undefined,
    addedByName: addedBy   || undefined,
    page,
    limit: 20,
  });

  const canManageCharge = ['HOSPITAL_ADMIN', 'ADMIN', 'FINANCE_MANAGER'].includes(profile?.role ?? '');
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
          <Label>Patient ID</Label>
          <Input value={patientId} onChange={e => { setPatientId(e.target.value); setPage(1); }} placeholder="PAT-XXXXXXXX" />
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
          <Input value={addedBy} onChange={e => { setAddedBy(e.target.value); setPage(1); }} placeholder="Staff name" />
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
      {data && data.data.length === 0 && <p className="text-muted-foreground">No charges found.</p>}

      <div className="space-y-2">
        {data?.data.map((charge) => (
          <div key={charge.chargeId} className="border rounded p-3 flex items-start justify-between text-sm">
            <div className="space-y-0.5">
              <p className="font-medium">{charge.description}</p>
              <p className="text-muted-foreground">{charge.patientId} · {charge.category.replace(/_/g, ' ')}</p>
              <p className="text-muted-foreground">
                {new Date(charge.createdAt).toLocaleDateString()} · Added by {charge.addedByName ?? 'Unknown'}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="font-medium">₹{charge.amount.toFixed(2)}</span>
              <ChargeStatusBadge status={charge.status} />
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

      {data && data.totalPages > 1 && (
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="text-sm">{page} / {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
