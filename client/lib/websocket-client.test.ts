// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDispatch = jest.fn();

jest.mock('@/store', () => ({
  store: { dispatch: (...args: unknown[]) => mockDispatch(...args) },
}));

jest.mock('@/store/slices/notification.slice', () => ({
  messageReceived: (payload: unknown) => ({ type: 'notification/messageReceived', payload }),
  setConnected:    (payload: unknown) => ({ type: 'notification/setConnected', payload }),
}));

jest.mock('@/store/api/notification.api', () => ({
  notificationApi: {
    util: {
      updateQueryData: jest.fn(
        (endpoint: string, arg: unknown, recipe: (draft: unknown) => unknown) =>
          ({ type: 'MOCK_PATCH', endpoint, arg, recipe }),
      ),
    },
  },
}));

import { notificationApi } from '@/store/api/notification.api';
const mockUpdateQueryData = notificationApi.util.updateQueryData as jest.Mock;

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

  test('patches the getUnreadCount cache (+1) for every live push, keeping the badge in sync', () => {
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

    expect(mockUpdateQueryData).toHaveBeenCalledWith('getUnreadCount', undefined, expect.any(Function));
    const recipe = mockUpdateQueryData.mock.calls[0]![2] as (draft: unknown) => unknown;
    expect(recipe(1)).toBe(2);
    // Guards against patching an unresolved (undefined) cache entry into NaN.
    expect(recipe(undefined)).toBeUndefined();
    // Guards against a non-finite cached value (e.g. already-corrupted NaN)
    // being incremented into another NaN.
    expect(recipe(NaN)).toBeNaN();
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
