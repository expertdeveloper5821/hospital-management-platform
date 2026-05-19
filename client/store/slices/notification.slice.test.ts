import notificationReducer, {
  messageReceived,
  markAllRead,
  markRead,
  setConnected,
  clearNotifications,
} from './notification.slice';
import type { NotificationMessage } from '../types';

const msg1: NotificationMessage = {
  id:        'n-1',
  message:   'Lab report ready',
  type:      'LAB_REPORT',
  timestamp: '2026-05-19T10:00:00Z',
  read:      false,
};

const msg2: NotificationMessage = {
  id:        'n-2',
  message:   'Low stock alert',
  type:      'INVENTORY_ALERT',
  timestamp: '2026-05-19T11:00:00Z',
  read:      false,
};

describe('notificationSlice reducers', () => {
  it('starts empty and disconnected', () => {
    const state = notificationReducer(undefined, { type: '@@INIT' });
    expect(state.messages).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
    expect(state.connected).toBe(false);
  });

  it('messageReceived — prepends message and increments unreadCount', () => {
    let state = notificationReducer(undefined, messageReceived(msg1));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe('n-1');
    expect(state.unreadCount).toBe(1);

    state = notificationReducer(state, messageReceived(msg2));
    expect(state.messages).toHaveLength(2);
    // most recent is first
    expect(state.messages[0].id).toBe('n-2');
    expect(state.unreadCount).toBe(2);
  });

  it('markAllRead — marks all messages read and resets unreadCount to 0', () => {
    let state = notificationReducer(undefined, messageReceived(msg1));
    state     = notificationReducer(state, messageReceived(msg2));
    state     = notificationReducer(state, markAllRead());
    expect(state.unreadCount).toBe(0);
    expect(state.messages.every((m) => m.read)).toBe(true);
  });

  it('markRead — marks a single message read and decrements unreadCount', () => {
    let state = notificationReducer(undefined, messageReceived(msg1));
    state     = notificationReducer(state, messageReceived(msg2));
    state     = notificationReducer(state, markRead('n-1'));
    expect(state.unreadCount).toBe(1);
    const n1 = state.messages.find((m) => m.id === 'n-1');
    const n2 = state.messages.find((m) => m.id === 'n-2');
    expect(n1?.read).toBe(true);
    expect(n2?.read).toBe(false);
  });

  it('markRead — no-op for already-read message (unreadCount does not go below 0)', () => {
    let state = notificationReducer(undefined, messageReceived(msg1));
    state     = notificationReducer(state, markAllRead());
    state     = notificationReducer(state, markRead('n-1')); // already read
    expect(state.unreadCount).toBe(0);
  });

  it('setConnected — updates connected flag', () => {
    let state = notificationReducer(undefined, setConnected(true));
    expect(state.connected).toBe(true);
    state     = notificationReducer(state, setConnected(false));
    expect(state.connected).toBe(false);
  });

  it('clearNotifications — resets all notification state', () => {
    let state = notificationReducer(undefined, messageReceived(msg1));
    state     = notificationReducer(state, setConnected(true));
    state     = notificationReducer(state, clearNotifications());
    expect(state.messages).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
    expect(state.connected).toBe(false);
  });
});
