import { baseApi } from './base.api';
import type { ApiSuccess, NotificationMessage } from '../types';

// Shape returned by the backend INotification document
interface NotificationApiItem {
  notificationId: string;
  title:          string;
  message:        string;
  entityType:     string | null;
  entityId:       string | null;
  isRead:         boolean;
  createdAt:      string;
}

function mapNotification(n: NotificationApiItem): NotificationMessage {
  return {
    id:         n.notificationId,
    title:      n.title,
    message:    n.message,
    type:       'notification',
    entityType: n.entityType,
    entityId:   n.entityId,
    timestamp:  n.createdAt,
    read:       n.isRead,
  };
}

export const notificationApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    // Seeds unread count on mount / page refresh before WS delivers new messages
    getUnreadCount: build.query<number, void>({
      query: () => '/api/notifications/unread-count',
      transformResponse: (raw: ApiSuccess<{ count: number }>) => raw.data.count,
      providesTags: ['Notification'],
    }),

    // Backend returns INotification[] (not paginated); limit capped at 100 server-side
    listNotifications: build.query<NotificationMessage[], { limit?: number }>({
      query: ({ limit = 30 } = {}) => `/api/notifications?limit=${limit}`,
      transformResponse: (raw: ApiSuccess<NotificationApiItem[]>) =>
        raw.data.map(mapNotification),
      providesTags: ['Notification'],
    }),

    markNotificationRead: build.mutation<NotificationMessage, string>({
      query: (notificationId) => ({
        url:    `/api/notifications/${notificationId}/read`,
        method: 'PATCH',
      }),
      transformResponse: (raw: ApiSuccess<NotificationApiItem>) =>
        mapNotification(raw.data),
      invalidatesTags: ['Notification'],
    }),
  }),
});

export const {
  useGetUnreadCountQuery,
  useListNotificationsQuery,
  useMarkNotificationReadMutation,
} = notificationApi;
