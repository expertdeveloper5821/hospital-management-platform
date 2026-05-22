// TODO(scale): Replace with Redis TokenDenylist. See docs/scaling.md for migration guide.
// Current: in-memory Map, single-instance only. Tokens expire after JWT_EXPIRY (8h).
// On server restart, the denylist is cleared — acceptable for single-instance phase.

const denylist = new Map<string, number>(); // token -> expiry timestamp (ms)

/**
 * Add a JWT to the denylist until its natural expiry.
 * @param token  The raw JWT string
 * @param expiryMs  Milliseconds from now until the token expires
 */
export function addToDenylist(token: string, expiryMs: number): void {
  denylist.set(token, Date.now() + expiryMs);
}

/**
 * Check whether a token has been invalidated (logged out).
 * Lazily removes expired entries on each call.
 */
export function isInDenylist(token: string): boolean {
  if (!denylist.has(token)) return false;

  const expiry = denylist.get(token)!;
  if (Date.now() >= expiry) {
    denylist.delete(token); // lazy cleanup
    return false;
  }
  return true;
}

/** Exposed for testing only — clears the denylist. */
export function clearDenylist(): void {
  denylist.clear();
}
