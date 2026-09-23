import crypto from 'crypto';
import { idempotencyRepository } from './idempotency.repository';
import { ConflictError } from '../../shared/middleware/error-handler';
import { IdempotencyReplay } from './idempotency.types';

export class IdempotencyService {
  hashRequestBody(body: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
  }

  /**
   * Returns the stored response for a previously-seen (tenantId, idempotencyKey)
   * pair, or null if this key hasn't been used yet. Throws ConflictError if the
   * same key is reused with a different route or request body — that's a client
   * bug (reusing a clientOpId), not a safe retry.
   */
  async checkReplay(
    tenantId: string,
    idempotencyKey: string,
    routeKey: string,
    requestHash: string,
  ): Promise<IdempotencyReplay | null> {
    const existing = await idempotencyRepository.findByKey(tenantId, idempotencyKey);
    if (!existing) return null;

    if (existing.routeKey !== routeKey || existing.requestHash !== requestHash) {
      throw new ConflictError('Idempotency-Key was already used with a different request');
    }

    return { responseStatus: existing.responseStatus, responseBody: existing.responseBody };
  }

  async record(
    tenantId: string,
    idempotencyKey: string,
    routeKey: string,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await idempotencyRepository.save({
      tenantId,
      idempotencyKey,
      routeKey,
      requestHash,
      responseStatus,
      responseBody,
    });
  }
}

export const idempotencyService = new IdempotencyService();
