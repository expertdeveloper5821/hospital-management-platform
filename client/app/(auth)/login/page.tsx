'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { useLoginMutation } from '@/store/api/auth.api';
import { useGetPlatformSettingsQuery } from '@/store/api/platformSettings.api';
import { useAppSelector } from '@/store/hooks';

const schema = z.object({
  email:    z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router   = useRouter();
  const [login, { isLoading, error }] = useLoginMutation();
  const profile  = useAppSelector((s) => s.auth.profile);
  const [showPassword, setShowPassword] = useState(false);

  const { data: platformSettings } = useGetPlatformSettingsQuery();

  // Apply platform title and favicon on mount / when settings load
  useEffect(() => {
    if (!platformSettings) return;
    if (platformSettings.platformTitle) {
      document.title = platformSettings.platformTitle;
    }
    if (platformSettings.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = platformSettings.faviconUrl;
    }
  }, [platformSettings]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
  });

  useEffect(() => {
    if (!profile) return;
    if (profile.isFirstLogin) {
      router.replace('/change-password');
    } else {
      router.replace('/dashboard');
    }
  }, [profile, router]);

  async function onSubmit(values: FormValues) {
    try {
      await login({ email: values.email, password: values.password }).unwrap();
    } catch { /* error displayed below */ }
  }

  const apiError = (() => {
    if (!error) return null;
    if ('status' in error) {
      if (error.status === 401) return 'Invalid email or password.';
      if (error.status === 403) return 'Account locked. Please contact your administrator.';
    }
    if ('data' in error) return (error.data as { message?: string })?.message ?? 'Login failed.';
    return 'Login failed.';
  })();

  return (
    <Card>
      <CardHeader className="space-y-4 pb-2 text-center">
        <div className="flex items-center justify-center gap-2 text-primary">
          {platformSettings?.logoUrl ? (
            <img
              src={platformSettings.logoUrl}
              alt="Platform logo"
              className="h-10 w-auto object-contain"
            />
          ) : (
            <>
              <Activity className="h-8 w-8" aria-hidden="true" />
              <span className="text-2xl font-bold tracking-tight">
                {platformSettings?.platformTitle ?? 'MediCore'}
              </span>
            </>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Sign in to your account</p>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {apiError && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {apiError}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              aria-label="Email address"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <p id="email-error" className="text-xs text-destructive" role="alert">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="pr-10"
                aria-label="Password"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword
                  ? <EyeOff className="h-4 w-4" aria-hidden="true" />
                  : <Eye className="h-4 w-4" aria-hidden="true" />
                }
              </button>
            </div>
            {errors.password && (
              <p id="password-error" className="text-xs text-destructive" role="alert">
                {errors.password.message}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={isLoading} aria-label="Sign in">
            {isLoading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Signing in…</>
              : 'Sign In'
            }
          </Button>
          <a
            href="/forgot-password"
            className="text-sm text-muted-foreground hover:underline text-center"
          >
            Forgot Password?
          </a>
          <a
            href="/super-admin/login"
            className="text-sm text-muted-foreground hover:underline text-center"
          >
            Platform admin? Sign in here
          </a>
        </CardFooter>
      </form>
    </Card>
  );
}
