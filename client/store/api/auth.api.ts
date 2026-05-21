import { baseApi } from './base.api';
import { tokenReceived, profileLoaded, setBranding, logout } from '../slices/auth.slice';
import type {
  LoginApiResponse,
  MeResponse,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ApiSuccess,
  BrandingConfig,
  UserRole,
} from '../types';

// JWT claims mirroring the server-side JWTPayload interface
interface JwtClaims {
  userId:       string;
  email:        string;
  role:         UserRole;
  tenantId:     string | null;
  isFirstLogin: boolean;
}

function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload)) as JwtClaims;
  } catch {
    return null;
  }
}

// ─── Shared post-login side-effects ──────────────────────────────────────────
// Decodes the JWT rather than calling /me, so it works even when
// isFirstLogin=true (the /me endpoint is blocked by requireFirstPasswordChange).
async function handlePostLogin(token: string, dispatch: any) {
  dispatch(tokenReceived(token));

  const claims = decodeJwt(token);
  if (!claims) return;

  dispatch(profileLoaded({
    userId:       claims.userId,
    email:        claims.email,
    role:         claims.role,
    tenantId:     claims.tenantId,
    isFirstLogin: claims.isFirstLogin,
  }));

  // Skip branding fetch on first login — user goes to /change-password anyway
  if (!claims.isFirstLogin && claims.tenantId) {
    const brandingResult = await dispatch(
      authApi.endpoints.getBranding.initiate(claims.tenantId, { forceRefetch: true }),
    );
    if ('data' in brandingResult && brandingResult.data) {
      dispatch(setBranding(brandingResult.data));
    }
  }
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    // ── Regular hospital user login ──────────────────────────────────────────
    login: build.mutation<LoginApiResponse, { email: string; password: string; tenantId?: string }>({
      query: (body) => ({ url: '/api/auth/login', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<LoginApiResponse>) => raw.data,
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          await handlePostLogin(data.token, dispatch);
        } catch {
          // mutation error is surfaced by the caller
        }
      },
    }),

    // ── Super Admin login — dedicated endpoint, no tenantId ──────────────────
    superAdminLogin: build.mutation<LoginApiResponse, { email: string; password: string }>({
      query: (body) => ({ url: '/api/super-admin/login', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<LoginApiResponse>) => raw.data,
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          await handlePostLogin(data.token, dispatch);
        } catch {
          // mutation error is surfaced by the caller
        }
      },
    }),

    // ── /me endpoints ─────────────────────────────────────────────────────────
    getMe: build.query<MeResponse, undefined>({
      query: () => '/api/auth/me',
      transformResponse: (raw: ApiSuccess<MeResponse>) => raw.data,
      providesTags: ['Auth'],
    }),

    getSuperAdminMe: build.query<MeResponse, undefined>({
      query: () => '/api/super-admin/me',
      transformResponse: (raw: ApiSuccess<MeResponse>) => raw.data,
      providesTags: ['Auth'],
    }),

    // ── Branding ──────────────────────────────────────────────────────────────
    getBranding: build.query<BrandingConfig, string>({
      query: (tenantId) => `/api/tenants/${tenantId}/branding`,
      transformResponse: (raw: ApiSuccess<BrandingConfig>) => raw.data,
      providesTags: ['Tenant'],
    }),

    // ── Logout — routes to correct endpoint based on stored role ─────────────
    logout: build.mutation<void, { isSuperAdmin: boolean }>({
      query: ({ isSuperAdmin }) => ({
        url:    isSuperAdmin ? '/api/super-admin/logout' : '/api/auth/logout',
        method: 'POST',
      }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } finally {
          dispatch(logout());
          dispatch(baseApi.util.resetApiState());
        }
      },
    }),

    // ── Password management ───────────────────────────────────────────────────
    changePassword: build.mutation<{ message: string; token: string }, ChangePasswordRequest>({
      query: (body) => ({ url: '/api/auth/change-password', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<{ message: string; token: string }>) => raw.data,
    }),

    forgotPassword: build.mutation<{ message: string }, ForgotPasswordRequest>({
      query: (body) => ({ url: '/api/auth/forgot-password', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
    }),

    resetPassword: build.mutation<{ message: string }, ResetPasswordRequest>({
      query: (body) => ({ url: '/api/auth/reset-password', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
    }),

    completeSetup: build.mutation<{ jwtToken: string }, { token: string; password: string }>({
      query: (body) => ({ url: '/api/tenants/setup', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<{ jwtToken: string }>) => raw.data,
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          await handlePostLogin(data.jwtToken, dispatch);
        } catch { /* error surfaced by caller */ }
      },
    }),
  }),
});

export const {
  useLoginMutation,
  useSuperAdminLoginMutation,
  useGetMeQuery,
  useGetSuperAdminMeQuery,
  useGetBrandingQuery,
  useLogoutMutation,
  useChangePasswordMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useCompleteSetupMutation,
} = authApi;
