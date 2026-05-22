import { baseApi } from './base.api';
import type {
  ApiSuccess,
  OPDVisitResponse,
  OPDPatientHistory,
  CreateOPDVisitRequest,
  UpdateOPDVisitRequest,
  CompleteOPDVisitRequest,
} from '../types';

export const opdApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    getOPDQueue: build.query<OPDVisitResponse[], { date?: string; doctorId?: string }>({
      query: ({ date, doctorId } = {}) => {
        const params = new URLSearchParams();
        if (date)     params.set('date',     date);
        if (doctorId) params.set('doctorId', doctorId);
        const qs = params.toString();
        return `/api/opd/visits${qs ? `?${qs}` : ''}`;
      },
      transformResponse: (raw: ApiSuccess<OPDVisitResponse[]>) => raw.data,
      providesTags: ['OPD'],
    }),

    getOPDVisitById: build.query<OPDVisitResponse, string>({
      query: (visitId) => `/api/opd/visits/${visitId}`,
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      providesTags: ['OPD'],
    }),

    createOPDVisit: build.mutation<OPDVisitResponse, CreateOPDVisitRequest>({
      query: (body) => ({ url: '/api/opd/visits', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      invalidatesTags: ['OPD'],
    }),

    updateOPDVisit: build.mutation<OPDVisitResponse, { visitId: string } & UpdateOPDVisitRequest>({
      query: ({ visitId, ...body }) => ({ url: `/api/opd/visits/${visitId}`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      invalidatesTags: ['OPD'],
    }),

    completeOPDVisit: build.mutation<OPDVisitResponse, { visitId: string } & CompleteOPDVisitRequest>({
      query: ({ visitId, ...body }) => ({ url: `/api/opd/visits/${visitId}/complete`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      invalidatesTags: ['OPD'],
    }),

    cancelOPDVisit: build.mutation<OPDVisitResponse, string>({
      query: (visitId) => ({ url: `/api/opd/visits/${visitId}/cancel`, method: 'PATCH' }),
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      invalidatesTags: ['OPD'],
    }),

    getOPDPatientHistory: build.query<OPDPatientHistory, { patientId: string; page?: number; limit?: number }>({
      query: ({ patientId, page = 1, limit = 20 }) =>
        `/api/opd/patients/${patientId}/history?page=${page}&limit=${limit}`,
      transformResponse: (raw: ApiSuccess<OPDPatientHistory>) => raw.data,
      providesTags: ['OPD'],
    }),
  }),
});

export const {
  useGetOPDQueueQuery,
  useGetOPDVisitByIdQuery,
  useCreateOPDVisitMutation,
  useUpdateOPDVisitMutation,
  useCompleteOPDVisitMutation,
  useCancelOPDVisitMutation,
  useGetOPDPatientHistoryQuery,
} = opdApi;
