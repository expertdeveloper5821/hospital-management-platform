'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateTenantMutation } from '@/store/api/tenant.api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface FormState {
  name:                    string;
  adminEmail:              string;
  registrationCertificate: string;
  gstNumber:               string;
  panCard:                 string;
  addressProof:            string;
}

const EMPTY: FormState = {
  name:                    '',
  adminEmail:              '',
  registrationCertificate: '',
  gstNumber:               '',
  panCard:                 '',
  addressProof:            '',
};

export default function NewTenantPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [createTenant, { isLoading }] = useCreateTenantMutation();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createTenant({
        name:       form.name.trim(),
        adminEmail: form.adminEmail.trim(),
        onboardingDocuments: {
          registrationCertificate: form.registrationCertificate.trim(),
          gstNumber:               form.gstNumber.trim(),
          panCard:                 form.panCard.trim(),
          addressProof:            form.addressProof.trim(),
        },
      }).unwrap();
      router.push('/super-admin');
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to create tenant. Please try again.');
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/super-admin" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Onboard New Hospital</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create a new tenant record. Status starts as PENDING_VERIFICATION.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-6 space-y-6">
        {/* Basic info */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Hospital Info
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Hospital Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="City General Hospital"
                value={form.name}
                onChange={handleChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminEmail">Admin Email</Label>
              <Input
                id="adminEmail"
                name="adminEmail"
                type="email"
                placeholder="admin@hospital.com"
                value={form.adminEmail}
                onChange={handleChange}
                required
              />
            </div>
          </div>
        </div>

        {/* Onboarding docs */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Onboarding Documents
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="registrationCertificate">Registration Certificate No.</Label>
              <Input
                id="registrationCertificate"
                name="registrationCertificate"
                placeholder="REG-12345"
                value={form.registrationCertificate}
                onChange={handleChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gstNumber">GST Number</Label>
              <Input
                id="gstNumber"
                name="gstNumber"
                placeholder="29ABCDE1234F1Z5"
                value={form.gstNumber}
                onChange={handleChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="panCard">PAN Card No.</Label>
              <Input
                id="panCard"
                name="panCard"
                placeholder="ABCDE1234F"
                value={form.panCard}
                onChange={handleChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addressProof">Address Proof Ref.</Label>
              <Input
                id="addressProof"
                name="addressProof"
                placeholder="Utility bill / lease ref."
                value={form.addressProof}
                onChange={handleChange}
                required
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href="/super-admin">
            <Button type="button" variant="outline" disabled={isLoading}>
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Creating…' : 'Create Tenant'}
          </Button>
        </div>
      </form>
    </div>
  );
}
