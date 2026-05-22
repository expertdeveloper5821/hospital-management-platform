import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { NotificationMessage } from '../types';

interface NotificationState {
  messages:    NotificationMessage[];
  unreadCount: number;
  connected:   boolean;
}

const initialState: NotificationState = {
  messages:    [],
  unreadCount: 0,
  connected:   false,
};

const notificationSlice = createSlice({
  name: 'notification',
  initialState,
  reducers: {
    messageReceived(state, action: PayloadAction<NotificationMessage>) {
      state.messages.unshift(action.payload);
      state.unreadCount += 1;
    },
    markAllRead(state) {
      state.messages.forEach((m) => { m.read = true; });
      state.unreadCount = 0;
    },
    markRead(state, action: PayloadAction<string>) {
      const msg = state.messages.find((m) => m.id === action.payload);
      if (msg && !msg.read) {
        msg.read = true;
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      }
    },
    setConnected(state, action: PayloadAction<boolean>) {
      state.connected = action.payload;
    },
    clearNotifications(state) {
      state.messages    = [];
      state.unreadCount = 0;
      state.connected   = false;
    },
  },
});

export const {
  messageReceived,
  markAllRead,
  markRead,
  setConnected,
  clearNotifications,
} = notificationSlice.actions;

export default notificationSlice.reducer;
