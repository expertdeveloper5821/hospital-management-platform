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
import { ShieldCheck } from 'lucide-react';
import { useSuperAdminLoginMutation } from '@/store/api/auth.api';
import { useAppSelector } from '@/store/hooks';
import { UserRole } from '@/store/types';

const schema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [superAdminLogin, { isLoading, error }] = useSuperAdminLoginMutation();
  const profile = useAppSelector((s) => s.auth.profile);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (!profile) return;
    if (profile.role === UserRole.SUPER_ADMIN) {
      if (profile.isFirstLogin) {
        router.replace('/change-password');
      } else {
        router.replace('/super-admin');
      }
    }
  }, [profile, router]);

  async function onSubmit(values: FormValues) {
    try {
      await superAdminLogin({ email: values.email, password: values.password }).unwrap();
    } catch { /* error shown below */ }
  }

  const apiError = (() => {
    if (!error || !('data' in error)) return null;
    return (error.data as { message?: string })?.message ?? 'Login failed';
  })();

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-2xl">Platform Admin</CardTitle>
        </div>
        <CardDescription>Super Admin access only</CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
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
            href="/login"
            className="text-sm text-muted-foreground hover:underline text-center"
          >
            Hospital staff? Sign in here
          </a>
        </CardFooter>
      </form>
    </Card>
  );
}
