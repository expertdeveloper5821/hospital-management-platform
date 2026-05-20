import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type {
  CreatePatientRequestDto,
  UpdatePatientRequestDto,
  PatientResponseDto,
  PatientListResponseDto,
  PatientSearchQueryDto,
  DuplicateWarningResponseDto,
} from '../../../contracts/dto/patient/patient.dto';
import type { ApiResponse } from '../../../contracts/common/api-response.dto';

export const patientApi = createApi({
  reducerPath: 'patientApi',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
    prepareHeaders: (headers, { getState }) => {
      const state = getState() as { auth: { token: string | null } };
      if (state.auth.token) headers.set('Authorization', `Bearer ${state.auth.token}`);
      return headers;
    },
  }),
  tagTypes: ['Patient'],
  endpoints: (build) => ({

    searchPatients: build.query<ApiResponse<PatientListResponseDto>, PatientSearchQueryDto>({
      query: (params) => ({ url: '/patients', params }),
      providesTags: ['Patient'],
    }),

    getPatient: build.query<ApiResponse<PatientResponseDto>, string>({
      query: (patientId) => `/patients/${patientId}`,
      providesTags: (_r, _e, id) => [{ type: 'Patient', id }],
    }),

    createPatient: build.mutation<
      ApiResponse<PatientResponseDto | DuplicateWarningResponseDto>,
      CreatePatientRequestDto
    >({
      query: (body) => ({ url: '/patients', method: 'POST', body }),
      invalidatesTags: ['Patient'],
    }),

    updatePatient: build.mutation<
      ApiResponse<PatientResponseDto>,
      { patientId: string; body: UpdatePatientRequestDto }
    >({
      query: ({ patientId, body }) => ({ url: `/patients/${patientId}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { patientId }) => [{ type: 'Patient', id: patientId }],
    }),

  }),
});

export const {
  useSearchPatientsQuery,
  useGetPatientQuery,
  useCreatePatientMutation,
  useUpdatePatientMutation,
} = patientApi;
