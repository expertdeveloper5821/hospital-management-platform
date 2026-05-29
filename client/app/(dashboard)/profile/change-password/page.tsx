'use client';

import { useState } from 'react';
import { useRouter }            from 'next/navigation';
import { useForm }              from 'react-hook-form';
import { zodResolver }          from '@hookform/resolvers/zod';
import { z }                   from 'zod';
import { Eye, EyeOff, ArrowLeft, KeyRound } from 'lucide-react';
import Link                    from 'next/link';
import { useChangeMyPasswordMutation }         from '@/store/api/user.api';
import { useChangeSuperAdminPasswordMutation, useLogoutMutation } from '@/store/api/auth.api';
import { useAppDispatch, useAppSelector }      from '@/store/hooks';
import { logout }                              from '@/store/slices/auth.slice';
import { baseApi }                             from '@/store/api/base.api';
import { toastSuccess }                        from '@/lib/toast';

// ─── Validation ───────────────────────────────────────────────────────────────

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Minimum 8 characters')
      .regex(/[A-Z]/, 'Must include an uppercase letter')
      .regex(/[0-9]/, 'Must include a digit')
      .regex(/[^A-Za-z0-9]/, 'Must include a special character'),
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

// ─── Password field with show/hide ───────────────────────────────────────────

function PasswordInput({
  id, placeholder, registration, error,
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
  const router       = useRouter();
  const dispatch     = useAppDispatch();
  const isSuperAdmin = useAppSelector((s) => s.auth.profile?.role === 'SUPER_ADMIN');

  const [changeMyPassword,         { isLoading: savingUser }]  = useChangeMyPasswordMutation();
  const [changeSuperAdminPassword, { isLoading: savingAdmin }] = useChangeSuperAdminPasswordMutation();
  const [logoutMutation]                                        = useLogoutMutation();

  const isLoading = isSuperAdmin ? savingAdmin : savingUser;

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Form) {
    try {
      if (isSuperAdmin) {
        await changeSuperAdminPassword({
          currentPassword: values.currentPassword,
          newPassword:     values.newPassword,
        }).unwrap();
      } else {
        await changeMyPassword({
          currentPassword: values.currentPassword,
          newPassword:     values.newPassword,
        }).unwrap();
      }

      // Token is now invalidated server-side — clear client state
      toastSuccess('Password changed. Please log in again.');
      try {
        await logoutMutation({ isSuperAdmin }).unwrap();
      } catch {
        // If logout call fails (token already invalidated), clean up manually
        dispatch(logout());
        dispatch(baseApi.util.resetApiState());
      }
      router.replace('/login');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'data' in err &&
        (err as { data?: { message?: string } }).data?.message
          ? (err as { data: { message: string } }).data.message
          : 'Failed to change password. Please try again.';
      setError('root', { message: msg });
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <Link
        href="/profile"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Profile
      </Link>

      <div className="rounded-xl border bg-card p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Change Password</h1>
            <p className="text-xs text-muted-foreground">You will be signed out after changing your password</p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="currentPassword" className="text-sm font-medium">Current Password</label>
            <PasswordInput
              id="currentPassword"
              registration={register('currentPassword')}
              error={errors.currentPassword?.message}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="newPassword" className="text-sm font-medium">New Password</label>
            <PasswordInput
              id="newPassword"
              placeholder="Min. 8 chars, uppercase, digit, special"
              registration={register('newPassword')}
              error={errors.newPassword?.message}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm New Password</label>
            <PasswordInput
              id="confirmPassword"
              registration={register('confirmPassword')}
              error={errors.confirmPassword?.message}
            />
          </div>

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
