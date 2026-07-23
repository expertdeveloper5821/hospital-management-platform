'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { useSuperAdminResetPasswordMutation } from '@/store/api/auth.api';
import { passwordSchema, PASSWORD_REQUIREMENTS } from '@/lib/password';

// Mirrors the backend resetPasswordSchema for super admins (strong password).
const schema = z
  .object({
    newPassword:     passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path:    ['confirmPassword'],
  });

type Form = z.infer<typeof schema>;

function SuperAdminResetPasswordForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get('token') ?? '';

  const [resetPassword, { isLoading, isSuccess, error }] = useSuperAdminResetPasswordMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Form) {
    if (!token) return;
    try {
      await resetPassword({ token, newPassword: values.newPassword }).unwrap();
      setTimeout(() => router.replace('/super-admin/login'), 2000);
    } catch {
      // error displayed below
    }
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invalid reset link</CardTitle>
          <CardDescription>
            This reset link is missing a token. Please request a new one.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <a href="/super-admin/forgot-password" className="text-sm text-primary hover:underline">
            Request a new reset link
          </a>
        </CardFooter>
      </Card>
    );
  }

  const apiError =
    error && 'data' in error
      ? (error.data as { message?: string })?.message ?? 'Reset failed. The link may have expired.'
      : null;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-2xl">Set new password</CardTitle>
        </div>
        <CardDescription>
          {isSuccess
            ? 'Password reset successfully — redirecting to sign in…'
            : 'Enter your new platform admin password below.'}
        </CardDescription>
      </CardHeader>

      {!isSuccess && (
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                {...register('newPassword')}
              />
              {errors.newPassword ? (
                <p className="text-xs text-destructive">{errors.newPassword.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{PASSWORD_REQUIREMENTS}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>

            {apiError && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                {apiError}
              </p>
            )}
          </CardContent>

          <CardFooter>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Saving…' : 'Reset password'}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}

// useSearchParams requires Suspense boundary per Next.js App Router rules
export default function SuperAdminResetPasswordPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <SuperAdminResetPasswordForm />
    </Suspense>
  );
}
