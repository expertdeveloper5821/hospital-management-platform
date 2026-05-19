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
} from '../types';

// ─── Shared post-login side-effects ──────────────────────────────────────────
async function handlePostLogin(
  token:   string,
  role:    string,
  dispatch: Parameters<typeof baseApi.injectEndpoints>[0] extends never ? never : any,
) {
  dispatch(tokenReceived(token));

  // Route /me to the correct endpoint based on role
  const meEndpoint =
    role === 'SUPER_ADMIN'
      ? authApi.endpoints.getSuperAdminMe
      : authApi.endpoints.getMe;

  const meResult = await dispatch(
    (meEndpoint as typeof authApi.endpoints.getMe).initiate(undefined, { forceRefetch: true }),
  );

  if ('data' in meResult && meResult.data) {
    dispatch(profileLoaded(meResult.data));

    const { tenantId } = meResult.data;
    if (tenantId) {
      const brandingResult = await dispatch(
        authApi.endpoints.getBranding.initiate(tenantId, { forceRefetch: true }),
      );
      if ('data' in brandingResult && brandingResult.data) {
        dispatch(setBranding(brandingResult.data));
      }
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
          await handlePostLogin(data.token, data.role, dispatch);
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
          await handlePostLogin(data.token, data.role, dispatch);
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
    changePassword: build.mutation<{ message: string }, ChangePasswordRequest>({
      query: (body) => ({ url: '/api/auth/change-password', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
    }),

    forgotPassword: build.mutation<{ message: string }, ForgotPasswordRequest>({
      query: (body) => ({ url: '/api/auth/forgot-password', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
    }),

    resetPassword: build.mutation<{ message: string }, ResetPasswordRequest>({
      query: (body) => ({ url: '/api/auth/reset-password', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
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
} = authApi;
