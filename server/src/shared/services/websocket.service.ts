import http from 'http';
import { URL } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import config from '../config/env';
import { JWTPayload } from '../types/common.types';
import { isInDenylist } from '../middleware/token-denylist';

// TODO(scale): Replace with Redis pub/sub. See docs/scaling.md for migration guide.
// Current: in-memory connection registry, single-instance only.
const connections = new Map<string, WebSocket>();

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: http.Server): void {
  wss = new WebSocketServer({ noServer: true });

  // U6-A-02: JWT authentication on WebSocket upgrade via token query param
  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const token = url.searchParams.get('token');
      if (!token) throw new Error('missing token');
      if (isInDenylist(token)) throw new Error('token revoked');
      const payload = jwt.verify(token, config.jwtSecret) as JWTPayload;
      // Attach payload for the connection handler
      (req as http.IncomingMessage & { __wsPayload?: JWTPayload }).__wsPayload = payload;
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit('connection', ws, req);
    });
  });

  // U6-A-03: Register connection and wire up close/error cleanup
  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const payload = (req as http.IncomingMessage & { __wsPayload?: JWTPayload }).__wsPayload!;
    registerConnection(payload.userId, ws);
    ws.on('close', () => removeConnection(payload.userId));
    ws.on('error', () => removeConnection(payload.userId));
    ws.send(JSON.stringify({ type: 'connected', userId: payload.userId }));

    console.log(JSON.stringify({
      level:     'info',
      event:     'ws_connected',
      userId:    payload.userId,
      timestamp: new Date().toISOString(),
    }));
  });

  console.log(JSON.stringify({
    level:     'info',
    event:     'websocket_server_initialized',
    timestamp: new Date().toISOString(),
  }));
}

// U6-A-03: Replace any existing open connection for the same userId
export function registerConnection(userId: string, ws: WebSocket): void {
  const existing = connections.get(userId);
  if (existing && existing.readyState === WebSocket.OPEN) {
    existing.close(1000, 'Replaced by new connection');
  }
  connections.set(userId, ws);
}

// U6-A-03: Remove user's connection from registry
export function removeConnection(userId: string): void {
  connections.delete(userId);
}

// U6-A-03: Push a JSON payload to a connected user; silently skips if offline
export function pushToUser(userId: string, payload: object): void {
  const ws = connections.get(userId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error(JSON.stringify({
      level:     'error',
      event:     'ws_push_failed',
      userId,
      message:   (err as Error).message,
      timestamp: new Date().toISOString(),
    }));
    removeConnection(userId);
  }
}

export { wss };
