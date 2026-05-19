import { baseApi } from './base.api';
import type { ApiSuccess, NotificationMessage, PaginatedResult } from '../types';

export const notificationApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    // Called on mount to seed unread count before WS delivers new messages
    getUnreadCount: build.query<number, void>({
      query: () => '/api/notifications/unread-count',
      transformResponse: (raw: ApiSuccess<{ count: number }>) => raw.data.count,
      providesTags: ['Notification'],
    }),

    listNotifications: build.query<PaginatedResult<NotificationMessage>, { page?: number; limit?: number }>({
      query: ({ page = 1, limit = 20 } = {}) =>
        `/api/notifications?page=${page}&limit=${limit}`,
      transformResponse: (raw: ApiSuccess<PaginatedResult<NotificationMessage>>) => raw.data,
      providesTags: ['Notification'],
    }),

    markNotificationRead: build.mutation<{ message: string }, string>({
      query: (notificationId) => ({
        url:    `/api/notifications/${notificationId}/read`,
        method: 'PATCH',
      }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Notification'],
    }),
  }),
});

export const {
  useGetUnreadCountQuery,
  useListNotificationsQuery,
  useMarkNotificationReadMutation,
} = notificationApi;
