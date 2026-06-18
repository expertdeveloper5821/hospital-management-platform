import { baseApi } from './base.api';
import type { ApiSuccess, StaffDocumentResponse, ChecklistItem } from '../types';

export const staffDocumentsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    uploadDocument: build.mutation<StaffDocumentResponse, { userId: string; formData: FormData }>({
      query: ({ userId, formData }) => ({
        url:    `/api/staff-documents/users/${userId}`,
        method: 'POST',
        body:   formData,
      }),
      transformResponse: (raw: ApiSuccess<StaffDocumentResponse>) => raw.data,
      invalidatesTags: ['StaffDocument'],
    }),

    listDocuments: build.query<StaffDocumentResponse[], string>({
      query: (userId) => `/api/staff-documents/users/${userId}`,
      transformResponse: (raw: ApiSuccess<StaffDocumentResponse[]>) => raw.data,
      providesTags: ['StaffDocument'],
    }),

    getChecklist: build.query<ChecklistItem[], string>({
      query: (userId) => `/api/staff-documents/users/${userId}/checklist`,
      transformResponse: (raw: ApiSuccess<ChecklistItem[]>) => raw.data,
      providesTags: ['StaffDocument'],
    }),

    deleteDocument: build.mutation<StaffDocumentResponse, string>({
      query: (documentId) => ({ url: `/api/staff-documents/${documentId}`, method: 'DELETE' }),
      transformResponse: (raw: ApiSuccess<StaffDocumentResponse>) => raw.data,
      invalidatesTags: ['StaffDocument'],
    }),
  }),
});

export const {
  useUploadDocumentMutation,
  useListDocumentsQuery,
  useGetChecklistQuery,
  useDeleteDocumentMutation,
} = staffDocumentsApi;
