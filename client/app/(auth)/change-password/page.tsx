'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { useChangePasswordMutation } from '@/store/api/auth.api';
import { useAppDispatch } from '@/store/hooks';
import { tokenReceived, setFirstLoginDone } from '@/store/slices/auth.slice';
import { passwordSchema, PASSWORD_REQUIREMENTS } from '@/lib/password';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword:     passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'New password must be different from the current password',
    path:    ['newPassword'],
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path:    ['confirmPassword'],
  });

type Form = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const router   = useRouter();
  const dispatch = useAppDispatch();
  const [changePassword, { isLoading, error, isSuccess }] = useChangePasswordMutation();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Form) {
    try {
      const { token } = await changePassword({
        currentPassword: values.currentPassword,
        newPassword:     values.newPassword,
      }).unwrap();
      // Replace the old JWT (which had isFirstLogin: true) with the fresh one
      dispatch(tokenReceived(token));
      dispatch(setFirstLoginDone());
      router.replace('/dashboard');
    } catch {
      // error displayed below
    }
  }

  const apiError =
    error && 'data' in error
      ? (error.data as { message?: string })?.message ?? 'Failed to change password'
      : null;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Set new password</CardTitle>
        <CardDescription>
          {isSuccess
            ? 'Password updated — redirecting…'
            : 'You must set a new password before continuing.'}
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <div className="relative">
              <Input
                id="currentPassword"
                type={showCurrent ? 'text' : 'password'}
                autoComplete="current-password"
                className="pr-10"
                {...register('currentPassword')}
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showCurrent
                  ? <EyeOff className="h-4 w-4" aria-hidden="true" />
                  : <Eye className="h-4 w-4" aria-hidden="true" />
                }
              </button>
            </div>
            {errors.currentPassword && (
              <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                className="pr-10"
                {...register('newPassword')}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                aria-label={showNew ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showNew
                  ? <EyeOff className="h-4 w-4" aria-hidden="true" />
                  : <Eye className="h-4 w-4" aria-hidden="true" />
                }
              </button>
            </div>
            {errors.newPassword ? (
              <p className="text-xs text-destructive">{errors.newPassword.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{PASSWORD_REQUIREMENTS}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                className="pr-10"
                {...register('confirmPassword')}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showConfirm
                  ? <EyeOff className="h-4 w-4" aria-hidden="true" />
                  : <Eye className="h-4 w-4" aria-hidden="true" />
                }
              </button>
            </div>
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
            {isLoading ? 'Saving…' : 'Save new password'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
