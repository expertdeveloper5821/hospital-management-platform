jest.mock('../../../src/modules/idempotency/idempotency.repository');

import { idempotencyRepository } from '../../../src/modules/idempotency/idempotency.repository';
import { IdempotencyService } from '../../../src/modules/idempotency/idempotency.service';
import { ConflictError } from '../../../src/shared/middleware/error-handler';

const mockRepo = idempotencyRepository as jest.Mocked<typeof idempotencyRepository>;

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IdempotencyService();
  });

  describe('hashRequestBody', () => {
    test('is deterministic for the same body', () => {
      const body = { a: 1, b: 'two' };
      expect(service.hashRequestBody(body)).toBe(service.hashRequestBody(body));
    });

    test('differs for different bodies', () => {
      expect(service.hashRequestBody({ a: 1 })).not.toBe(service.hashRequestBody({ a: 2 }));
    });

    test('handles undefined/empty bodies without throwing', () => {
      expect(() => service.hashRequestBody(undefined)).not.toThrow();
    });
  });

  describe('checkReplay', () => {
    test('returns null when the key has not been seen before', async () => {
      mockRepo.findByKey.mockResolvedValue(null);

      const result = await service.checkReplay('t1', 'key-1', 'patient.create', 'hash-1');

      expect(result).toBeNull();
    });

    test('returns the stored response when route and body hash match', async () => {
      mockRepo.findByKey.mockResolvedValue({
        routeKey: 'patient.create',
        requestHash: 'hash-1',
        responseStatus: 201,
        responseBody: { status: 'success', data: { patientId: 'PAT-abc' } },
      } as never);

      const result = await service.checkReplay('t1', 'key-1', 'patient.create', 'hash-1');

      expect(result).toEqual({
        responseStatus: 201,
        responseBody: { status: 'success', data: { patientId: 'PAT-abc' } },
      });
    });

    test('throws ConflictError when the same key is replayed with a different body', async () => {
      mockRepo.findByKey.mockResolvedValue({
        routeKey: 'patient.create',
        requestHash: 'hash-1',
        responseStatus: 201,
        responseBody: {},
      } as never);

      await expect(
        service.checkReplay('t1', 'key-1', 'patient.create', 'hash-2'),
      ).rejects.toThrow(ConflictError);
    });

    test('throws ConflictError when the same key is replayed against a different route', async () => {
      mockRepo.findByKey.mockResolvedValue({
        routeKey: 'patient.create',
        requestHash: 'hash-1',
        responseStatus: 201,
        responseBody: {},
      } as never);

      await expect(
        service.checkReplay('t1', 'key-1', 'patient.update', 'hash-1'),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('record', () => {
    test('saves the response against the tenant-scoped key', async () => {
      mockRepo.save.mockResolvedValue({} as never);

      await service.record('t1', 'key-1', 'patient.create', 'hash-1', 201, { status: 'success' });

      expect(mockRepo.save).toHaveBeenCalledWith({
        tenantId:       't1',
        idempotencyKey: 'key-1',
        routeKey:       'patient.create',
        requestHash:    'hash-1',
        responseStatus: 201,
        responseBody:   { status: 'success' },
      });
    });
  });
});
