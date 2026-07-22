'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateTenantMutation } from '@/store/api/tenant.api';
import { useAppSelector } from '@/store/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { INDIAN_STATES } from '@/lib/constants';

interface FormState {
  name:                    string;
  adminEmail:              string;
  registrationCertificate: string;
  gstNumber:               string;
  panCard:                 string;
  addressLine:             string;
  city:                    string;
  state:                   string;
  pincode:                 string;
}

type FormErrors = Partial<Record<keyof FormState, string>>;

const EMPTY: FormState = {
  name:                    '',
  adminEmail:              '',
  registrationCertificate: '',
  gstNumber:               '',
  panCard:                 '',
  addressLine:             '',
  city:                    '',
  state:                   '',
  pincode:                 '',
};

const GST_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};

  const name = form.name.trim();
  if (!name) {
    errors.name = 'Hospital name is required.';
  } else if (name.length < 3) {
    errors.name = 'Name must be at least 3 characters.';
  } else if (name.length > 100) {
    errors.name = 'Name must be 100 characters or fewer.';
  }

  const email = form.adminEmail.trim();
  if (!email) {
    errors.adminEmail = 'Admin email is required.';
  } else if (!EMAIL_REGEX.test(email)) {
    errors.adminEmail = 'Enter a valid email address.';
  }

  const reg = form.registrationCertificate.trim();
  if (!reg) {
    errors.registrationCertificate = 'Registration certificate number is required.';
  } else if (reg.length < 3) {
    errors.registrationCertificate = 'Must be at least 3 characters.';
  } else if (reg.length > 50) {
    errors.registrationCertificate = 'Must be 50 characters or fewer.';
  }

  const gst = form.gstNumber.trim().toUpperCase();
  if (!gst) {
    errors.gstNumber = 'GST number is required.';
  } else if (!GST_REGEX.test(gst)) {
    errors.gstNumber = 'Invalid GST number. Expected format: 29ABCDE1234F1Z5';
  }

  const pan = form.panCard.trim().toUpperCase();
  if (!pan) {
    errors.panCard = 'PAN card number is required.';
  } else if (!PAN_REGEX.test(pan)) {
    errors.panCard = 'Invalid PAN. Expected format: ABCDE1234F (5 letters, 4 digits, 1 letter).';
  }

  const addressLine = form.addressLine.trim();
  if (!addressLine) {
    errors.addressLine = 'Address line is required.';
  } else if (addressLine.length > 200) {
    errors.addressLine = 'Address line must be 200 characters or fewer.';
  }

  const city = form.city.trim();
  if (!city) {
    errors.city = 'City is required.';
  } else if (city.length > 100) {
    errors.city = 'City must be 100 characters or fewer.';
  }

  const state = form.state.trim();
  if (!state) {
    errors.state = 'State is required.';
  } else if (state.length > 100) {
    errors.state = 'State must be 100 characters or fewer.';
  }

  const pincode = form.pincode.trim();
  if (!pincode) {
    errors.pincode = 'Pincode is required.';
  } else if (!/^\d{6}$/.test(pincode)) {
    errors.pincode = 'Pincode must be 6 digits.';
  }

  return errors;
}

export default function NewTenantPage() {
  const router  = useRouter();
  const profile = useAppSelector((s) => s.auth.profile);

  if (profile && profile.role !== 'SUPER_ADMIN') {
    router.replace('/dashboard');
    return null;
  }

  const [form, setForm]       = useState<FormState>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [apiError, setApiError]   = useState<string | null>(null);
  const [createTenant, { isLoading }] = useCreateTenantMutation();

  const errors = validate(form);
  const hasErrors = Object.keys(errors).length > 0;

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
    setTouched((prev) => ({ ...prev, [e.target.name]: true }));
  }

  function fieldError(field: keyof FormState): string | undefined {
    return (submitted || touched[field]) ? errors[field] : undefined;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setApiError(null);

    if (hasErrors) return;

    try {
      await createTenant({
        name:       form.name.trim(),
        adminEmail: form.adminEmail.trim(),
        onboardingDocuments: {
          registrationCertificate: form.registrationCertificate.trim(),
          gstNumber:               form.gstNumber.trim().toUpperCase(),
          panCard:                 form.panCard.trim().toUpperCase(),
          addressLine:             form.addressLine.trim(),
          city:                    form.city.trim(),
          state:                   form.state.trim(),
          pincode:                 form.pincode.trim(),
        },
      }).unwrap();
      router.push('/super-admin');
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setApiError(msg ?? 'Failed to create tenant. Please try again.');
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
      <div className="flex items-start gap-3">
        <Link href="/super-admin" className="text-muted-foreground hover:text-foreground transition-colors mt-1 shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Onboard New Hospital</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create a new tenant record. Status starts as PENDING_VERIFICATION.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="rounded-lg border bg-card p-4 sm:p-6 space-y-6">
        {/* Basic info */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Hospital Info
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="name">Hospital Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="City General Hospital"
                value={form.name}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!fieldError('name')}
                className={fieldError('name') ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {fieldError('name') && (
                <p className="text-xs text-destructive">{fieldError('name')}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="adminEmail">Admin Email</Label>
              <Input
                id="adminEmail"
                name="adminEmail"
                type="email"
                placeholder="admin@hospital.com"
                value={form.adminEmail}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!fieldError('adminEmail')}
                className={fieldError('adminEmail') ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {fieldError('adminEmail') && (
                <p className="text-xs text-destructive">{fieldError('adminEmail')}</p>
              )}
            </div>
          </div>
        </div>

        {/* Onboarding docs */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Onboarding Documents
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="registrationCertificate">Registration Certificate No.</Label>
              <Input
                id="registrationCertificate"
                name="registrationCertificate"
                placeholder="REG-12345"
                value={form.registrationCertificate}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!fieldError('registrationCertificate')}
                className={fieldError('registrationCertificate') ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {fieldError('registrationCertificate') && (
                <p className="text-xs text-destructive">{fieldError('registrationCertificate')}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="gstNumber">GST Number</Label>
              <Input
                id="gstNumber"
                name="gstNumber"
                placeholder="29ABCDE1234F1Z5"
                value={form.gstNumber}
                onChange={handleChange}
                onBlur={handleBlur}
                maxLength={15}
                aria-invalid={!!fieldError('gstNumber')}
                className={fieldError('gstNumber') ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {fieldError('gstNumber') && (
                <p className="text-xs text-destructive">{fieldError('gstNumber')}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="panCard">PAN Card No.</Label>
              <Input
                id="panCard"
                name="panCard"
                placeholder="ABCDE1234F"
                value={form.panCard}
                onChange={handleChange}
                onBlur={handleBlur}
                maxLength={10}
                aria-invalid={!!fieldError('panCard')}
                className={fieldError('panCard') ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {fieldError('panCard') && (
                <p className="text-xs text-destructive">{fieldError('panCard')}</p>
              )}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="addressLine">Address Line</Label>
              <Input
                id="addressLine"
                name="addressLine"
                placeholder="123 Main Street"
                value={form.addressLine}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!fieldError('addressLine')}
                className={fieldError('addressLine') ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {fieldError('addressLine') && (
                <p className="text-xs text-destructive">{fieldError('addressLine')}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                name="city"
                placeholder="Mumbai"
                value={form.city}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!fieldError('city')}
                className={fieldError('city') ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {fieldError('city') && (
                <p className="text-xs text-destructive">{fieldError('city')}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="state">State</Label>
              <select
                id="state"
                name="state"
                value={form.state}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!fieldError('state')}
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${fieldError('state') ? 'border-destructive focus-visible:ring-destructive' : ''}`}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((stateOption) => (
                  <option key={stateOption} value={stateOption}>{stateOption}</option>
                ))}
              </select>
              {fieldError('state') && (
                <p className="text-xs text-destructive">{fieldError('state')}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="pincode">Pincode</Label>
              <Input
                id="pincode"
                name="pincode"
                inputMode="numeric"
                maxLength={6}
                placeholder="400001"
                value={form.pincode}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!fieldError('pincode')}
                className={fieldError('pincode') ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {fieldError('pincode') && (
                <p className="text-xs text-destructive">{fieldError('pincode')}</p>
              )}
            </div>
          </div>
        </div>

        {apiError && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{apiError}</p>
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
