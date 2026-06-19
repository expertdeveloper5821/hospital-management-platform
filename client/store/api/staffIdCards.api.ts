import { baseApi } from './base.api';
import type { ApiSuccess, StaffIdCardResponse } from '../types';

export const staffIdCardsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    generateStaffIdCard: build.mutation<StaffIdCardResponse, string>({
      query: (userId) => ({
        url:    `/api/staff-id-cards/${userId}/generate`,
        method: 'POST',
      }),
      transformResponse: (raw: ApiSuccess<StaffIdCardResponse>) => raw.data,
      invalidatesTags: ['StaffIdCard'],
    }),
  }),
});

export const { useGenerateStaffIdCardMutation } = staffIdCardsApi;
