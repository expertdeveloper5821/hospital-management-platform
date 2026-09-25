// Decodes the (tenantId, userId) pair the offline layer keys its IndexedDB
// databases and crypto keys on. Deliberately duplicated from AuthHydrator's
// decodeJwt rather than imported from it — AuthHydrator is a React component
// and this needs to be callable from plain modules (the base query wrapper,
// the sync processor) with no component tree involved. Same reasoning as
// authenticateJWT/JWTPayload on the backend: this never verifies the
// signature, it only reads claims already trusted because the token is only
// ever set by our own login flow.

export interface OfflineSession {
  tenantId: string;
  userId:   string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split('.')[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Returns null for a missing/malformed token, or for Super Admin (tenantId is
 * null for that role) — the offline layer is tenant-scoped clinical/
 * front-desk flows only, per the architecture plan's online-only operations
 * list.
 */
export function getSessionFromToken(token: string | null | undefined): OfflineSession | null {
  if (!token) return null;

  const claims = decodeJwtPayload(token);
  if (!claims) return null;

  const { tenantId, userId } = claims;
  if (typeof tenantId !== 'string' || typeof userId !== 'string') return null;

  return { tenantId, userId };
}
