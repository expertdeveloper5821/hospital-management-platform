// Exponential backoff schedule for outbox retries after a network failure.
// A validation/conflict response (409/422) never reaches this — those are
// terminal (CONFLICT/FAILED) and require manual resolution, not a retry.
const BACKOFF_SCHEDULE_MS = [
  5_000,   // 1st retry: 5s
  15_000,  // 2nd retry: 15s
  45_000,  // 3rd retry: 45s
  120_000, // 4th retry: 2m
  300_000, // 5th+ retry: 5m (capped)
];

/** `attempts` is the number of prior failed attempts (0 before the first failure). */
export function computeBackoffDelayMs(attempts: number): number {
  const index = Math.min(attempts, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[index];
}
