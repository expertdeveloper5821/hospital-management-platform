import { baseApi } from './base.api';
import type {
  ApiSuccess,
  InventoryItemResponse,
  CreateInventoryItemRequest,
  UpdateStockRequest,
  UpdateThresholdRequest,
  InventoryListResult,
} from '../types';

export const inventoryApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    listInventoryItems: build.query<
      InventoryListResult,
      { category?: string; lowStock?: boolean; page?: number; limit?: number }
    >({
      query: ({ category, lowStock, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams();
        if (category !== undefined && category !== '') params.set('category', category);
        if (lowStock !== undefined) params.set('lowStock', String(lowStock));
        params.set('page',  String(page));
        params.set('limit', String(limit));
        return `/api/inventory?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<InventoryListResult>) => raw.data,
      providesTags: ['Inventory'],
    }),

    getInventoryItem: build.query<InventoryItemResponse, string>({
      query: (itemId) => `/api/inventory/${itemId}`,
      transformResponse: (raw: ApiSuccess<InventoryItemResponse>) => raw.data,
      providesTags: ['Inventory'],
    }),

    createInventoryItem: build.mutation<InventoryItemResponse, CreateInventoryItemRequest>({
      query: (body) => ({ url: '/api/inventory', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<InventoryItemResponse>) => raw.data,
      invalidatesTags: ['Inventory'],
    }),

    updateStock: build.mutation<InventoryItemResponse, { itemId: string } & UpdateStockRequest>({
      query: ({ itemId, ...body }) => ({ url: `/api/inventory/${itemId}/stock`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<InventoryItemResponse>) => raw.data,
      invalidatesTags: ['Inventory'],
    }),

    updateThreshold: build.mutation<InventoryItemResponse, { itemId: string } & UpdateThresholdRequest>({
      query: ({ itemId, ...body }) => ({ url: `/api/inventory/${itemId}/threshold`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<InventoryItemResponse>) => raw.data,
      invalidatesTags: ['Inventory'],
    }),
  }),
});

export const {
  useListInventoryItemsQuery,
  useGetInventoryItemQuery,
  useCreateInventoryItemMutation,
  useUpdateStockMutation,
  useUpdateThresholdMutation,
} = inventoryApi;
