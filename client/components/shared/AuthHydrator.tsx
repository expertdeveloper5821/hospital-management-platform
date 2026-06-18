'use client';

import { useEffect } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { tokenReceived, profileLoaded, setBranding, hydrationComplete, TOKEN_STORAGE_KEY } from '@/store/slices/auth.slice';
import { authApi } from '@/store/api/auth.api';
import type { UserRole } from '@/store/types';

interface JwtClaims {
  userId:       string;
  email:        string;
  role:         UserRole;
  tenantId:     string | null;
  isFirstLogin: boolean;
  exp?:         number;
}

function decodeJwt(token: string): JwtClaims | null {
  try {
    return JSON.parse(atob(token.split('.')[1])) as JwtClaims;
  } catch {
    return null;
  }
}

export function AuthHydrator() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);

    if (!token) {
      dispatch(hydrationComplete());
      return;
    }

    const claims = decodeJwt(token);
    if (!claims) {
      dispatch(hydrationComplete());
      return;
    }

    // Reject expired tokens immediately (exp is in seconds)
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      dispatch(hydrationComplete());
      return;
    }

    dispatch(tokenReceived(token));
    dispatch(profileLoaded({
      userId:       claims.userId,
      email:        claims.email,
      role:         claims.role,
      tenantId:     claims.tenantId,
      isFirstLogin: claims.isFirstLogin,
    }));
    dispatch(hydrationComplete());

    if (!claims.isFirstLogin && claims.tenantId) {
      dispatch(
        authApi.endpoints.getBranding.initiate(claims.tenantId, { forceRefetch: true }),
      ).then((result) => {
        if ('data' in result && result.data) {
          dispatch(setBranding(result.data));
        }
      });
    }
  }, [dispatch]);

  return null;
}
