/**
 * Role-change re-auth contract (§5.3 / §9.2 of
 * Doc/hms-role-permission-api-governance.md):
 *
 * The backend's `role_changed` WebSocket frame means the user's existing JWT
 * still carries the OLD role, so the session must end now. The frontend must:
 *   1. clear the stored token / auth.profile (never reuse the old token),
 *   2. invalidate all role-aware queries for this user (RTK Query cache),
 *   3. redirect to /login with `relogin: true` and `rolesChanged: true`,
 *   4. never reuse the current session for role-gated reads afterwards.
 */

import { store } from '@/store';
import { logout } from '@/store/slices/auth.slice';
import { baseApi } from '@/store/api/base.api';
import { wsClient } from '@/lib/websocket-client';

/**
 * Ends the session after a role shift: dispatches the auth logout (clears the
 * persisted token and profile) and resets the entire RTK Query cache in one
 * synchronous action sequence — no role-scoped cache entry can survive into
 * the next login (§5.1/§5.4: USER tags refresh first, route guards re-evaluate
 * on the cleared state, and stale entries are never lifted into the next
 * session).
 */
export function endSessionAfterRoleChange(): void {
  // Tear the socket down first so no further frames (or reconnect attempts)
  // arrive against a dead session — mirrors ProfileDropdown's manual logout.
  wsClient.disconnect();
  store.dispatch(logout());
  // resetApiState empties every endpoint's cache (User, Patient, OPD, IPD,
  // Lab, Payment, …) — tag-based invalidation alone can't be used here
  // because the user is being logged out, not refetched: any surviving
  // role-scoped entry would be stale the moment the user logs back in with
  // their new role.
  store.dispatch(baseApi.util.resetApiState());
}

/**
 * True when the current location was reached through the role-change re-auth
 * redirect (/login?relogin=1&rolesChanged=1). Read once by the login page to
 * show the "your role was changed" notice — the flags live in the URL, not in
 * any store, so they never survive past the login screen.
 */
export function isRoleChangeRelogin(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('relogin') === '1' && params.get('rolesChanged') === '1';
}
