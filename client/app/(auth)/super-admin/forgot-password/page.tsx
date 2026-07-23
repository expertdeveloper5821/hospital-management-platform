'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { useSuperAdminForgotPasswordMutation } from '@/store/api/auth.api';

// Super Admin has no tenant — only the email is required.
const schema = z.object({
  email: z.string().email('Invalid email address'),
});

type Form = z.infer<typeof schema>;

export default function SuperAdminForgotPasswordPage() {
  const [forgotPassword, { isLoading, isSuccess, error }] = useSuperAdminForgotPasswordMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Form) {
    try {
      await forgotPassword({ email: values.email }).unwrap();
    } catch {
      // Errors surfaced via RTK Query's `error` state below
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-2xl">Reset password</CardTitle>
        </div>
        <CardDescription>
          {isSuccess
            ? 'If that email belongs to a platform admin, a reset link has been sent to the inbox.'
            : 'Enter your platform admin email to receive a reset link.'}
        </CardDescription>
      </CardHeader>

      {!isSuccess && (
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@platform.com"
                autoComplete="email"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            {error && !isSuccess && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                {'data' in error
                  ? (error.data as { message?: string })?.message ?? 'Something went wrong. Please try again.'
                  : 'Something went wrong. Please try again.'}
              </p>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Sending…' : 'Send reset link'}
            </Button>
            <a href="/super-admin/login" className="text-sm text-muted-foreground hover:underline text-center">
              Back to sign in
            </a>
          </CardFooter>
        </form>
      )}

      {isSuccess && (
        <CardFooter>
          <a href="/super-admin/login" className="text-sm text-primary hover:underline">
            Back to sign in
          </a>
        </CardFooter>
      )}
    </Card>
  );
}
