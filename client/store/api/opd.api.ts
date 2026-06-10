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

    getOPDQueue: build.query<OPDVisitResponse[], { date?: string; doctorId?: string; search?: string }>({
      query: ({ date, doctorId, search } = {}) => {
        const params = new URLSearchParams();
        if (date)     params.set('date',     date);
        if (doctorId) params.set('doctorId', doctorId);
        if (search)   params.set('search',   search);
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

    getOPDPatientHistory: build.query<OPDPatientHistory, {
      patientId:  string;
      page?:      number;
      limit?:     number;
      startDate?: string;
      endDate?:   string;
      status?:    'OPEN' | 'COMPLETED';
      search?:    string;
    }>({
      query: ({ patientId, page = 1, limit = 10, startDate, endDate, status, search }) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (startDate) params.set('startDate', startDate);
        if (endDate)   params.set('endDate',   endDate);
        if (status)    params.set('status',    status);
        if (search)    params.set('search',    search);
        return `/api/opd/patients/${patientId}/history?${params}`;
      },
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
