import { baseApi } from './base.api';
import { tokenReceived, profileLoaded, setBranding, logout } from '../slices/auth.slice';
import type {
  LoginRequest,
  LoginApiResponse,
  MeResponse,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ApiSuccess,
  BrandingConfig,
} from '../types';

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    login: build.mutation<LoginApiResponse, LoginRequest>({
      query: (body) => ({ url: '/api/auth/login', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<LoginApiResponse>) => raw.data,
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          // 1. Store token and mark authenticated
          dispatch(tokenReceived(data.token));

          // 2. Fetch full profile (email + tenantId not in login response)
          const meResult = await dispatch(
            authApi.endpoints.getMe.initiate(undefined, { forceRefetch: true }),
          );
          if ('data' in meResult && meResult.data) {
            dispatch(profileLoaded(meResult.data));

            // 3. Fetch branding if tenant user
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
        } catch {
          // login mutation error is handled by the caller
        }
      },
    }),

    getMe: build.query<MeResponse, undefined>({
      query: () => '/api/auth/me',
      transformResponse: (raw: ApiSuccess<MeResponse>) => raw.data,
      providesTags: ['Auth'],
    }),

    getBranding: build.query<BrandingConfig, string>({
      query: (tenantId) => `/api/tenants/${tenantId}/branding`,
      transformResponse: (raw: ApiSuccess<BrandingConfig>) => raw.data,
      providesTags: ['Tenant'],
    }),

    logout: build.mutation<void, void>({
      query: () => ({ url: '/api/auth/logout', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } finally {
          // Clear auth state whether or not the API call succeeds
          dispatch(logout());
          dispatch(baseApi.util.resetApiState());
        }
      },
    }),

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
  useGetMeQuery,
  useGetBrandingQuery,
  useLogoutMutation,
  useChangePasswordMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
} = authApi;
