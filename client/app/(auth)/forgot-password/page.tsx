'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { useForgotPasswordMutation } from '@/store/api/auth.api';

// Backend requires both email AND tenantId (forgotPasswordSchema)
const schema = z.object({
  email:    z.string().email('Invalid email address'),
  tenantId: z.string().min(1, 'Hospital ID is required'),
});

type Form = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [forgotPassword, { isLoading, isSuccess, error }] = useForgotPasswordMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Form) {
    try {
      await forgotPassword({ email: values.email, tenantId: values.tenantId }).unwrap();
    } catch {
      // Errors (e.g. setup-not-complete) are surfaced via RTK Query's `error` state below
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Reset password</CardTitle>
        <CardDescription>
          {isSuccess
            ? 'If that email exists, a reset link has been sent to your inbox.'
            : 'Enter your Hospital ID and email address to receive a reset link.'}
        </CardDescription>
      </CardHeader>

      {!isSuccess && (
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
            <a href="/login" className="text-sm text-muted-foreground hover:underline text-center">
              Back to sign in
            </a>
          </CardFooter>
        </form>
      )}

      {isSuccess && (
        <CardFooter>
          <a href="/login" className="text-sm text-primary hover:underline">
            Back to sign in
          </a>
        </CardFooter>
      )}
    </Card>
  );
}
