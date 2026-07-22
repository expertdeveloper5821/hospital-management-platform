'use client';

import { useParams } from 'next/navigation';
import { useGetPatientBillQuery, useCancelChargeMutation, useMarkChargePaidMutation } from '@/store/api/charges.api';
import { useAppSelector } from '@/store/hooks';
import type { ChargeStatus } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cn, toTitleCase } from '@/lib/utils';

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

export default function PatientBillPage() {
  const params  = useParams<{ patientId: string }>();
  const profile = useAppSelector((s) => s.auth.profile);

  const { data: bill, isLoading, isError } = useGetPatientBillQuery(params.patientId);
  const [cancelCharge,   { isLoading: cancelling }] = useCancelChargeMutation();
  const [markChargePaid, { isLoading: paying     }] = useMarkChargePaidMutation();
  const busy = cancelling || paying;

  const canManage = ['HOSPITAL_ADMIN', 'ADMIN', 'RECEPTIONIST', 'FINANCE_MANAGER'].includes(profile?.role ?? '');

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading bill…</p>;
  if (isError)   return <p className="p-6 text-red-600">Failed to load bill.</p>;
  if (!bill)     return null;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Patient Bill</h1>
      <p className="text-muted-foreground text-sm">Patient: {params.patientId}</p>

      <Card>
        <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {Object.entries(bill.categorySubtotals).map(([cat, total]) => (
            <div key={cat} className="flex justify-between">
              <span className="capitalize">{cat.replace(/_/g, ' ').toLowerCase()}</span>
              <span>₹{(total as number).toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t pt-2 flex justify-between font-bold text-base">
            <span>Grand Total</span>
            <span>₹{bill.grandTotal.toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      {bill.lineItems.length === 0 ? (
        <p className="text-muted-foreground">No charges recorded yet.</p>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Charges ({bill.lineItems.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {bill.lineItems.map((charge) => (
              <div key={charge.chargeId} className="flex items-start justify-between border rounded p-3 text-sm">
                <div className="space-y-1">
                  <p className="font-medium">{charge.description}</p>
                  <p className="text-muted-foreground">{charge.category.replace(/_/g, ' ')}</p>
                  <p className="text-muted-foreground">{new Date(charge.createdAt).toLocaleDateString()}</p>
                  <p className="text-muted-foreground">Added by: {charge.addedBy}</p>
                  {charge.paidAt && (
                    <p className="text-muted-foreground">Paid: {new Date(charge.paidAt).toLocaleDateString()}</p>
                  )}
                  {charge.cancelledAt && (
                    <p className="text-muted-foreground">Cancelled: {new Date(charge.cancelledAt).toLocaleDateString()}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-medium">₹{charge.amount.toFixed(2)}</span>
                  <ChargeStatusBadge status={charge.status} />
                  {canManage && charge.status === 'UNPAID' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-700 border-green-600/40 hover:bg-green-50"
                        disabled={busy}
                        onClick={() => markChargePaid(charge.chargeId)}
                      >
                        Mark Paid
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => cancelCharge(charge.chargeId)}>
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
