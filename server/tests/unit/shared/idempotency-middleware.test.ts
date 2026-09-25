import { Request, Response } from 'express';

jest.mock('../../../src/modules/idempotency/idempotency.service', () => ({
  idempotencyService: {
    hashRequestBody: jest.fn().mockReturnValue('hash-1'),
    checkReplay:      jest.fn(),
    record:           jest.fn().mockResolvedValue(undefined),
  },
}));

import { idempotencyGuard } from '../../../src/shared/middleware/idempotency';
import { idempotencyService } from '../../../src/modules/idempotency/idempotency.service';
import { UnauthorizedError } from '../../../src/shared/middleware/error-handler';

const mockService = idempotencyService as jest.Mocked<typeof idempotencyService>;

function makeReq(overrides: Partial<{ header: string | undefined; tenantId: string | null }> = {}) {
  return {
    header: jest.fn().mockReturnValue(overrides.header),
    body:   { foo: 'bar' },
    user:   { tenantId: overrides.tenantId ?? 't1' },
  } as unknown as Request;
}

function makeRes() {
  const res: Partial<Response> & { statusCode: number } = {
    statusCode: 200,
    json: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: Response, code: number) {
      (res as { statusCode: number }).statusCode = code;
      return res as Response;
    }) as unknown as Response['status'],
  };
  return res as Response & { statusCode: number };
}

describe('idempotencyGuard', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes through untouched when no Idempotency-Key header is sent', async () => {
    const req = makeReq({ header: undefined });
    const res = makeRes();
    const next = jest.fn();

    idempotencyGuard('patient.create')(req, res, next);
    await flush();

    expect(next).toHaveBeenCalledWith();
    expect(mockService.checkReplay).not.toHaveBeenCalled();
  });

  test('rejects with UnauthorizedError when tenant context is missing', async () => {
    const req = makeReq({ header: 'key-1', tenantId: undefined as unknown as string });
    (req as unknown as { user: { tenantId: string | null } }).user.tenantId = null;
    const res = makeRes();
    const next = jest.fn();

    idempotencyGuard('patient.create')(req, res, next);
    await flush();

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  test('replays the stored response and skips the handler on a known key', async () => {
    mockService.checkReplay.mockResolvedValue({
      responseStatus: 201,
      responseBody:   { status: 'success', data: { patientId: 'PAT-abc' } },
    });
    const req = makeReq({ header: 'key-1' });
    const res = makeRes();
    const next = jest.fn();

    idempotencyGuard('patient.create')(req, res, next);
    await flush();

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ status: 'success', data: { patientId: 'PAT-abc' } });
    expect(next).not.toHaveBeenCalled();
  });

  test('lets a new key through and records the eventual successful response', async () => {
    mockService.checkReplay.mockResolvedValue(null);
    const req = makeReq({ header: 'key-1' });
    const res = makeRes();
    const next = jest.fn();

    idempotencyGuard('patient.create')(req, res, next);
    await flush();

    expect(next).toHaveBeenCalledWith();

    // Simulate the controller eventually sending its response.
    res.statusCode = 201;
    res.json({ status: 'success', data: { patientId: 'PAT-abc' } });
    await flush();

    expect(mockService.record).toHaveBeenCalledWith(
      't1', 'key-1', 'patient.create', 'hash-1', 201, { status: 'success', data: { patientId: 'PAT-abc' } },
    );
  });

  test('does not record an error response', async () => {
    mockService.checkReplay.mockResolvedValue(null);
    const req = makeReq({ header: 'key-1' });
    const res = makeRes();
    const next = jest.fn();

    idempotencyGuard('patient.create')(req, res, next);
    await flush();

    res.statusCode = 422;
    res.json({ status: 'error', message: 'Validation failed' });
    await flush();

    expect(mockService.record).not.toHaveBeenCalled();
  });

  test('forwards a checkReplay rejection (e.g. ConflictError) to next', async () => {
    const err = new Error('conflict');
    mockService.checkReplay.mockRejectedValue(err);
    const req = makeReq({ header: 'key-1' });
    const res = makeRes();
    const next = jest.fn();

    idempotencyGuard('patient.create')(req, res, next);
    await flush();

    expect(next).toHaveBeenCalledWith(err);
  });
});

// Middleware kicks off an async chain (checkReplay is a Promise) before calling
// next()/res.json() — flushing microtasks lets that chain settle before assertions.
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
