'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';
import { useCreatePackageMutation } from '@/store/api/packages.api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function NewPackagePage() {
  const router  = useRouter();
  const profile = useAppSelector((s) => s.auth.profile);

  if (profile && profile.role !== 'HOSPITAL_ADMIN' && profile.role !== 'ADMIN') {
    router.replace('/packages');
    return null;
  }

  const [create, { isLoading, error }] = useCreatePackageMutation();

  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice]             = useState('');
  const [services, setServices]       = useState<string[]>(['']);

  const addService    = () => setServices(s => [...s, '']);
  const removeService = (i: number) => setServices(s => s.filter((_, idx) => idx !== i));
  const setService    = (i: number, v: string) => setServices(s => s.map((x, idx) => idx === i ? v : x));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validServices = services.filter(s => s.trim().length > 0);
    if (!name.trim() || validServices.length === 0 || !price) return;

    await create({
      name:             name.trim(),
      description:      description.trim() || undefined,
      price:            parseFloat(price),
      includedServices: validServices,
    }).unwrap();

    router.push('/packages');
  };

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold">New Package</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
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

        {error && <p className="text-red-600 text-sm">Failed to create package.</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={isLoading}>{isLoading ? 'Creating…' : 'Create Package'}</Button>
          <Button type="button" variant="outline" onClick={() => router.push('/packages')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
