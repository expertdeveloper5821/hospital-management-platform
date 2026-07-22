import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { NotificationMessage } from '@/store/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDispatch          = jest.fn();
const mockMarkRead          = jest.fn().mockReturnValue({ catch: (fn: () => void) => Promise.resolve().then(fn, () => {}) });
const mockMarkAllRead       = jest.fn().mockReturnValue({ catch: (fn: () => void) => Promise.resolve().then(fn, () => {}) });

let mockApiUnreadCount: number | undefined = 0;
let mockApiNotifications: NotificationMessage[] = [];
let mockWsMessages: NotificationMessage[] = [];

jest.mock('@/store/api/notification.api', () => ({
  useGetUnreadCountQuery: () => ({ data: mockApiUnreadCount }),
  useListNotificationsQuery: () => ({ data: mockApiNotifications, isFetching: false }),
  useMarkNotificationReadMutation: () => [mockMarkRead, { isLoading: false }],
  useMarkAllNotificationsReadMutation: () => [mockMarkAllRead, { isLoading: false }],
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      auth:         { isAuthenticated: true },
      notification: { messages: mockWsMessages, connected: true },
    }),
  useAppDispatch: () => mockDispatch,
}));

import { NotificationBell } from '@/components/shared/NotificationBell';

function makeMsg(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    id:        'notif-1',
    title:     'Low Stock Alert',
    message:   '"Nasal Spray" stock is low',
    type:      'notification',
    entityType: 'INVENTORY_ITEM',
    entityId:  'item-1',
    timestamp: '2026-07-20T00:00:00.000Z',
    read:      false,
    ...overrides,
  };
}

describe('NotificationBell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiUnreadCount   = 0;
    mockApiNotifications = [];
    mockWsMessages       = [];
  });

  // ─── Badge / unread-count synchronization ────────────────────────────────────

  test('hides the badge when unread count is 0', () => {
    mockApiUnreadCount = 0;
    render(<NotificationBell />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  test('badge reflects the API-backed unread count directly (single source of truth)', () => {
    mockApiUnreadCount = 2;
    render(<NotificationBell />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  test('badge count matches after a simulated page refresh (fresh apiUnreadCount only)', () => {
    // Simulates a hard refresh: no WS messages have arrived yet this session,
    // only the freshly-fetched server count is available.
    mockApiUnreadCount = 3;
    mockWsMessages      = [];
    render(<NotificationBell />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('footer shows a count of unread that can never exceed what mark-all-read can reach', () => {
    // Regression: previously the badge could show a higher number than the
    // notifications actually present in the list (e.g. "1 notification · 2
    // unread"), because the badge was computed from a different, driftable
    // source. Now both values come from the same reconciled cache.
    mockApiUnreadCount   = 1;
    mockApiNotifications = [makeMsg({ id: 'notif-1', read: false })];

    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));

    expect(screen.getByText(/1 notification/)).toBeInTheDocument();
    expect(screen.getByText(/1 unread/)).toBeInTheDocument();
  });

  // ─── Mark single notification as read ────────────────────────────────────────

  test('clicking a notification marks it read via the API', () => {
    mockApiUnreadCount   = 1;
    mockApiNotifications = [makeMsg({ id: 'notif-1', read: false })];

    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    fireEvent.click(screen.getByText('Low Stock Alert'));

    expect(mockMarkRead).toHaveBeenCalledWith('notif-1');
  });

  test('does not call markRead again for an already-read notification', () => {
    mockApiUnreadCount   = 0;
    mockApiNotifications = [makeMsg({ id: 'notif-1', read: true })];

    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    fireEvent.click(screen.getByText('Low Stock Alert'));

    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  // ─── Mark all as read ─────────────────────────────────────────────────────────

  test('"Mark all read" calls the atomic mark-all-read mutation exactly once', () => {
    mockApiUnreadCount   = 2;
    mockApiNotifications = [
      makeMsg({ id: 'notif-1', read: false }),
      makeMsg({ id: 'notif-2', title: 'Another Alert', read: false }),
    ];

    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    fireEvent.click(screen.getByText('Mark all read'));

    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    expect(mockMarkAllRead).toHaveBeenCalledWith();
    // Regression: previously this looped per-item via markRead, which left
    // any notification outside the fetched list unreachable.
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  test('does not show "Mark all read" when there is nothing unread', () => {
    mockApiUnreadCount   = 0;
    mockApiNotifications = [makeMsg({ id: 'notif-1', read: true })];

    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));

    expect(screen.queryByText('Mark all read')).not.toBeInTheDocument();
  });
});
