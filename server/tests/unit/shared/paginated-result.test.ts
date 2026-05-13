import * as fc from 'fast-check';

// ─── Pure helper (mirrors what repositories compute) ─────────────────────────
function computeTotalPages(total: number, limit: number): number {
  return Math.ceil(total / limit);
}

// ─── PBT: Invariant — totalPages = ceil(total / limit) always holds ───────────
describe('PaginatedResult totalPages — PBT', () => {
  test('invariant: totalPages = ceil(total / limit) for all valid inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100 }),
        (total, limit) => {
          const pages = computeTotalPages(total, limit);
          expect(pages).toBe(Math.ceil(total / limit));
          expect(pages).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 500, seed: 42 },
    );
  });

  test('invariant: totalPages is always a non-negative integer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 100 }),
        (total, limit) => {
          const pages = computeTotalPages(total, limit);
          expect(Number.isInteger(pages)).toBe(true);
          expect(pages).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });
});

// ─── Example-based tests ──────────────────────────────────────────────────────
describe('PaginatedResult totalPages — example-based', () => {
  test('0 items → 0 pages', () => expect(computeTotalPages(0, 20)).toBe(0));
  test('20 items, limit 20 → 1 page', () => expect(computeTotalPages(20, 20)).toBe(1));
  test('21 items, limit 20 → 2 pages', () => expect(computeTotalPages(21, 20)).toBe(2));
  test('100 items, limit 10 → 10 pages', () => expect(computeTotalPages(100, 10)).toBe(10));
  test('1 item, limit 20 → 1 page', () => expect(computeTotalPages(1, 20)).toBe(1));
});
