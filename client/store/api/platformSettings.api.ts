import { baseApi } from './base.api';

export interface PlatformSettingsData {
  logoUrl:       string | null;
  faviconUrl:    string | null;
  platformTitle: string;
  updatedAt:     string | null;
}

export const platformSettingsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getPlatformSettings: build.query<PlatformSettingsData, void>({
      query: () => '/api/tenants/platform-settings',
      transformResponse: (res: { status: string; data: PlatformSettingsData }) => res.data,
      providesTags: ['PlatformSettings'],
    }),

    updatePlatformTitle: build.mutation<void, { platformTitle: string }>({
      query: (body) => ({ url: '/api/tenants/platform-settings', method: 'PATCH', body }),
      invalidatesTags: ['PlatformSettings'],
    }),

    uploadPlatformLogo: build.mutation<void, FormData>({
      query: (body) => ({
        url:    '/api/tenants/platform-settings/logo',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['PlatformSettings'],
    }),

    uploadPlatformFavicon: build.mutation<void, FormData>({
      query: (body) => ({
        url:    '/api/tenants/platform-settings/favicon',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['PlatformSettings'],
    }),
  }),
});

export const {
  useGetPlatformSettingsQuery,
  useUpdatePlatformTitleMutation,
  useUploadPlatformLogoMutation,
  useUploadPlatformFaviconMutation,
} = platformSettingsApi;
