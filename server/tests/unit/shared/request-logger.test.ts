import * as fc from 'fast-check';
import { generateId } from '../../../src/shared/utils/index';

// ─── PBT: Invariant — all generated correlationIds are unique ─────────────────
describe('requestLogger / generateId — PBT', () => {
  test('invariant: N generated IDs are all unique', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 500 }), (n) => {
        const ids = Array.from({ length: n }, () => generateId());
        const unique = new Set(ids);
        expect(unique.size).toBe(n);
      }),
      { numRuns: 50, seed: 42 },
    );
  });

  test('invariant: generated ID is a valid UUID v4 format', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const id = generateId();
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      }),
      { numRuns: 100, seed: 42 },
    );
  });
});

// ─── Example-based tests ──────────────────────────────────────────────────────
describe('generateId — example-based', () => {
  test('returns a non-empty string', () => {
    expect(generateId()).toBeTruthy();
  });

  test('two consecutive calls return different IDs', () => {
    expect(generateId()).not.toBe(generateId());
  });
});

// ─── Sensitive URL redaction ──────────────────────────────────────────────────
import { loggableUrl } from '../../../src/shared/middleware/request-logger';

describe('loggableUrl', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

  test.each([
    `/api/public/staff-verification/${token}`,
    `/api/public/staff-verification/${token}?utm=x`,
    `/API/PUBLIC/STAFF-VERIFICATION/${token}`,
    `/api/public/staff-verification?token=${token}`,
  ])('redacts staff verification token in %s', (originalUrl) => {
    // Inside the mounted router req.url has the prefix stripped — originalUrl drives the match.
    const out = loggableUrl({ originalUrl, url: `/${token}` });
    expect(out).toBe('/api/public/staff-verification/[REDACTED]');
    expect(out).not.toContain(token);
  });

  test('leaves other URLs untouched', () => {
    expect(loggableUrl({ originalUrl: '/api/patients?page=2', url: '/api/patients?page=2' }))
      .toBe('/api/patients?page=2');
    expect(loggableUrl({ originalUrl: '/api/public/staff-verification-other', url: '/x' })).toBe('/x');
  });
});
