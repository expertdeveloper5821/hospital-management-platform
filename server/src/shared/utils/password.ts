import { z } from 'zod';

// ─── Standard password policy ─────────────────────────────────────────────────
// Applied to EVERY new password across the app (user setup, change password,
// reset password, and super-admin equivalents). Requirements:
//   • at least 8 characters (max 128)
//   • at least one uppercase letter
//   • at least one lowercase letter
//   • at least one number
//   • at least one special character
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a special character');
