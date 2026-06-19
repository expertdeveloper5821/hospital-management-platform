'use client';

import { useParams } from 'next/navigation';
import { useGetPatientBillQuery, useVoidChargeMutation } from '@/store/api/charges.api';
import { useAppSelector } from '@/store/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function PatientBillPage() {
  const params  = useParams<{ patientId: string }>();
  const profile = useAppSelector((s) => s.auth.profile);

  const { data: bill, isLoading, isError } = useGetPatientBillQuery(params.patientId);
  const [voidCharge] = useVoidChargeMutation();

  const canVoid = ['HOSPITAL_ADMIN', 'ADMIN', 'RECEPTIONIST'].includes(profile?.role ?? '');

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
                  {charge.voidedAt && (
                    <p className="text-muted-foreground">Voided: {new Date(charge.voidedAt).toLocaleDateString()}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-medium">₹{charge.amount.toFixed(2)}</span>
                  <Badge variant={charge.status === 'UNPAID' ? 'default' : 'destructive'}>
                    {charge.status}
                  </Badge>
                  {canVoid && charge.status === 'UNPAID' && (
                    <Button size="sm" variant="outline" onClick={() => voidCharge(charge.chargeId)}>
                      Void
                    </Button>
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
