import { z } from 'zod';

// Human-readable summary of the policy — show this as a hint under new-password fields.
export const PASSWORD_REQUIREMENTS =
  'At least 8 characters, including an uppercase letter, a lowercase letter, a number, and a special character.';

// ─── Standard password policy (mirrors server/src/shared/utils/password.ts) ────
// Applied to every new password: setup, change password, reset password, and the
// super-admin equivalents.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a special character');
