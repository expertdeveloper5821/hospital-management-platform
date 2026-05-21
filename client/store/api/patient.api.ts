import { baseApi } from './base.api';
import { type FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { RootState } from '../index';
import type {
  ApiSuccess,
  PatientResponse,
  PatientSearchResult,
  CreatePatientRequest,
  UpdatePatientRequest,
} from '../types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';

export const patientApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    searchPatients: build.query<PatientSearchResult, { q?: string; page?: number; limit?: number }>({
      query: ({ q, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (q) params.set('q', q);
        return `/api/patients?${params}`;
      },
      transformResponse: (raw: ApiSuccess<PatientSearchResult>) => raw.data,
      providesTags: ['Patient'],
    }),

    getPatientById: build.query<PatientResponse, string>({
      query: (patientId) => `/api/patients/${patientId}`,
      transformResponse: (raw: ApiSuccess<PatientResponse>) => raw.data,
      providesTags: ['Patient'],
    }),

    createPatient: build.mutation<PatientResponse, CreatePatientRequest>({
      query: (body) => ({ url: '/api/patients', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PatientResponse>) => raw.data,
      invalidatesTags: ['Patient'],
    }),

    updatePatient: build.mutation<PatientResponse, { patientId: string } & UpdatePatientRequest>({
      query: ({ patientId, ...body }) => ({ url: `/api/patients/${patientId}`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<PatientResponse>) => raw.data,
      invalidatesTags: ['Patient'],
    }),

    // Downloads the Medical Card PDF; returns a blob object URL for the <a> tag.
    // Uses queryFn because the endpoint returns a raw PDF, not JSON.
    downloadMedicalCard: build.mutation<string, string>({
      queryFn: async (patientId, { getState }) => {
        const token = (getState() as RootState).auth.token;
        try {
          const res = await fetch(`${BASE_URL}/api/patients/${patientId}/medical-card`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) {
            const err: FetchBaseQueryError = { status: res.status, data: 'Failed to download medical card' };
            return { error: err };
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          return { data: url };
        } catch {
          const err: FetchBaseQueryError = { status: 'FETCH_ERROR', error: 'Network error' };
          return { error: err };
        }
      },
    }),
  }),
});

export const {
  useSearchPatientsQuery,
  useGetPatientByIdQuery,
  useCreatePatientMutation,
  useUpdatePatientMutation,
  useDownloadMedicalCardMutation,
} = patientApi;
