import { baseApi } from './base.api';
import type {
  ApiSuccess,
  PaymentResponse,
  PaymentListResult,
  PaymentSummaryResponse,
  CreateManualPaymentRequest,
  CreateRazorpayOrderRequest,
  RazorpayOrderResponse,
} from '../types';

export const paymentApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    listPayments: build.query<
      PaymentListResult,
      { dateFrom?: string; dateTo?: string; paymentMethod?: string; page?: number; limit?: number }
    >({
      query: ({ dateFrom, dateTo, paymentMethod, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams();
        if (dateFrom)       params.set('dateFrom',       dateFrom);
        if (dateTo)         params.set('dateTo',         dateTo);
        if (paymentMethod)  params.set('paymentMethod',  paymentMethod);
        params.set('page',  String(page));
        params.set('limit', String(limit));
        return `/api/payments?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<PaymentListResult>) => raw.data,
      providesTags: ['Payment'],
    }),

    createManualPayment: build.mutation<PaymentResponse, CreateManualPaymentRequest>({
      query: (body) => ({ url: '/api/payments/manual', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PaymentResponse>) => raw.data,
      invalidatesTags: ['Payment'],
    }),

    createRazorpayOrder: build.mutation<RazorpayOrderResponse, CreateRazorpayOrderRequest>({
      query: (body) => ({ url: '/api/payments/razorpay-order', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<RazorpayOrderResponse>) => raw.data,
    }),

    getReceiptUrl: build.query<string, string>({
      query: (paymentId) => `/api/payments/${paymentId}/receipt`,
      transformResponse: (raw: ApiSuccess<{ receiptUrl: string }>) => raw.data.receiptUrl,
    }),

    getPaymentSummary: build.query<
      PaymentSummaryResponse,
      { dateFrom?: string; dateTo?: string }
    >({
      query: ({ dateFrom, dateTo } = {}) => {
        const params = new URLSearchParams();
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo)   params.set('dateTo',   dateTo);
        return `/api/payments/summary?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<PaymentSummaryResponse>) => raw.data,
      providesTags: ['Payment'],
    }),
  }),
});

export const {
  useListPaymentsQuery,
  useCreateManualPaymentMutation,
  useCreateRazorpayOrderMutation,
  useLazyGetReceiptUrlQuery,
  useGetPaymentSummaryQuery,
} = paymentApi;
