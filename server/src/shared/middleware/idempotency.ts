import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from './error-handler';
import { idempotencyService } from '../../modules/idempotency/idempotency.service';

const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Optional per-route replay guard for offline-sync retries. A client only
 * sends the `Idempotency-Key` header when replaying a queued mutation after
 * a network failure of uncertain outcome (see the offline-sync outbox) — a
 * normal online request omits it and this middleware is a no-op passthrough.
 *
 * `routeKey` is a stable, explicit label per call site (not derived from
 * `req.route`) so the same guard function works identically regardless of
 * how/where it's mounted.
 */
export function idempotencyGuard(routeKey: string) {
  return function idempotency(req: Request, res: Response, next: NextFunction): void {
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      next();
      return;
    }

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      next(new UnauthorizedError('Tenant context missing'));
      return;
    }

    const requestHash = idempotencyService.hashRequestBody(req.body);

    idempotencyService
      .checkReplay(tenantId, idempotencyKey, routeKey, requestHash)
      .then((replay) => {
        if (replay) {
          res.status(replay.responseStatus).json(replay.responseBody);
          return;
        }

        // Capture whatever the handler eventually sends so a retry with the
        // same key can be answered without re-running the handler.
        const originalJson = res.json.bind(res);
        res.json = ((body: unknown) => {
          if (res.statusCode < 400) {
            idempotencyService
              .record(tenantId, idempotencyKey, routeKey, requestHash, res.statusCode, body)
              .catch((err: { code?: number }) => {
                if (err?.code !== DUPLICATE_KEY_ERROR_CODE) {
                  console.error('Failed to persist idempotency record', err);
                }
              });
          }
          return originalJson(body);
        }) as typeof res.json;

        next();
      })
      .catch(next);
  };
}
