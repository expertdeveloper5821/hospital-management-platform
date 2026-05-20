import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type {
  CreateOPDVisitRequestDto,
  UpdateOPDVisitRequestDto,
  CompleteOPDVisitRequestDto,
  OPDVisitResponseDto,
  OPDQueueQueryDto,
  OPDHistoryQueryDto,
} from '../../../contracts/dto/opd/opd.dto';
import type { ApiResponse, PaginatedResult } from '../../../contracts/common/api-response.dto';

export const opdApi = createApi({
  reducerPath: 'opdApi',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
    prepareHeaders: (headers, { getState }) => {
      const state = getState() as { auth: { token: string | null } };
      if (state.auth.token) headers.set('Authorization', `Bearer ${state.auth.token}`);
      return headers;
    },
  }),
  tagTypes: ['OPDVisit'],
  endpoints: (build) => ({

    getQueue: build.query<ApiResponse<OPDVisitResponseDto[]>, OPDQueueQueryDto>({
      query: (params) => ({ url: '/opd/visits/queue', params }),
      providesTags: ['OPDVisit'],
    }),

    getVisit: build.query<ApiResponse<OPDVisitResponseDto>, string>({
      query: (visitId) => `/opd/visits/${visitId}`,
      providesTags: (_r, _e, id) => [{ type: 'OPDVisit', id }],
    }),

    getPatientHistory: build.query<
      ApiResponse<PaginatedResult<OPDVisitResponseDto>>,
      { patientId: string } & OPDHistoryQueryDto
    >({
      query: ({ patientId, ...params }) => ({ url: `/opd/visits/patient/${patientId}`, params }),
      providesTags: ['OPDVisit'],
    }),

    createVisit: build.mutation<ApiResponse<OPDVisitResponseDto>, CreateOPDVisitRequestDto>({
      query: (body) => ({ url: '/opd/visits', method: 'POST', body }),
      invalidatesTags: ['OPDVisit'],
    }),

    updateVisit: build.mutation<
      ApiResponse<OPDVisitResponseDto>,
      { visitId: string; body: UpdateOPDVisitRequestDto }
    >({
      query: ({ visitId, body }) => ({ url: `/opd/visits/${visitId}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { visitId }) => [{ type: 'OPDVisit', id: visitId }],
    }),

    completeVisit: build.mutation<
      ApiResponse<OPDVisitResponseDto>,
      { visitId: string; body: CompleteOPDVisitRequestDto }
    >({
      query: ({ visitId, body }) => ({ url: `/opd/visits/${visitId}/complete`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { visitId }) => [{ type: 'OPDVisit', id: visitId }],
    }),

    cancelVisit: build.mutation<ApiResponse<OPDVisitResponseDto>, string>({
      query: (visitId) => ({ url: `/opd/visits/${visitId}/cancel`, method: 'POST' }),
      invalidatesTags: (_r, _e, visitId) => [{ type: 'OPDVisit', id: visitId }],
    }),

  }),
});

export const {
  useGetQueueQuery,
  useGetVisitQuery,
  useGetPatientHistoryQuery,
  useCreateVisitMutation,
  useUpdateVisitMutation,
  useCompleteVisitMutation,
  useCancelVisitMutation,
} = opdApi;
