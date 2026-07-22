import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Turns an UPPER_SNAKE_CASE enum value into a human-readable Title Case label.
 * e.g. 'PENDING_VERIFICATION' → 'Pending Verification', 'SUPER_ADMIN' → 'Super Admin'
 */
export function toTitleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
