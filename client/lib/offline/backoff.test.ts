import { computeBackoffDelayMs } from './backoff';

describe('computeBackoffDelayMs', () => {
  test('follows the 5s / 15s / 45s / 2m / 5m schedule', () => {
    expect(computeBackoffDelayMs(0)).toBe(5_000);
    expect(computeBackoffDelayMs(1)).toBe(15_000);
    expect(computeBackoffDelayMs(2)).toBe(45_000);
    expect(computeBackoffDelayMs(3)).toBe(120_000);
    expect(computeBackoffDelayMs(4)).toBe(300_000);
  });

  test('caps at 5 minutes for any further attempts', () => {
    expect(computeBackoffDelayMs(5)).toBe(300_000);
    expect(computeBackoffDelayMs(50)).toBe(300_000);
  });
});
