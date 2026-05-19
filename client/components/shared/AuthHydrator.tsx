'use client';

import { useEffect } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { tokenReceived, profileLoaded, setBranding } from '@/store/slices/auth.slice';
import { TOKEN_STORAGE_KEY } from '@/store/slices/auth.slice';
import { authApi } from '@/store/api/auth.api';
import { UserRole } from '@/store/types';

/**
 * Runs once on app mount. Reads the stored JWT from localStorage and
 * re-fetches the user profile + branding so state survives page refreshes.
 * If the token has expired the /me call will fail (401) and the user
 * stays logged out — no stale state is hydrated.
 */
export function AuthHydrator() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) return;

    // Optimistically mark as authenticated so guards don't flash redirect
    dispatch(tokenReceived(token));

    // Re-fetch profile — determines which /me endpoint to use
    // We don't know the role until we get a response, so try auth/me first;
    // if the user is a super admin their JWT role is in the token itself.
    // Decode role from JWT payload (base64, no crypto needed — just reading claims)
    let role: string | undefined;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      role = payload.role as string;
    } catch {
      role = undefined;
    }

    const meEndpoint =
      role === UserRole.SUPER_ADMIN
        ? authApi.endpoints.getSuperAdminMe
        : authApi.endpoints.getMe;

    dispatch(
      (meEndpoint as typeof authApi.endpoints.getMe).initiate(undefined, { forceRefetch: true }),
    ).then((result) => {
      if ('data' in result && result.data) {
        dispatch(profileLoaded(result.data));

        const { tenantId } = result.data;
        if (tenantId) {
          dispatch(
            authApi.endpoints.getBranding.initiate(tenantId, { forceRefetch: true }),
          ).then((brandingResult) => {
            if ('data' in brandingResult && brandingResult.data) {
              dispatch(setBranding(brandingResult.data));
            }
          });
        }
      }
    });
  }, [dispatch]);

  return null;
}
