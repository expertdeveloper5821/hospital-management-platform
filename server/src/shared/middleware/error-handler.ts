import { Request, Response, NextFunction } from 'express';
import config from '../config/env';

// ─── AppError Hierarchy ───────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public override message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable — please retry shortly') {
    super(message, 503);
    this.name = 'ServiceUnavailableError';
  }
}

// ─── Mongoose / Mongo error names that map to 503 ────────────────────────────
const MONGO_NETWORK_ERRORS = new Set([
  'MongoNetworkError',
  'MongoServerSelectionError',
  'MongoTimeoutError',
]);

// ─── Global Express Error Handler ────────────────────────────────────────────
// Must be registered as the LAST middleware in app.ts (4-argument signature).
// SECURITY-09: Production responses never expose stack traces or internal details.
// SECURITY-15: All errors are caught here; fail-closed behavior enforced.
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Always log the full error for ops visibility (SECURITY-03)
  console.error(JSON.stringify({
    level:     'error',
    event:     'unhandled_error',
    name:      err.name,
    message:   err.message,
    stack:     err.stack,
    timestamp: new Date().toISOString(),
  }));

  let statusCode = 500;
  let message    = 'An unexpected error occurred';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message    = err.message;
  } else if (MONGO_NETWORK_ERRORS.has(err.name)) {
    statusCode = 503;
    message    = 'Database temporarily unavailable — please retry shortly';
  } else if (err.name === 'ValidationError') {
    // Mongoose schema validation error
    statusCode = 400;
    message    = err.message;
  }

  if (config.nodeEnv === 'production') {
    res.status(statusCode).json({ status: 'error', message });
  } else {
    res.status(statusCode).json({
      status:  'error',
      message,
      details: { stack: err.stack },
    });
  }
}
