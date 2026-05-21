'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { useCompleteSetupMutation } from '@/store/api/auth.api';

const schema = z
  .object({
    name:            z.string().min(1, 'Name is required').max(200),
    password:        z.string().min(8, 'Minimum 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path:    ['confirmPassword'],
  });

type Form = z.infer<typeof schema>;

function SetupForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get('token') ?? '';

  const [completeSetup, { isLoading, isSuccess, error }] = useCompleteSetupMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Form) {
    if (!token) return;
    try {
      await completeSetup({ token, name: values.name, password: values.password }).unwrap();
      router.replace('/dashboard');
    } catch { /* error displayed below */ }
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invalid setup link</CardTitle>
          <CardDescription>
            This link is missing a token. Please ask your administrator to resend the invite.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const apiError =
    error && 'data' in error
      ? (error.data as { message?: string })?.message ?? 'Setup failed. The link may have expired.'
      : null;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Welcome to HMS</CardTitle>
        <CardDescription>
          {isSuccess
            ? 'Account created — redirecting to dashboard…'
            : 'Set a password to activate your hospital admin account.'}
        </CardDescription>
      </CardHeader>

      {!isSuccess && (
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                placeholder="Full name"
                autoComplete="name"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
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
              {isLoading ? 'Creating account…' : 'Activate account'}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <SetupForm />
    </Suspense>
  );
}
