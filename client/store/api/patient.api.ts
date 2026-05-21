import { baseApi } from './base.api';
import type { ApiSuccess, PatientResponse, PaginatedResult } from '../types';

export const patientApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    searchPatients: build.query<PaginatedResult<PatientResponse>, { q?: string; page?: number; limit?: number }>({
      query: ({ q, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (q) params.set('q', q);
        return `/api/patients?${params}`;
      },
      transformResponse: (raw: ApiSuccess<PaginatedResult<PatientResponse>>) => raw.data,
      providesTags: ['Patient'],
    }),

    getPatient: build.query<PatientResponse, string>({
      query: (patientId) => `/api/patients/${patientId}`,
      transformResponse: (raw: ApiSuccess<PatientResponse>) => raw.data,
      providesTags: ['Patient'],
    }),
  }),
});

export const {
  useSearchPatientsQuery,
  useGetPatientQuery,
} = patientApi;
