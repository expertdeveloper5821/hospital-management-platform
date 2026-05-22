import { Request, Response, NextFunction } from 'express';
import { generateId } from '../utils/index';
import { requestContext } from '../config/request-context';

/**
 * Structured request logger with correlation ID and AsyncLocalStorage context.
 * LOG-01..06: Generate correlationId → attach to req + response header →
 *             run AsyncLocalStorage context → log on response finish.
 * SECURITY-03: Logs structured JSON; never logs body, query params, or auth headers.
 * Log levels: info (2xx/3xx), warn (4xx), error (5xx).
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const correlationId = generateId();
  const startMs       = Date.now();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  // Run the rest of the request inside AsyncLocalStorage context
  // so correlationId is available anywhere in the call stack
  requestContext.run(
    {
      correlationId,
      userId:   req.user?.userId,
      tenantId: req.user?.tenantId ?? undefined,
    },
    () => {
      res.on('finish', () => {
        const responseTimeMs = Date.now() - startMs;
        const status         = res.statusCode;
        const level          = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

        const entry: Record<string, unknown> = {
          level,
          correlationId,
          method:        req.method,
          url:           req.url,
          statusCode:    status,
          responseTimeMs,
          timestamp:     new Date().toISOString(),
        };

        // Include user context when available (set after authenticateJWT runs)
        if (req.user?.userId)   entry.userId   = req.user.userId;
        if (req.user?.tenantId) entry.tenantId = req.user.tenantId;

        // Warn if middleware overhead exceeds 25ms budget (before route handler)
        if (responseTimeMs > 25 && !entry.userId) {
          entry.event = 'middleware_budget_exceeded';
        }

        const logFn = level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : console.log;

        logFn(JSON.stringify(entry));
      });

      next();
    },
  );
}
