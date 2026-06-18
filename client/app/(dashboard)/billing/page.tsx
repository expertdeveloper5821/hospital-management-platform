'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useListChargesQuery } from '@/store/api/charges.api';
import { useAppSelector } from '@/store/hooks';
import type { ChargeCategory } from '@/store/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CATEGORIES: ChargeCategory[] = [
  'CONSULTATION', 'PROCEDURE', 'LAB_TEST', 'MEDICATION', 'ROOM', 'NURSING', 'PACKAGE', 'OTHER',
];

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

  const { data, isLoading, isError } = useListChargesQuery({
    patientId: patientId || undefined,
    category:  category  || undefined,
    startDate: startDate || undefined,
    endDate:   endDate   || undefined,
    addedBy:   addedBy   || undefined,
    page,
    limit: 20,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>

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
          <Input value={addedBy} onChange={e => { setAddedBy(e.target.value); setPage(1); }} placeholder="User ID" />
        </div>
        <div>
          <Label>Start Date</Label>
          <Input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }} />
        </div>
        <div>
          <Label>End Date</Label>
          <Input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }} />
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
              <p className="text-muted-foreground">{new Date(charge.createdAt).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="font-medium">₹{charge.amount.toFixed(2)}</span>
              <Badge variant={charge.status === 'UNPAID' ? 'default' : 'destructive'}>{charge.status}</Badge>
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
