import http from 'http';
import mongoose from 'mongoose';
import app from './app';
import config from './shared/config/env';
import { connectDatabase, disconnectDatabase } from './shared/config/database';
import { initWebSocketServer } from './shared/services/websocket.service';

let httpServer: http.Server;

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function gracefulShutdown(signal: string, error?: Error): Promise<void> {
  const isUnexpected = !!error;

  console.error(JSON.stringify({
    level:     isUnexpected ? 'error' : 'info',
    event:     'process_shutdown',
    signal,
    message:   error?.message,
    stack:     error?.stack,
    timestamp: new Date().toISOString(),
  }));

  // Force exit after 10 seconds if graceful shutdown hangs (SRV-05)
  const forceExit = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exit(isUnexpected ? 1 : 0);
  } catch {
    process.exit(1);
  }
}

// ─── Unhandled errors — fail closed (SECURITY-15) ────────────────────────────
process.on('unhandledRejection', (reason) => {
  gracefulShutdown(
    'unhandledRejection',
    reason instanceof Error ? reason : new Error(String(reason)),
  );
});

process.on('uncaughtException', (error) => {
  gracefulShutdown('uncaughtException', error);
});

// ─── Normal shutdown signals ──────────────────────────────────────────────────
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ─── Startup sequence (SRV-01..04) ───────────────────────────────────────────
async function start(): Promise<void> {
  // 1. Connect to MongoDB before accepting requests (SRV-01)
  await connectDatabase();

  // 2. Start HTTP server
  httpServer = http.createServer(app);
  httpServer.listen(config.port, () => {
    console.log(JSON.stringify({
      level:     'info',
      event:     'server_started',
      port:      config.port,
      nodeEnv:   config.nodeEnv,
      timestamp: new Date().toISOString(),
    }));
  });

  // 3. Attach WebSocket server (SRV-02)
  initWebSocketServer(httpServer);
}

start().catch((err) => {
  console.error(JSON.stringify({
    level:     'error',
    event:     'startup_failure',
    message:   err.message,
    stack:     err.stack,
    timestamp: new Date().toISOString(),
  }));
  process.exit(1);
});
