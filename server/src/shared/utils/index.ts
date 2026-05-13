import { v4 as uuidv4 } from 'uuid';

/** Generate a UUID v4 string. Used for correlationIds, entity IDs, etc. */
export function generateId(): string {
  return uuidv4();
}

/** Format a Date as an ISO 8601 string (UTC). */
export function formatDate(date: Date): string {
  return date.toISOString();
}
