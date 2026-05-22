import * as fc from 'fast-check';
import { addToDenylist, isInDenylist, clearDenylist } from '../../../src/shared/middleware/token-denylist';

beforeEach(() => clearDenylist());

// ─── PBT: Invariant — expired tokens always return false ─────────────────────
describe('token-denylist — PBT', () => {
  test('invariant: token added with 0ms expiry is immediately not in denylist', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 10, maxLength: 200 }), (token) => {
        addToDenylist(token, 0);
        // After 0ms expiry, should be treated as expired
        expect(isInDenylist(token)).toBe(false);
      }),
      { numRuns: 100, seed: 42 },
    );
  });

  test('invariant: token with future expiry is always in denylist', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 200 }),
        fc.integer({ min: 60_000, max: 3_600_000 }),
        (token, expiryMs) => {
          clearDenylist();
          addToDenylist(token, expiryMs);
          expect(isInDenylist(token)).toBe(true);
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });
});

// ─── Example-based tests ──────────────────────────────────────────────────────
describe('token-denylist — example-based', () => {
  test('token not in denylist by default', () => {
    expect(isInDenylist('some-token')).toBe(false);
  });

  test('token added with future expiry is in denylist', () => {
    addToDenylist('my-token', 60_000);
    expect(isInDenylist('my-token')).toBe(true);
  });

  test('different tokens are independent', () => {
    addToDenylist('token-a', 60_000);
    expect(isInDenylist('token-b')).toBe(false);
  });

  test('clearDenylist removes all entries', () => {
    addToDenylist('token-x', 60_000);
    clearDenylist();
    expect(isInDenylist('token-x')).toBe(false);
  });
});
