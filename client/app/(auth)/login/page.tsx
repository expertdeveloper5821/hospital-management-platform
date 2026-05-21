'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { useLoginMutation } from '@/store/api/auth.api';
import { useAppSelector } from '@/store/hooks';

const schema = z.object({
  tenantId: z.string().min(1, 'Hospital ID is required'),
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [login, { isLoading, error }] = useLoginMutation();
  const profile = useAppSelector((s) => s.auth.profile);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
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
      await login({ email: values.email, password: values.password, tenantId: values.tenantId }).unwrap();
    } catch { /* error shown below */ }
  }

  const apiError = (() => {
    if (!error || !('data' in error)) return null;
    return (error.data as { message?: string })?.message ?? 'Login failed';
  })();

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Hospital Sign In</CardTitle>
        <CardDescription>Enter your hospital credentials to continue</CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
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

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
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
          <a
            href="/forgot-password"
            className="text-sm text-muted-foreground hover:underline text-center"
          >
            Forgot password?
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
