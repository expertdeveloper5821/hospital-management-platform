import * as fc from 'fast-check';

// ─── Pure business logic extracted for PBT (no DB/service calls needed) ──────

/**
 * Applies a sequence of stock changes to an initial quantity.
 * Returns the final quantity, or throws if any step would make stock negative.
 * Mirrors the invariant enforced by InventoryService.updateStock.
 */
function applyStockChanges(initial: number, changes: number[]): number {
  let qty = initial;
  for (const change of changes) {
    const next = qty + change;
    if (next < 0) throw new Error(`Stock cannot go negative: ${qty} + ${change} = ${next}`);
    qty = next;
  }
  return qty;
}

/**
 * Returns true when the item is in a low-stock state.
 * Mirrors InventoryItemResponse.isLowStock computation.
 */
function isLowStock(quantity: number, threshold: number): boolean {
  return threshold > 0 && quantity < threshold;
}

// ─── PBT: Stock invariants ────────────────────────────────────────────────────

describe('Inventory — PBT: stock quantity invariants', () => {
  test('stock never goes negative after any sequence of valid operations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),         // initial quantity
        fc.array(fc.integer({ min: -500, max: 500 }), { minLength: 0, maxLength: 50 }),
        (initial, rawChanges) => {
          // Filter the change sequence so that every step is valid (no negative stock)
          const validChanges: number[] = [];
          let running = initial;
          for (const c of rawChanges) {
            if (running + c >= 0) {
              validChanges.push(c);
              running += c;
            }
          }

          const final = applyStockChanges(initial, validChanges);
          expect(final).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200, seed: 42 },
    );
  });

  test('applying the complement of all withdrawals restores original quantity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10_000 }),        // initial (large enough to allow withdrawals)
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 20 }),
        (initial, withdrawals) => {
          const totalWithdrawn = withdrawals.reduce((a, b) => a + b, 0);

          if (initial < totalWithdrawn) return; // skip invalid scenarios

          const afterWithdrawals = applyStockChanges(initial, withdrawals.map((w) => -w));
          const afterRestock     = applyStockChanges(afterWithdrawals, [totalWithdrawn]);

          expect(afterRestock).toBe(initial);
        },
      ),
      { numRuns: 200, seed: 99 },
    );
  });

  test('invalid change that would make stock negative is always rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 2000 }),
        (quantity, overdraw) => {
          const change = -(quantity + overdraw); // guaranteed to go negative

          expect(() => applyStockChanges(quantity, [change])).toThrow();
        },
      ),
      { numRuns: 200, seed: 7 },
    );
  });

  test('low-stock flag is consistent with quantity and threshold relationship', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),   // quantity
        fc.integer({ min: 0, max: 1_000 }),    // threshold
        (quantity, threshold) => {
          const flag = isLowStock(quantity, threshold);
          if (threshold === 0) {
            expect(flag).toBe(false);           // threshold=0 means monitoring disabled
          } else if (quantity < threshold) {
            expect(flag).toBe(true);
          } else {
            expect(flag).toBe(false);
          }
        },
      ),
      { numRuns: 500, seed: 13 },
    );
  });

  test('stock after n identical additions equals initial + n × amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000 }),           // initial
        fc.integer({ min: 1, max: 100 }),              // amount per addition
        fc.integer({ min: 1, max: 50 }),               // number of additions
        (initial, amount, times) => {
          const changes = Array(times).fill(amount);
          const result  = applyStockChanges(initial, changes);
          expect(result).toBe(initial + amount * times);
        },
      ),
      { numRuns: 200, seed: 55 },
    );
  });
});
