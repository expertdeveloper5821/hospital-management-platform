'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Mail, ShieldCheck, KeyRound, Pencil, Check, X,
  Phone, Upload, Loader2, ImageIcon,
} from 'lucide-react';
import { useAppSelector } from '@/store/hooks';
import {
  useGetMyProfileQuery,
  useUpdateMyProfileMutation,
  useUploadProfileImageMutation,
} from '@/store/api/user.api';
import { useGetSuperAdminMeQuery } from '@/store/api/auth.api';
import { toastSuccess, toastError } from '@/lib/toast';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRole(role: string) {
  return role.replace(/_/g, ' ');
}

function getInitials(name: string, email: string) {
  const src = name?.trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

type EditField = 'name' | 'phone';

// ─── Super-admin simplified profile ──────────────────────────────────────────

function SuperAdminProfile() {
  const { data, isLoading } = useGetSuperAdminMeQuery(undefined);

  if (isLoading) return <ProfileSkeleton />;
  if (!data) return null;

  const initials = getInitials('', data.email);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-semibold">My Profile</h1>

      <div className="rounded-xl border bg-card p-6 flex items-center gap-5">
        <div className="h-16 w-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold select-none shrink-0">
          {initials}
        </div>
        <div className="space-y-1 min-w-0">
          <p className="text-base font-semibold truncate">{data.email}</p>
          <span className="inline-block rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
            {formatRole(data.role)}
          </span>
        </div>
      </div>

      <div className="rounded-xl border bg-card divide-y">
        <div className="flex items-center gap-3 px-5 py-4">
          <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="text-sm font-medium">{data.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 py-4">
          <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Role</p>
            <p className="text-sm font-medium">{formatRole(data.role)}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
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
          <span className="text-muted-foreground group-hover:text-foreground">›</span>
        </Link>
      </div>
    </div>
  );
}

// ─── Regular-user profile ─────────────────────────────────────────────────────

function UserProfile() {
  const { data: profile, isLoading } = useGetMyProfileQuery();
  const [updateProfile,  { isLoading: isSaving }]   = useUpdateMyProfileMutation();
  const [uploadImage,    { isLoading: isUploading }] = useUploadProfileImageMutation();

  const [editingField, setEditingField] = useState<EditField | null>(null);
  const [nameInput,    setNameInput]    = useState('');
  const [phoneInput,   setPhoneInput]   = useState('');
  const [fieldError,   setFieldError]   = useState('');
  const [dragOver,     setDragOver]     = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      setNameInput(profile.name  ?? '');
      setPhoneInput(profile.phone ?? '');
    }
  }, [profile]);

  function startEdit(field: EditField) {
    setEditingField(field);
    setFieldError('');
  }

  function cancelEdit() {
    setEditingField(null);
    setFieldError('');
    if (profile) {
      setNameInput(profile.name   ?? '');
      setPhoneInput(profile.phone ?? '');
    }
  }

  async function saveField(field: EditField) {
    setFieldError('');
    try {
      if (field === 'name') {
        const trimmed = nameInput.trim();
        if (!trimmed) { setFieldError('Name cannot be empty'); return; }
        await updateProfile({ name: trimmed }).unwrap();
        toastSuccess('Profile updated successfully');
      } else {
        await updateProfile({ phone: phoneInput.trim() || null }).unwrap();
        toastSuccess('Profile updated successfully');
      }
      setEditingField(null);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'data' in err
          ? (err as { data?: { message?: string } }).data?.message ?? 'Failed to save'
          : 'Failed to save';
      setFieldError(msg);
    }
  }

  async function handleFile(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toastError('Image too large', 'Maximum file size is 2 MB.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toastError('Unsupported format', 'Use JPEG, PNG, or WebP.');
      return;
    }
    const form = new FormData();
    form.append('image', file);
    try {
      await uploadImage(form).unwrap();
      toastSuccess('Profile photo updated');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'data' in err
          ? (err as { data?: { message?: string } }).data?.message ?? 'Upload failed'
          : 'Upload failed';
      toastError('Photo upload failed', msg);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  if (isLoading) return <ProfileSkeleton />;
  if (!profile)  return null;

  const initials  = getInitials(profile.name, profile.email);
  const avatarUrl = profile.profileImageUrl;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-semibold">My Profile</h1>

      {/* ── Profile photo card ─────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <p className="text-sm font-medium text-foreground">Profile Photo</p>

        <div className="flex items-center gap-5">
          {/* Avatar preview */}
          <div className="h-20 w-20 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold select-none overflow-hidden shrink-0 ring-2 ring-border">
            {avatarUrl
              ? <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
              : initials}
          </div>

          {/* Drop-zone / click-to-upload area */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            disabled={isUploading}
            className={[
              'flex-1 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 transition-colors cursor-pointer',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              dragOver
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary hover:bg-muted/40',
              isUploading ? 'opacity-60 pointer-events-none' : '',
            ].join(' ')}
          >
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Upload className="h-5 w-5 text-primary" />
              </div>
            )}
            <div className="text-center">
              <p className="text-sm font-medium">
                {isUploading ? 'Uploading…' : 'Click or drag to upload'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                JPEG, PNG, WebP — max 2 MB
              </p>
            </div>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onFileInputChange}
            aria-label="Upload profile photo"
          />
        </div>

        {/* Current photo indicator */}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          {avatarUrl ? 'Current photo is shown above' : 'No photo set — initials are shown'}
        </p>
      </div>

      {/* ── Summary card ───────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-5 flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold select-none overflow-hidden shrink-0">
          {avatarUrl
            ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            : initials}
        </div>
        <div className="min-w-0">
          <p className="font-semibold truncate">{profile.name || profile.email}</p>
          <p className="text-sm text-muted-foreground truncate">{profile.email}</p>
          <span className="inline-block mt-0.5 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
            {formatRole(profile.role)}
          </span>
        </div>
      </div>

      {/* ── Editable rows ──────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card divide-y">
        <EditableRow
          icon={<ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
          label="Display Name"
          value={profile.name}
          placeholder="Your full name"
          isEditing={editingField === 'name'}
          inputValue={nameInput}
          onInputChange={setNameInput}
          onEdit={() => startEdit('name')}
          onSave={() => saveField('name')}
          onCancel={cancelEdit}
          isSaving={isSaving && editingField === 'name'}
          error={editingField === 'name' ? fieldError : ''}
        />
        <EditableRow
          icon={<Phone className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
          label="Phone"
          value={profile.phone}
          placeholder="+91 98765 43210"
          isEditing={editingField === 'phone'}
          inputValue={phoneInput}
          onInputChange={setPhoneInput}
          onEdit={() => startEdit('phone')}
          onSave={() => saveField('phone')}
          onCancel={cancelEdit}
          isSaving={isSaving && editingField === 'phone'}
          error={editingField === 'phone' ? fieldError : ''}
        />
        <div className="flex items-center gap-3 px-5 py-4">
          <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="text-sm font-medium">{profile.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 py-4">
          <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Role</p>
            <p className="text-sm font-medium">{formatRole(profile.role)}</p>
          </div>
        </div>
      </div>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card">
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
          <span className="text-muted-foreground group-hover:text-foreground">›</span>
        </Link>
      </div>
    </div>
  );
}

// ─── Root page — gates by role ────────────────────────────────────────────────

export default function ProfilePage() {
  const role = useAppSelector((s) => s.auth.profile?.role);
  if (role === 'SUPER_ADMIN') return <SuperAdminProfile />;
  return <UserProfile />;
}

// ─── Shared components ────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="max-w-lg mx-auto space-y-4 animate-pulse">
      <div className="h-7 w-32 rounded bg-muted" />
      <div className="rounded-xl border bg-card p-6 h-32" />
      <div className="rounded-xl border bg-card h-24" />
      <div className="rounded-xl border bg-card h-40" />
    </div>
  );
}

function EditableRow({
  icon, label, value, placeholder,
  isEditing, inputValue, onInputChange,
  onEdit, onSave, onCancel, isSaving, error,
}: {
  icon:          React.ReactNode;
  label:         string;
  value:         string | null | undefined;
  placeholder?:  string;
  isEditing:     boolean;
  inputValue:    string;
  onInputChange: (v: string) => void;
  onEdit:        () => void;
  onSave:        () => void;
  onCancel:      () => void;
  isSaving:      boolean;
  error:         string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {icon}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            {isEditing ? (
              <div className="mt-1 space-y-1">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => onInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  onSave();
                    if (e.key === 'Escape') onCancel();
                  }}
                  autoFocus
                  placeholder={placeholder}
                  className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
            ) : (
              <p className="text-sm font-medium">
                {value || <span className="text-muted-foreground italic">Not set</span>}
              </p>
            )}
          </div>
        </div>
        {isEditing ? (
          <div className="flex items-center gap-1 shrink-0 mt-4">
            <button
              onClick={onSave}
              disabled={isSaving}
              aria-label={`Save ${label}`}
              className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSaving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={onCancel}
              aria-label="Cancel edit"
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={onEdit}
            aria-label={`Edit ${label}`}
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
