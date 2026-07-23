// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDispatch = jest.fn();
const mockGetState  = jest.fn(() => ({}));

// Simulates the RTK Query cache entry for getUnreadCount — tests mutate this
// directly to represent "request still in flight" (undefined) vs "resolved".
let mockUnreadCountCache: { data: number | undefined } = { data: undefined };

jest.mock('@/store', () => ({
  store: {
    dispatch:  (...args: unknown[]) => mockDispatch(...args),
    getState: () => mockGetState(),
  },
}));

jest.mock('@/store/slices/notification.slice', () => ({
  messageReceived: (payload: unknown) => ({ type: 'notification/messageReceived', payload }),
  setConnected:    (payload: unknown) => ({ type: 'notification/setConnected', payload }),
}));

jest.mock('@/store/api/notification.api', () => ({
  notificationApi: {
    util: {
      upsertQueryData: jest.fn(
        (endpoint: string, arg: unknown, value: unknown) =>
          ({ type: 'MOCK_UPSERT', endpoint, arg, value }),
      ),
    },
    endpoints: {
      getUnreadCount: {
        select: jest.fn(() => () => mockUnreadCountCache),
      },
    },
  },
}));

import { notificationApi } from '@/store/api/notification.api';
const mockUpsertQueryData = notificationApi.util.upsertQueryData as jest.Mock;

// Fake WebSocket the client's `new WebSocket(url)` call resolves to — lets the
// test drive onopen/onmessage/onclose manually without a real socket.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen:    (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose:   ((event: { code: number }) => void) | null = null;
  onerror:   (() => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() { /* no-op for tests */ }
}

(global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;

import { wsClient } from './websocket-client';

function connectAndOpen(): FakeWebSocket {
  wsClient.connect('test-token');
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  socket.onopen?.();
  return socket;
}

describe('websocket-client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FakeWebSocket.instances = [];
    mockUnreadCountCache = { data: undefined };
  });

  afterEach(() => {
    wsClient.disconnect();
  });

  test('dispatches setConnected(true) on open', () => {
    connectAndOpen();
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'notification/setConnected', payload: true });
  });

  test('dispatches messageReceived with the pushed notification payload', () => {
    const socket = connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'notification',
        data: {
          notificationId: 'notif-1',
          title:          'Low Stock Alert',
          message:        '"Nasal Spray" stock is low',
          entityType:     'INVENTORY_ITEM',
          entityId:       'item-1',
          isRead:         false,
          createdAt:      '2026-07-22T00:00:00.000Z',
        },
      }),
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'notification/messageReceived',
      payload: expect.objectContaining({ id: 'notif-1', title: 'Low Stock Alert', read: false }),
    });
  });

  test('upserts the getUnreadCount cache (+1) for every live push, keeping the badge in sync', () => {
    mockUnreadCountCache = { data: 1 };
    const socket = connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'notification',
        data: {
          notificationId: 'notif-1', title: 'T', message: 'M',
          entityType: null, entityId: null, isRead: false,
          createdAt: '2026-07-22T00:00:00.000Z',
        },
      }),
    });

    expect(mockUpsertQueryData).toHaveBeenCalledWith('getUnreadCount', undefined, 2);
  });

  // Regression test: getUnreadCount is fetched on mount and may still be in
  // flight (cache data === undefined) when the first WS push arrives. Using
  // updateQueryData here would be a no-op against a cache entry with no data,
  // leaving the bell badge stale until the fetch happened to resolve.
  // upsertQueryData must instead initialize the count so the badge updates
  // immediately.
  test('initializes the unread count to 1 when a notification arrives before getUnreadCount resolves', () => {
    mockUnreadCountCache = { data: undefined };
    const socket = connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'notification',
        data: {
          notificationId: 'notif-1', title: 'T', message: 'M',
          entityType: null, entityId: null, isRead: false,
          createdAt: '2026-07-22T00:00:00.000Z',
        },
      }),
    });

    expect(mockUpsertQueryData).toHaveBeenCalledWith('getUnreadCount', undefined, 1);
  });

  test('re-initializes to 1 instead of compounding a non-finite cached value (e.g. corrupted NaN)', () => {
    mockUnreadCountCache = { data: NaN };
    const socket = connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'notification',
        data: {
          notificationId: 'notif-1', title: 'T', message: 'M',
          entityType: null, entityId: null, isRead: false,
          createdAt: '2026-07-22T00:00:00.000Z',
        },
      }),
    });

    expect(mockUpsertQueryData).toHaveBeenCalledWith('getUnreadCount', undefined, 1);
  });

  test('ignores non-notification frames (e.g. the initial "connected" frame)', () => {
    const socket = connectAndOpen();
    mockDispatch.mockClear();
    socket.onmessage?.({ data: JSON.stringify({ type: 'connected', userId: 'u1' }) });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test('dispatches setConnected(false) on close', () => {
    const socket = connectAndOpen();
    socket.onclose?.({ code: 1006 });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'notification/setConnected', payload: false });
  });
});
