'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';
import { useCreatePackageMutation } from '@/store/api/packages.api';
import { useListWardsQuery } from '@/store/api/ipd.api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CharCounter } from '@/components/ui/char-counter';
import { NavForm } from '@/components/ui/form';

export default function NewPackagePage() {
  const router  = useRouter();
  const profile = useAppSelector((s) => s.auth.profile);

  if (profile && profile.role !== 'HOSPITAL_ADMIN' && profile.role !== 'ADMIN' && profile.role !== 'RECEPTIONIST') {
    router.replace('/packages');
    return null;
  }

  const [create, { isLoading, error }] = useCreatePackageMutation();
  const { data: wards = [] } = useListWardsQuery();

  // Every package creator may link an existing ward; only a Hospital Admin
  // may create a new ward inline (the backend enforces the same rule).
  const canCreateWard = profile?.role === 'HOSPITAL_ADMIN';

  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice]             = useState('');
  const [services, setServices]       = useState<string[]>(['']);
  const [wardMode, setWardMode]       = useState<'existing' | 'new'>('existing');
  const [wardId, setWardId]           = useState('');
  const [newWardName, setNewWardName] = useState('');
  const [newWardFloor, setNewWardFloor] = useState('');
  const [formError, setFormError]     = useState<string | null>(null);

  const addService    = () => setServices(s => [...s, '']);
  const removeService = (i: number) => setServices(s => s.filter((_, idx) => idx !== i));
  const setService    = (i: number, v: string) => setServices(s => s.map((x, idx) => idx === i ? v : x));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const validServices = services.filter(s => s.trim().length > 0);
    if (!name.trim() || validServices.length === 0 || !price) return;
    const creatingWard = canCreateWard && wardMode === 'new';
    if (creatingWard && !newWardName.trim()) { setFormError('Ward name is required.'); return; }

    try {
      await create({
        name:             name.trim(),
        description:      description.trim() || undefined,
        price:            parseFloat(price),
        includedServices: validServices,
        ...(creatingWard
          ? { newWard: { name: newWardName.trim(), ...(newWardFloor.trim() ? { floor: newWardFloor.trim() } : {}) } }
          : wardId ? { wardId } : {}),
      }).unwrap();
    } catch (err: unknown) {
      setFormError((err as { data?: { message?: string } })?.data?.message ?? 'Failed to create package.');
      return;
    }

    router.push('/packages');
  };

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold">New Package</h1>

      <NavForm onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Name *</Label>
          <Input id="name" value={name} onChange={e => setName(e.target.value)} maxLength={200} required />
        </div>

        <div>
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description"
            className="w-full border rounded px-3 py-2 text-sm"
            rows={3}
            maxLength={500}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <CharCounter value={description} max={500} />
        </div>

        <div>
          <Label htmlFor="price">Price (₹) *</Label>
          <Input id="price" type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} required />
        </div>

        <div>
          <Label>Included Services *</Label>
          <div className="space-y-2 mt-1">
            {services.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={s}
                  onChange={e => setService(i, e.target.value)}
                  maxLength={300}
                  placeholder={`Service ${i + 1}`}
                />
                {services.length > 1 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => removeService(i)}>✕</Button>
                )}
              </div>
            ))}
            {services.length < 50 && (
              <Button type="button" variant="outline" size="sm" onClick={addService}>+ Add Service</Button>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="ward">Ward</Label>
            {canCreateWard && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { setWardMode(wardMode === 'new' ? 'existing' : 'new'); setFormError(null); }}
              >
                {wardMode === 'new' ? 'Select existing ward' : '+ Create new ward'}
              </Button>
            )}
          </div>
          {canCreateWard && wardMode === 'new' ? (
            <div className="space-y-2 mt-1">
              <Input
                id="newWardName"
                aria-label="New ward name"
                placeholder="Ward name *"
                maxLength={100}
                value={newWardName}
                onChange={e => setNewWardName(e.target.value)}
              />
              <Input
                id="newWardFloor"
                aria-label="New ward floor"
                placeholder="Floor (optional)"
                maxLength={50}
                value={newWardFloor}
                onChange={e => setNewWardFloor(e.target.value)}
              />
            </div>
          ) : (
            <select
              id="ward"
              className="w-full border rounded px-3 py-2 text-sm mt-1"
              value={wardId}
              onChange={e => setWardId(e.target.value)}
            >
              <option value="">No ward</option>
              {wards.map(w => (
                <option key={w.wardId} value={w.wardId}>
                  {w.name}{w.floor ? ` (Floor ${w.floor})` : ''}
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            IPD admissions under this package are allocated a bed in this ward.
          </p>
        </div>

        {(formError || error) && <p className="text-red-600 text-sm">{formError ?? 'Failed to create package.'}</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={isLoading}>{isLoading ? 'Creating…' : 'Create Package'}</Button>
          <Button type="button" variant="outline" onClick={() => router.push('/packages')}>Cancel</Button>
        </div>
      </NavForm>
    </div>
  );
}
