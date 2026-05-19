'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { useLoginMutation, useSuperAdminLoginMutation } from '@/store/api/auth.api';
import { useAppSelector } from '@/store/hooks';
import { UserRole } from '@/store/types';

const hospitalLoginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  tenantId: z.string().min(1, 'Hospital ID is required'),
});

const superAdminLoginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type HospitalForm    = z.infer<typeof hospitalLoginSchema>;
type SuperAdminForm  = z.infer<typeof superAdminLoginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [isSuperAdminMode, setIsSuperAdminMode] = useState(false);

  const [login,          { isLoading: loadingLogin,  error: errorLogin  }] = useLoginMutation();
  const [superAdminLogin,{ isLoading: loadingSA,     error: errorSA     }] = useSuperAdminLoginMutation();

  const profile = useAppSelector((s) => s.auth.profile);

  const hospitalForm = useForm<HospitalForm>({
    resolver: zodResolver(hospitalLoginSchema),
  });

  const superAdminForm = useForm<SuperAdminForm>({
    resolver: zodResolver(superAdminLoginSchema),
  });

  // Redirect once profile is populated by onQueryStarted side-effect
  useEffect(() => {
    if (!profile) return;
    // SUPER_ADMIN → their console; everyone else → dashboard
    if (profile.role === UserRole.SUPER_ADMIN) {
      router.replace('/super-admin');
    } else if (profile.isFirstLogin) {
      router.replace('/change-password');
    } else {
      router.replace('/dashboard');
    }
  }, [profile, router]);

  async function onHospitalSubmit(values: HospitalForm) {
    try {
      await login({ email: values.email, password: values.password, tenantId: values.tenantId }).unwrap();
    } catch { /* error shown below */ }
  }

  async function onSuperAdminSubmit(values: SuperAdminForm) {
    try {
      await superAdminLogin({ email: values.email, password: values.password }).unwrap();
    } catch { /* error shown below */ }
  }

  const isLoading = loadingLogin || loadingSA;
  const apiError  = (() => {
    const err = isSuperAdminMode ? errorSA : errorLogin;
    if (!err || !('data' in err)) return null;
    return (err.data as { message?: string })?.message ?? 'Login failed';
  })();

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>
          {isSuperAdminMode ? 'Platform Super Admin login' : 'Enter your hospital credentials'}
        </CardDescription>
      </CardHeader>

      {/* Super Admin toggle */}
      <div className="px-6 pb-2">
        <div className="flex items-center gap-2">
          <input
            id="superAdminToggle"
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={isSuperAdminMode}
            onChange={(e) => setIsSuperAdminMode(e.target.checked)}
          />
          <Label htmlFor="superAdminToggle" className="cursor-pointer text-sm text-muted-foreground">
            Sign in as Super Admin
          </Label>
        </div>
      </div>

      {/* Hospital user form */}
      {!isSuperAdminMode && (
        <form onSubmit={hospitalForm.handleSubmit(onHospitalSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenantId">Hospital ID</Label>
              <Input
                id="tenantId"
                placeholder="Your hospital tenant ID"
                {...hospitalForm.register('tenantId')}
              />
              {hospitalForm.formState.errors.tenantId && (
                <p className="text-xs text-destructive">{hospitalForm.formState.errors.tenantId.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...hospitalForm.register('email')} />
              {hospitalForm.formState.errors.email && (
                <p className="text-xs text-destructive">{hospitalForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" {...hospitalForm.register('password')} />
              {hospitalForm.formState.errors.password && (
                <p className="text-xs text-destructive">{hospitalForm.formState.errors.password.message}</p>
              )}
            </div>
            {apiError && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{apiError}</p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in…' : 'Sign in'}
            </Button>
            <a href="/forgot-password" className="text-sm text-muted-foreground hover:underline text-center">
              Forgot password?
            </a>
          </CardFooter>
        </form>
      )}

      {/* Super Admin form — no tenantId field */}
      {isSuperAdminMode && (
        <form onSubmit={superAdminForm.handleSubmit(onSuperAdminSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sa-email">Email</Label>
              <Input id="sa-email" type="email" autoComplete="email" {...superAdminForm.register('email')} />
              {superAdminForm.formState.errors.email && (
                <p className="text-xs text-destructive">{superAdminForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sa-password">Password</Label>
              <Input id="sa-password" type="password" autoComplete="current-password" {...superAdminForm.register('password')} />
              {superAdminForm.formState.errors.password && (
                <p className="text-xs text-destructive">{superAdminForm.formState.errors.password.message}</p>
              )}
            </div>
            {apiError && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{apiError}</p>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in…' : 'Sign in'}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}
