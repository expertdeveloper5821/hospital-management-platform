import { baseApi } from './base.api';
import type { ApiSuccess, PaginatedResult } from '../types';

interface TenantSummary {
  _id:        string;
  name:       string;
  adminEmail: string;
  status:     string;
  createdAt:  string;
}

interface CreateTenantRequest {
  name:       string;
  adminEmail: string;
  onboardingDocuments: {
    registrationCertificate: string;
    gstNumber:               string;
    panCard:                 string;
    addressProof:            string;
  };
}

interface UpdateBrandingRequest {
  displayName?:  string;
  primaryColor?: string;
}

interface BrandingDetail {
  logoUrl?:     string | null;
  displayName:  string;
  primaryColor: string;
}

export const tenantApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    listTenants: build.query<PaginatedResult<TenantSummary>, { page?: number; limit?: number }>({
      query: ({ page = 1, limit = 20 } = {}) => `/api/tenants?page=${page}&limit=${limit}`,
      transformResponse: (raw: ApiSuccess<PaginatedResult<TenantSummary>>) => raw.data,
      providesTags: ['Tenant'],
    }),

    createTenant: build.mutation<TenantSummary, CreateTenantRequest>({
      query: (body) => ({ url: '/api/tenants', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<TenantSummary>) => raw.data,
      invalidatesTags: ['Tenant'],
    }),

    approveTenant: build.mutation<{ message: string }, string>({
      query: (tenantId) => ({ url: `/api/tenants/${tenantId}/approve`, method: 'PATCH' }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Tenant'],
    }),

    deactivateTenant: build.mutation<{ message: string }, string>({
      query: (tenantId) => ({ url: `/api/tenants/${tenantId}/deactivate`, method: 'PATCH' }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Tenant'],
    }),

    resendInvite: build.mutation<{ message: string }, string>({
      query: (tenantId) => ({ url: `/api/tenants/${tenantId}/resend-invite`, method: 'POST' }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
    }),

    updateBranding: build.mutation<{ message: string }, { tenantId: string } & UpdateBrandingRequest>({
      query: ({ tenantId, ...body }) => ({
        url:    `/api/tenants/${tenantId}/branding`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Tenant'],
    }),

    getBranding: build.query<BrandingDetail, string>({
      query: (tenantId) => `/api/tenants/${tenantId}/branding`,
      transformResponse: (raw: ApiSuccess<BrandingDetail>) => raw.data,
      providesTags: ['Tenant'],
    }),

    uploadLogo: build.mutation<{ message: string }, { tenantId: string; file: File }>({
      query: ({ tenantId, file }) => {
        const body = new FormData();
        body.append('logo', file);
        return { url: `/api/tenants/${tenantId}/branding/logo`, method: 'POST', body };
      },
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Tenant'],
    }),
  }),
});

export const {
  useListTenantsQuery,
  useCreateTenantMutation,
  useApproveTenantMutation,
  useDeactivateTenantMutation,
  useResendInviteMutation,
  useUpdateBrandingMutation,
  useGetBrandingQuery,
  useUploadLogoMutation,
} = tenantApi;
