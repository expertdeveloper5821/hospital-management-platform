'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { useChangePasswordMutation } from '@/store/api/auth.api';
import { useAppDispatch } from '@/store/hooks';
import { tokenReceived, setFirstLoginDone } from '@/store/slices/auth.slice';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword:     z.string().min(8, 'Minimum 8 characters'),
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
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              {...register('currentPassword')}
            />
            {errors.currentPassword && (
              <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...register('newPassword')}
            />
            {errors.newPassword && (
              <p className="text-xs text-destructive">{errors.newPassword.message}</p>
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
            {isLoading ? 'Saving…' : 'Save new password'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
