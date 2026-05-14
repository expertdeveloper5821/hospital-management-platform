import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';

// TODO(scale): Replace with Redis WebSocketService. See docs/scaling.md for migration guide.
// Current: in-memory connection registry, single-instance only.
// Full implementation (JWT auth on upgrade, real delivery) deferred to Unit 6.

let wss: WebSocketServer | null = null;

/**
 * Initialize the WebSocket server attached to the HTTP server.
 * WS-01/02: Creates ws.WebSocketServer; stores instance for later use.
 */
export function initWebSocketServer(server: http.Server): void {
  wss = new WebSocketServer({ server });
  console.log(JSON.stringify({
    level:     'info',
    event:     'websocket_server_initialized',
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Register a WebSocket connection for a user.
 * WS-03: No-op stub — Unit 6 implements the connection registry.
 */
export function registerConnection(_userId: string, _ws: WebSocket): void {
  console.log(JSON.stringify({
    level:  'debug',
    event:  'ws_stub_register_connection',
    userId: _userId,
    note:   'stub — full implementation in Unit 6',
  }));
}

/**
 * Remove a WebSocket connection for a user.
 * WS-04: No-op stub — Unit 6 implements.
 */
export function removeConnection(_userId: string): void {
  console.log(JSON.stringify({
    level:  'debug',
    event:  'ws_stub_remove_connection',
    userId: _userId,
    note:   'stub — full implementation in Unit 6',
  }));
}

/**
 * Push a notification payload to a specific user.
 * WS-05/06: No-op stub with debug log — Unit 6 implements real delivery.
 */
export function pushToUser(_userId: string, _payload: object): void {
  console.log(JSON.stringify({
    level:  'debug',
    event:  'ws_stub_push_to_user',
    userId: _userId,
    note:   'stub — full implementation in Unit 6',
  }));
}

export { wss };
