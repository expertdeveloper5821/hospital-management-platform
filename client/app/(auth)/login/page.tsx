'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { useLoginMutation } from '@/store/api/auth.api';
import { useAppSelector } from '@/store/hooks';

const loginSchema = z.object({
  email:        z.string().email('Invalid email address'),
  password:     z.string().min(1, 'Password is required'),
  tenantId:     z.string().optional(),
  isSuperAdmin: z.boolean().optional(),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [isSuperAdminMode, setIsSuperAdminMode] = useState(false);
  const [login, { isLoading, error }] = useLoginMutation();
  const profile = useAppSelector((s) => s.auth.profile);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginForm) {
    try {
      await login({
        email:        values.email,
        password:     values.password,
        tenantId:     isSuperAdminMode ? undefined : values.tenantId,
        isSuperAdmin: isSuperAdminMode,
      }).unwrap();
      // onQueryStarted in auth.api loads profile — check isFirstLogin after
      // We read from store via selector; redirect happens here
    } catch {
      // error displayed from mutation error state
    }
  }

  // Redirect once profile is loaded (side effect of loginMutation onQueryStarted)
  if (profile) {
    if (profile.isFirstLogin) {
      router.replace('/change-password');
    } else {
      router.replace('/dashboard');
    }
  }

  const apiError =
    error && 'data' in error
      ? (error.data as { message?: string })?.message ?? 'Login failed'
      : null;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>Enter your credentials to access the HMS</CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          {/* Super Admin toggle */}
          <div className="flex items-center gap-2">
            <input
              id="superAdminToggle"
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={isSuperAdminMode}
              onChange={(e) => setIsSuperAdminMode(e.target.checked)}
            />
            <Label htmlFor="superAdminToggle" className="cursor-pointer">
              Sign in as Super Admin
            </Label>
          </div>

          {!isSuperAdminMode && (
            <div className="space-y-2">
              <Label htmlFor="tenantId">Hospital ID</Label>
              <Input
                id="tenantId"
                placeholder="Your hospital tenant ID"
                {...register('tenantId')}
              />
              {errors.tenantId && (
                <p className="text-xs text-destructive">{errors.tenantId.message}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@hospital.com"
              autoComplete="email"
              {...register('email')}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          {apiError && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              {apiError}
            </p>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Signing in…' : 'Sign in'}
          </Button>
          {!isSuperAdminMode && (
            <a href="/forgot-password" className="text-sm text-muted-foreground hover:underline text-center">
              Forgot password?
            </a>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
