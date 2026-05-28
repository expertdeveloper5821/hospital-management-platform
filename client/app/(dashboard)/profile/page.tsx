'use client';

import { useEffect, useState } from 'react';
import Link                    from 'next/link';
import { Mail, ShieldCheck, KeyRound, Pencil, Check, X } from 'lucide-react';
import { useGetMyProfileQuery, useUpdateMyProfileMutation } from '@/store/api/user.api';

function formatRole(role: string): string {
  return role.replace(/_/g, ' ');
}

function getInitials(name: string, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  const [local] = email.split('@');
  const parts   = local.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export default function ProfilePage() {
  const { data: profile, isLoading } = useGetMyProfileQuery();
  const [updateProfile, { isLoading: isSaving }] = useUpdateMyProfileMutation();

  const [editing,  setEditing]  = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [error,    setError]    = useState('');

  useEffect(() => {
    if (profile) setNameInput(profile.name ?? '');
  }, [profile]);

  async function handleSave() {
    const trimmed = nameInput.trim();
    if (!trimmed) { setError('Name cannot be empty'); return; }
    setError('');
    try {
      await updateProfile({ name: trimmed }).unwrap();
      setEditing(false);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'data' in err
          ? (err as { data?: { message?: string } }).data?.message ?? 'Failed to save'
          : 'Failed to save';
      setError(msg);
    }
  }

  function handleCancel() {
    setNameInput(profile?.name ?? '');
    setError('');
    setEditing(false);
  }

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto space-y-4 animate-pulse">
        <div className="h-7 w-32 rounded bg-muted" />
        <div className="rounded-xl border bg-card p-6 h-24" />
        <div className="rounded-xl border bg-card h-40" />
      </div>
    );
  }

  if (!profile) return null;

  const initials = getInitials(profile.name, profile.email);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-semibold">My Profile</h1>

      {/* Avatar + summary */}
      <div className="rounded-xl border bg-card p-6 flex items-center gap-5">
        <div className="h-16 w-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold shrink-0 select-none">
          {initials}
        </div>
        <div className="space-y-1 min-w-0">
          <p className="text-base font-semibold truncate">{profile.name || profile.email}</p>
          <p className="text-sm text-muted-foreground truncate">{profile.email}</p>
          <span className="inline-block rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
            {formatRole(profile.role)}
          </span>
        </div>
      </div>

      {/* Editable detail rows */}
      <div className="rounded-xl border bg-card divide-y">

        {/* Name — editable */}
        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Display Name</p>
                {editing ? (
                  <div className="mt-1 space-y-1">
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave();
                        if (e.key === 'Escape') handleCancel();
                      }}
                      autoFocus
                      className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Your full name"
                    />
                    {error && <p className="text-xs text-destructive">{error}</p>}
                  </div>
                ) : (
                  <p className="text-sm font-medium">{profile.name || <span className="text-muted-foreground italic">Not set</span>}</p>
                )}
              </div>
            </div>

            {/* Edit / Save / Cancel buttons */}
            {editing ? (
              <div className="flex items-center gap-1 shrink-0 mt-4">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  aria-label="Save name"
                  className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleCancel}
                  aria-label="Cancel edit"
                  className="p-1.5 rounded-md hover:bg-muted transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                aria-label="Edit name"
                className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Email — read-only */}
        <div className="flex items-center gap-3 px-5 py-4">
          <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="text-sm font-medium">{profile.email}</p>
          </div>
        </div>

        {/* Role — read-only */}
        <div className="flex items-center gap-3 px-5 py-4">
          <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Role</p>
            <p className="text-sm font-medium">{formatRole(profile.role)}</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-xl border bg-card divide-y">
        <Link
          href="/profile/change-password"
          className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium">Change Password</p>
              <p className="text-xs text-muted-foreground">Update your account password</p>
            </div>
          </div>
          <span className="text-muted-foreground group-hover:text-foreground transition-colors">›</span>
        </Link>
      </div>
    </div>
  );
}
