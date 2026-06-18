import { baseApi } from './base.api';
import type {
  ApiSuccess,
  ChargeResponse,
  ChargeListResult,
  ChargeCategory,
  AddChargeRequest,
  BillResponse,
} from '../types';

export const chargesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    addCharge: build.mutation<ChargeResponse, AddChargeRequest>({
      query: (body) => ({ url: '/api/charges', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<ChargeResponse>) => raw.data,
      invalidatesTags: ['Charge', 'Bill'],
    }),

    voidCharge: build.mutation<ChargeResponse, string>({
      query: (chargeId) => ({ url: `/api/charges/${chargeId}/void`, method: 'PATCH' }),
      transformResponse: (raw: ApiSuccess<ChargeResponse>) => raw.data,
      invalidatesTags: ['Charge', 'Bill'],
    }),

    getPatientBill: build.query<BillResponse, string>({
      query: (patientId) => `/api/patients/${patientId}/bill`,
      transformResponse: (raw: ApiSuccess<BillResponse>) => raw.data,
      providesTags: ['Bill'],
    }),

    listCharges: build.query<ChargeListResult, {
      patientId?: string;
      category?:  ChargeCategory;
      startDate?: string;
      endDate?:   string;
      addedBy?:   string;
      page?:      number;
      limit?:     number;
    } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.patientId) params.set('patientId', args.patientId);
        if (args?.category)  params.set('category',  args.category);
        if (args?.startDate) params.set('startDate', args.startDate);
        if (args?.endDate)   params.set('endDate',   args.endDate);
        if (args?.addedBy)   params.set('addedBy',   args.addedBy);
        if (args?.page)      params.set('page',      String(args.page));
        if (args?.limit)     params.set('limit',     String(args.limit));
        const qs = params.toString();
        return `/api/charges${qs ? `?${qs}` : ''}`;
      },
      transformResponse: (raw: ApiSuccess<ChargeListResult>) => raw.data,
      providesTags: ['Charge'],
    }),
  }),
});

export const {
  useAddChargeMutation,
  useVoidChargeMutation,
  useGetPatientBillQuery,
  useListChargesQuery,
} = chargesApi;
