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
