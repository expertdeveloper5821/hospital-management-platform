'use client';

import { useRef, useState } from 'react';
import { Settings, Upload, Loader2, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  useGetPlatformSettingsQuery,
  useUpdatePlatformTitleMutation,
  useUploadPlatformLogoMutation,
  useUploadPlatformFaviconMutation,
} from '@/store/api/platformSettings.api';

// ─── Logo Section ─────────────────────────────────────────────────────────────

function LogoSection({ currentLogoUrl }: { currentLogoUrl: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadLogo, { isLoading }] = useUploadPlatformLogoMutation();
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLocalError(null);
    const allowed = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setLocalError('Logo must be JPEG, PNG, SVG, or WebP.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLocalError('Logo must not exceed 2 MB.');
      return;
    }

    const form = new FormData();
    form.append('logo', file);
    try {
      await uploadLogo(form).unwrap();
    } catch {
      // toast shown by base API layer
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Platform Logo</CardTitle>
        <CardDescription>Displayed on the login page. JPEG, PNG, SVG, or WebP — max 2 MB.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentLogoUrl ? (
          <img
            src={currentLogoUrl}
            alt="Platform logo"
            className="h-16 w-auto rounded border object-contain p-1"
          />
        ) : (
          <div className="flex h-16 w-32 items-center justify-center rounded border bg-muted text-muted-foreground">
            <ImageIcon className="h-6 w-6 opacity-40" />
          </div>
        )}

        {localError && (
          <p className="text-sm text-destructive" role="alert">{localError}</p>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/svg+xml,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          onClick={() => fileRef.current?.click()}
        >
          {isLoading
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading…</>
            : <><Upload className="mr-2 h-4 w-4" />Upload Logo</>
          }
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Favicon Section ──────────────────────────────────────────────────────────

function FaviconSection({ currentFaviconUrl }: { currentFaviconUrl: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFavicon, { isLoading }] = useUploadPlatformFaviconMutation();
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLocalError(null);
    const allowed = ['image/x-icon', 'image/vnd.microsoft.icon', 'image/png'];
    if (!allowed.includes(file.type)) {
      setLocalError('Favicon must be ICO or PNG.');
      return;
    }
    if (file.size > 500 * 1024) {
      setLocalError('Favicon must not exceed 500 KB.');
      return;
    }

    const form = new FormData();
    form.append('favicon', file);
    try {
      await uploadFavicon(form).unwrap();
    } catch {
      // toast shown by base API layer
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Platform Favicon</CardTitle>
        <CardDescription>Browser tab icon. ICO or PNG — max 500 KB.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentFaviconUrl ? (
          <img
            src={currentFaviconUrl}
            alt="Platform favicon"
            className="h-10 w-10 rounded border object-contain p-1"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded border bg-muted text-muted-foreground">
            <ImageIcon className="h-4 w-4 opacity-40" />
          </div>
        )}

        {localError && (
          <p className="text-sm text-destructive" role="alert">{localError}</p>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/x-icon,image/vnd.microsoft.icon,image/png"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          onClick={() => fileRef.current?.click()}
        >
          {isLoading
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading…</>
            : <><Upload className="mr-2 h-4 w-4" />Upload Favicon</>
          }
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Title Section ────────────────────────────────────────────────────────────

function TitleSection({ currentTitle }: { currentTitle: string }) {
  const [title, setTitle] = useState(currentTitle);
  const [updateTitle, { isLoading }] = useUpdatePlatformTitleMutation();
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = title.trim();
    setLocalError(null);
    if (!trimmed) { setLocalError('Platform title is required.'); return; }
    if (trimmed.length > 100) { setLocalError('Platform title must not exceed 100 characters.'); return; }
    try {
      await updateTitle({ platformTitle: trimmed }).unwrap();
    } catch {
      // toast shown by base API layer
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Platform Title</CardTitle>
        <CardDescription>Shown in the browser tab and on the login page. Max 100 characters.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="platform-title">Title</Label>
          <Input
            id="platform-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="e.g. Sunrise Hospital Suite"
            aria-invalid={!!localError}
            aria-describedby={localError ? 'title-error' : undefined}
          />
          {localError && (
            <p id="title-error" className="text-sm text-destructive" role="alert">{localError}</p>
          )}
        </div>
        <Button size="sm" disabled={isLoading || title.trim() === currentTitle} onClick={handleSave}>
          {isLoading
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
            : 'Save Title'
          }
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlatformSettingsPage() {
  const { data, isLoading, isError } = useGetPlatformSettingsQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading settings…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Failed to load platform settings. Please refresh and try again.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Platform Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage platform-wide branding visible to all users.
          </p>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        <LogoSection    currentLogoUrl={data.logoUrl} />
        <FaviconSection currentFaviconUrl={data.faviconUrl} />
        <TitleSection   currentTitle={data.platformTitle} />
      </div>
    </div>
  );
}
