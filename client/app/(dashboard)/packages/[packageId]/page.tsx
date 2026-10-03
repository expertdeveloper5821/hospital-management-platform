'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  useGetPackageQuery,
  useUpdatePackageMutation,
  useAssignPackageMutation,
} from '@/store/api/packages.api';
import { useListWardsQuery } from '@/store/api/ipd.api';
import { useAppSelector } from '@/store/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { NavForm } from '@/components/ui/form';

export default function PackageDetailPage() {
  const params  = useParams<{ packageId: string }>();
  const profile = useAppSelector((s) => s.auth.profile);
  const role    = profile?.role;

  const { data: pkg, isLoading } = useGetPackageQuery(params.packageId);
  const [updatePackage, { isLoading: updating }] = useUpdatePackageMutation();
  const [assignPackage, { isLoading: assigning }] = useAssignPackageMutation();

  const [patientId, setPatientId]       = useState('');
  const [assignedDate, setAssignedDate] = useState('');
  const [assignError, setAssignError]   = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

  const [editStatus, setEditStatus] = useState<'ACTIVE' | 'INACTIVE' | ''>('');
  const [editWardId, setEditWardId] = useState<string | null>(null);
  const [wardError, setWardError]   = useState('');

  const canEdit   = role === 'HOSPITAL_ADMIN' || role === 'ADMIN' || role === 'RECEPTIONIST';
  const { data: wards = [] } = useListWardsQuery(undefined, { skip: !canEdit });
  const canAssign = ['HOSPITAL_ADMIN', 'ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(role ?? '');

  const handleStatusUpdate = async () => {
    if (!editStatus || !pkg) return;
    await updatePackage({ packageId: pkg.packageId, status: editStatus }).unwrap();
    setEditStatus('');
  };

  // '' in the select means "unlink" (wardId: null).
  const handleWardUpdate = async () => {
    if (editWardId === null || !pkg) return;
    setWardError('');
    try {
      await updatePackage({ packageId: pkg.packageId, wardId: editWardId || null }).unwrap();
      setEditWardId(null);
    } catch (err: unknown) {
      setWardError((err as { data?: { message?: string } })?.data?.message ?? 'Failed to update ward.');
    }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    setAssignError('');
    setAssignSuccess('');
    if (!patientId.trim()) { setAssignError('UHID is required'); return; }
    try {
      const result = await assignPackage({
        packageId: params.packageId,
        patientId: patientId.trim(),
        assignedDate: assignedDate || undefined,
      }).unwrap();
      setPatientId(''); setAssignedDate('');
      setAssignSuccess(`Package assigned successfully. Assignment ID: ${result.assignmentId}`);
    } catch {
      setAssignError('This package is already assigned to this patient.');
    }
  };

  const packageId = params.packageId;

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!pkg)      return <p className="p-6 text-red-600">Package not found.</p>;

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{pkg.name}</h1>
        <Badge variant={pkg.status === 'ACTIVE' ? 'success' : 'destructive'}>{pkg.status}</Badge>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-2 text-sm">
          <p><span className="font-medium">Price:</span> ₹{pkg.price.toFixed(2)}</p>
          <p><span className="font-medium">Ward:</span> {pkg.wardName ?? (pkg.wardId ? 'Unknown ward' : 'Not linked')}</p>
          {pkg.description && <p><span className="font-medium">Description:</span> {pkg.description}</p>}
          <div>
            <span className="font-medium">Included Services:</span>
            <ul className="mt-1 list-disc list-inside text-muted-foreground">
              {pkg.includedServices.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">Created: {new Date(pkg.createdAt).toLocaleDateString()}</p>
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader><CardTitle className="text-base">Edit Status</CardTitle></CardHeader>
          <CardContent className="flex gap-3 items-end">
            <select
              className="border rounded px-3 py-2 text-sm"
              value={editStatus}
              onChange={e => setEditStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
            >
              <option value="">Select status…</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
            <Button size="sm" disabled={!editStatus || updating} onClick={handleStatusUpdate}>
              {updating ? 'Updating…' : 'Update'}
            </Button>
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader><CardTitle className="text-base">Linked Ward</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-3 items-end">
              <select
                aria-label="Linked ward"
                className="border rounded px-3 py-2 text-sm"
                value={editWardId ?? (pkg.wardId ?? '')}
                onChange={e => setEditWardId(e.target.value)}
              >
                <option value="">No ward</option>
                {wards.map(w => (
                  <option key={w.wardId} value={w.wardId}>{w.name}</option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={editWardId === null || editWardId === (pkg.wardId ?? '') || updating}
                onClick={handleWardUpdate}
              >
                {updating ? 'Updating…' : 'Update Ward'}
              </Button>
            </div>
            {wardError && <p className="text-red-600 text-sm">{wardError}</p>}
          </CardContent>
        </Card>
      )}

      {canAssign && pkg.status === 'ACTIVE' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Assign to Patient</CardTitle></CardHeader>
          <CardContent>
            <NavForm onSubmit={handleAssign} autoFocusFirstField={false} className="space-y-3">
              <div>
                <Label htmlFor="pid">UHID *</Label>
                <Input id="pid" value={patientId} onChange={e => setPatientId(e.target.value)} placeholder="PAT-XXXXXXXX" />
              </div>
              <div>
                <Label htmlFor="adate">Assigned Date (optional)</Label>
                <Input id="adate" type="date" value={assignedDate} onChange={e => setAssignedDate(e.target.value)} />
              </div>
              {assignError   && <p className="text-red-600 text-sm">{assignError}</p>}
              {assignSuccess && <p className="text-green-600 text-sm">{assignSuccess}</p>}
              <Button type="submit" disabled={assigning}>{assigning ? 'Assigning…' : 'Assign Package'}</Button>
            </NavForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
