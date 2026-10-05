import { serialNumber, serialOffset } from './serial-number';

describe('serialOffset / serialNumber', () => {
  test('page 1 starts at 1', () => {
    const offset = serialOffset({ page: 1, limit: 10 }, 1, 10);
    expect([0, 1, 2].map((i) => serialNumber(offset, i))).toEqual([1, 2, 3]);
  });

  test('later pages continue from the page offset', () => {
    const offset = serialOffset({ page: 3, limit: 20 }, 3, 20);
    expect(serialNumber(offset, 0)).toBe(41);
    expect(serialNumber(offset, 19)).toBe(60);
  });

  test("prefers the response's page/limit over local state (offline cache answers page 1)", () => {
    const offset = serialOffset({ page: 1, limit: 37 }, 4, 10);
    expect(serialNumber(offset, 0)).toBe(1);
  });

  test('falls back to local page/limit while the response is not loaded', () => {
    expect(serialOffset(undefined, 2, 10)).toBe(10);
    expect(serialOffset({}, 2, 10)).toBe(10);
  });

  test('degenerate input never yields a negative or NaN offset', () => {
    expect(serialOffset({ page: 0, limit: 10 }, 1, 10)).toBe(0);
    expect(serialOffset({ page: 1, limit: 0 }, 1, 10)).toBe(0);
    expect(serialOffset(undefined, Number.NaN, 10)).toBe(0);
  });
});
