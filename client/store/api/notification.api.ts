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
      // Optimistically patch the cached list + unread count so notifications
      // fetched from history (not delivered over WS this session) reflect
      // "read" immediately instead of waiting on the invalidation refetch.
      async onQueryStarted(notificationId, { dispatch, queryFulfilled }) {
        const patches = [
          dispatch(
            notificationApi.util.updateQueryData('listNotifications', { limit: 30 }, (draft) => {
              if (!Array.isArray(draft)) return;
              const item = draft.find((n) => n.id === notificationId);
              if (item) item.read = true;
            }),
          ),
          dispatch(
            notificationApi.util.updateQueryData('getUnreadCount', undefined, (count) =>
              typeof count === 'number' && Number.isFinite(count)
                ? Math.max(0, count - 1)
                : count),
          ),
        ];
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
    }),

    markAllNotificationsRead: build.mutation<{ count: number }, void>({
      query: () => ({
        url:    '/api/notifications/mark-all-read',
        method: 'PATCH',
      }),
      transformResponse: (raw: ApiSuccess<{ count: number }>) => raw.data,
      invalidatesTags: ['Notification'],
      // Optimistically clear the badge and the visible list immediately —
      // invalidatesTags reconciles with the server's authoritative state
      // right after, so any drift self-corrects on the same round trip.
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const patches = [
          dispatch(
            notificationApi.util.updateQueryData('listNotifications', { limit: 30 }, (draft) => {
              if (!Array.isArray(draft)) return;
              draft.forEach((n) => { n.read = true; });
            }),
          ),
          dispatch(notificationApi.util.updateQueryData('getUnreadCount', undefined, () => 0)),
        ];
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
    }),
  }),
});

export const {
  useGetUnreadCountQuery,
  useListNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = notificationApi;
