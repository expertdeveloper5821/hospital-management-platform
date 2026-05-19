/**
 * WebSocket client for real-time notifications.
 * Backend endpoint: WS /ws (JWT validated inside upgrade handler via query param).
 * Dispatches received messages to notificationSlice.
 */

import { store } from '@/store';
import { messageReceived, setConnected } from '@/store/slices/notification.slice';
import type { NotificationMessage } from '@/store/types';

const WS_BASE = (process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:5000').replace(/\/$/, '');

const RECONNECT_DELAY_MS  = 3_000;
const MAX_RECONNECT_TRIES = 5;

class WebSocketClient {
  private socket:       WebSocket | null   = null;
  private token:        string | null      = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose  = false;

  connect(token: string) {
    this.token             = token;
    this.intentionalClose  = false;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  disconnect() {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close(1000, 'User logout');
      this.socket = null;
    }
    store.dispatch(setConnected(false));
  }

  private openSocket() {
    if (!this.token) return;

    // JWT is sent as a query parameter — backend validates it during WS upgrade
    const url = `${WS_BASE}/ws?token=${encodeURIComponent(this.token)}`;

    try {
      this.socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      store.dispatch(setConnected(true));
    };

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as NotificationMessage;
        store.dispatch(messageReceived(payload));
      } catch {
        // Ignore malformed frames
      }
    };

    this.socket.onclose = (event: CloseEvent) => {
      store.dispatch(setConnected(false));
      if (!this.intentionalClose && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = () => {
      // onclose fires after onerror — reconnect handled there
    };
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_TRIES) return;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts += 1;
      this.openSocket();
    }, RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// Singleton — one WS connection per browser session
export const wsClient = new WebSocketClient();
