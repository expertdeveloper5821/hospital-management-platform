'use client';

import { useState } from 'react';
import { useRouter }            from 'next/navigation';
import { useForm }              from 'react-hook-form';
import { zodResolver }          from '@hookform/resolvers/zod';
import { z }                   from 'zod';
import { Eye, EyeOff, ArrowLeft, KeyRound } from 'lucide-react';
import Link                    from 'next/link';
import { useChangePasswordMutation } from '@/store/api/auth.api';
import { useAppDispatch }       from '@/store/hooks';
import { tokenReceived }        from '@/store/slices/auth.slice';

// ─── Validation ───────────────────────────────────────────────────────────────

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword:     z.string().min(8, 'Minimum 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'New password must differ from the current password',
    path:    ['newPassword'],
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path:    ['confirmPassword'],
  });

type Form = z.infer<typeof schema>;

// ─── Password input with show/hide toggle ─────────────────────────────────────

function PasswordInput({
  id,
  placeholder,
  registration,
  error,
}: {
  id:           string;
  placeholder?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registration: any;
  error?:       string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={id === 'currentPassword' ? 'current-password' : 'new-password'}
          className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          {...registration}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChangePasswordPage() {
  const router   = useRouter();
  const dispatch = useAppDispatch();
  const [changePassword, { isLoading }] = useChangePasswordMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Form) {
    try {
      const { token } = await changePassword({
        currentPassword: values.currentPassword,
        newPassword:     values.newPassword,
      }).unwrap();
      // Server issues a fresh JWT — update the store so the old one isn't reused
      dispatch(tokenReceived(token));
      router.push('/profile');
    } catch (err: unknown) {
      const msg =
        err &&
        typeof err === 'object' &&
        'data' in err &&
        (err as { data?: { message?: string } }).data?.message
          ? (err as { data: { message: string } }).data.message
          : 'Failed to change password. Please try again.';
      setError('root', { message: msg });
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/profile"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Profile
      </Link>

      <div className="rounded-xl border bg-card p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Change Password</h1>
            <p className="text-xs text-muted-foreground">Enter your current password to set a new one</p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="currentPassword" className="text-sm font-medium">
              Current Password
            </label>
            <PasswordInput
              id="currentPassword"
              registration={register('currentPassword')}
              error={errors.currentPassword?.message}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="newPassword" className="text-sm font-medium">
              New Password
            </label>
            <PasswordInput
              id="newPassword"
              placeholder="Min. 8 characters"
              registration={register('newPassword')}
              error={errors.newPassword?.message}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm New Password
            </label>
            <PasswordInput
              id="confirmPassword"
              registration={register('confirmPassword')}
              error={errors.confirmPassword?.message}
            />
          </div>

          {/* API-level error */}
          {errors.root && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errors.root.message}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isLoading ? 'Saving…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
