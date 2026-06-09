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
  logo?:         File;
}

interface BrandingDetail {
  logoUrl?:     string | null;
  displayName:  string;
  primaryColor: string;
}

export const tenantApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    listTenants: build.query<PaginatedResult<TenantSummary>, { page?: number; limit?: number; search?: string }>({
      query: ({ page = 1, limit = 20, search } = {}) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (search) params.set('q', search);
        return `/api/tenants?${params.toString()}`;
      },
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

    // PATCH /:tenantId/branding — sends FormData when a logo file is included,
    // plain JSON otherwise (backend accepts both text fields).
    updateBranding: build.mutation<{ message: string }, { tenantId: string } & UpdateBrandingRequest>({
      query: ({ tenantId, logo, ...fields }) => {
        if (logo) {
          const body = new FormData();
          body.append('logo', logo);
          if (fields.displayName)  body.append('displayName',  fields.displayName);
          if (fields.primaryColor) body.append('primaryColor', fields.primaryColor);
          return { url: `/api/tenants/${tenantId}/branding`, method: 'PATCH', body };
        }
        return { url: `/api/tenants/${tenantId}/branding`, method: 'PATCH', body: fields };
      },
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Tenant'],
    }),

    // GET /:tenantId/branding
    getBranding: build.query<BrandingDetail, string>({
      query: (tenantId) => `/api/tenants/${tenantId}/branding`,
      transformResponse: (raw: ApiSuccess<BrandingDetail>) => raw.data,
      providesTags: ['Tenant'],
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
} = tenantApi;
