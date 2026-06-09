'use client';

import { useState, useRef } from 'react';
import {
  useGetBrandingQuery,
  useUpdateBrandingMutation,
} from '@/store/api/tenant.api';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setBranding } from '@/store/slices/auth.slice';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Upload } from 'lucide-react';

export default function BrandingPage() {
  const dispatch = useAppDispatch();
  const tenantId = useAppSelector((s) => s.auth.profile?.tenantId);

  const { data: branding, isLoading } = useGetBrandingQuery(tenantId ?? '', { skip: !tenantId });
  const [updateBranding, { isLoading: saving }] = useUpdateBrandingMutation();

  const [displayName,  setDisplayName]  = useState('');
  const [primaryColor, setPrimaryColor] = useState('#1A73E8');
  const [logoFile,     setLogoFile]     = useState<File | null>(null);
  const [logoPreview,  setLogoPreview]  = useState<string | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [success,      setSuccess]      = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [initialised, setInitialised] = useState(false);
  if (branding && !initialised) {
    setDisplayName(branding.displayName ?? '');
    setPrimaryColor(branding.primaryColor ?? '#1A73E8');
    setInitialised(true);
  }

  if (!tenantId) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        No tenant associated with your account.
      </div>
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be 2 MB or smaller.');
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await updateBranding({
        tenantId: tenantId!,
        displayName:  displayName.trim(),
        primaryColor,
        ...(logoFile ? { logo: logoFile } : {}),
      }).unwrap();

      dispatch(setBranding({
        logoUrl:      logoPreview ?? branding?.logoUrl ?? null,
        displayName:  displayName.trim(),
        primaryColor,
      }));

      setLogoFile(null);
      setSuccess('Branding updated successfully.');
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to save branding.');
    }
  }

  if (isLoading) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">Loading branding…</div>
    );
  }

  const currentLogo = logoPreview ?? branding?.logoUrl ?? null;

  return (
    <div className="space-y-6 max-w-lg">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Hospital Branding</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customise your hospital's logo, display name, and primary colour.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Logo */}
        <div className="space-y-3">
          <Label>Hospital Logo</Label>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            {currentLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentLogo}
                alt="Logo preview"
                className="h-16 w-16 rounded-lg object-contain border bg-muted shrink-0"
              />
            ) : (
              <div className="h-16 w-16 rounded-lg border bg-muted flex items-center justify-center text-muted-foreground text-xs shrink-0">
                No logo
              </div>
            )}
            <div className="space-y-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={saving}
              >
                <Upload className="h-4 w-4 mr-2" />
                {logoFile ? 'Change File' : 'Upload Logo'}
              </Button>
              {logoFile && (
                <p className="text-xs text-muted-foreground">{logoFile.name}</p>
              )}
              <p className="text-xs text-muted-foreground">PNG, JPG — max 2 MB</p>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Display name */}
        <div className="space-y-2">
          <Label htmlFor="displayName">Display Name</Label>
          <Input
            id="displayName"
            placeholder="City General Hospital"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Shown in the portal header and on generated documents.
          </p>
        </div>

        {/* Primary color */}
        <div className="space-y-2">
          <Label htmlFor="primaryColor">Primary Color</Label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="primaryColor"
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-9 w-16 rounded-md border cursor-pointer bg-background"
            />
            <Input
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#1A73E8"
              className="w-32 font-mono"
            />
            <div
              className="h-9 w-9 rounded-md border"
              style={{ backgroundColor: primaryColor }}
              aria-label="Color preview"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">{success}</p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Branding'}
          </Button>
        </div>
      </form>
    </div>
  );
}
