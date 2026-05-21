import { baseApi } from './base.api';
import type {
  ApiSuccess,
  PathologyRequestResponse,
  RadiologyRequestResponse,
  CreatePathologyRequest,
  CreateRadiologyRequest,
  LabListResult,
} from '../types';

export const labApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    // ─── Pathology ────────────────────────────────────────────────────────────

    listPathologyRequests: build.query<
      LabListResult<PathologyRequestResponse>,
      { patientId?: string; status?: string; page?: number; limit?: number }
    >({
      query: ({ patientId, status, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams();
        if (patientId) params.set('patientId', patientId);
        if (status)    params.set('status',    status);
        params.set('page',  String(page));
        params.set('limit', String(limit));
        return `/api/lab/pathology?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<LabListResult<PathologyRequestResponse>>) => raw.data,
      providesTags: ['Lab'],
    }),

    getPathologyRequest: build.query<PathologyRequestResponse, string>({
      query: (requestId) => `/api/lab/pathology/${requestId}`,
      transformResponse: (raw: ApiSuccess<PathologyRequestResponse>) => raw.data,
      providesTags: ['Lab'],
    }),

    createPathologyRequest: build.mutation<PathologyRequestResponse, CreatePathologyRequest>({
      query: (body) => ({ url: '/api/lab/pathology', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PathologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    uploadPathologyReport: build.mutation<
      PathologyRequestResponse,
      { requestId: string; file: File }
    >({
      query: ({ requestId, file }) => {
        const formData = new FormData();
        formData.append('report', file);
        return { url: `/api/lab/pathology/${requestId}/report`, method: 'PATCH', body: formData };
      },
      transformResponse: (raw: ApiSuccess<PathologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    // ─── Radiology ────────────────────────────────────────────────────────────

    listRadiologyRequests: build.query<
      LabListResult<RadiologyRequestResponse>,
      { patientId?: string; status?: string; page?: number; limit?: number }
    >({
      query: ({ patientId, status, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams();
        if (patientId) params.set('patientId', patientId);
        if (status)    params.set('status',    status);
        params.set('page',  String(page));
        params.set('limit', String(limit));
        return `/api/lab/radiology?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<LabListResult<RadiologyRequestResponse>>) => raw.data,
      providesTags: ['Lab'],
    }),

    getRadiologyRequest: build.query<RadiologyRequestResponse, string>({
      query: (requestId) => `/api/lab/radiology/${requestId}`,
      transformResponse: (raw: ApiSuccess<RadiologyRequestResponse>) => raw.data,
      providesTags: ['Lab'],
    }),

    createRadiologyRequest: build.mutation<RadiologyRequestResponse, CreateRadiologyRequest>({
      query: (body) => ({ url: '/api/lab/radiology', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<RadiologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    uploadRadiologyReport: build.mutation<
      RadiologyRequestResponse,
      { requestId: string; file: File }
    >({
      query: ({ requestId, file }) => {
        const formData = new FormData();
        formData.append('report', file);
        return { url: `/api/lab/radiology/${requestId}/report`, method: 'PATCH', body: formData };
      },
      transformResponse: (raw: ApiSuccess<RadiologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),
  }),
});

export const {
  useListPathologyRequestsQuery,
  useGetPathologyRequestQuery,
  useCreatePathologyRequestMutation,
  useUploadPathologyReportMutation,
  useListRadiologyRequestsQuery,
  useGetRadiologyRequestQuery,
  useCreateRadiologyRequestMutation,
  useUploadRadiologyReportMutation,
} = labApi;
