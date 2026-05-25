import * as fc from 'fast-check';
import config from '../../../src/shared/config/env';

// ─── PBT: parsing invariants ──────────────────────────────────────────────────
describe('env config — PBT', () => {
  test('round-trip: PORT parseInt preserves valid port numbers', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 65535 }), (port) => {
        expect(parseInt(String(port), 10)).toBe(port);
      }),
      { numRuns: 200, seed: 42 },
    );
  });

  test('round-trip: CORS_ORIGINS join → split → trim → filter round-trips non-empty origins', () => {
    const origin = fc.constantFrom(
      'http://localhost:3001',
      'https://app.example.com',
      'http://localhost:4000',
      'https://admin.example.com',
    );
    fc.assert(
      fc.property(fc.array(origin, { minLength: 1, maxLength: 4 }), (list) => {
        const joined = list.join(',');
        const parsed = joined.split(',').map((s) => s.trim()).filter(Boolean);
        expect(parsed).toEqual(list);
      }),
      { numRuns: 100, seed: 42 },
    );
  });

  test('invariant: empty CORS_ORIGINS string produces empty array', () => {
    fc.assert(
      fc.property(fc.constant(''), (raw) => {
        const parsed = raw.split(',').map((s) => s.trim()).filter(Boolean);
        expect(parsed).toHaveLength(0);
      }),
      { numRuns: 10, seed: 42 },
    );
  });

  test('invariant: BCRYPT_ROUNDS parseInt always produces a positive integer for valid inputs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 31 }), (rounds) => {
        const parsed = parseInt(String(rounds), 10);
        expect(parsed).toBe(rounds);
        expect(parsed).toBeGreaterThan(0);
      }),
      { numRuns: 100, seed: 42 },
    );
  });
});

// ─── Example-based tests ──────────────────────────────────────────────────────
describe('env config — example-based', () => {
  test('config is frozen — top-level mutation throws in strict mode', () => {
    expect(() => {
      (config as Record<string, unknown>).port = 9999;
    }).toThrow();
  });

  test('port is parsed as a number from process.env.PORT', () => {
    expect(typeof config.port).toBe('number');
    expect(config.port).toBe(3001);
  });

  test('nodeEnv is test', () => {
    expect(config.nodeEnv).toBe('test');
  });

  test('bcryptRounds is 1 (test environment override for speed)', () => {
    expect(typeof config.bcryptRounds).toBe('number');
    expect(config.bcryptRounds).toBe(1);
  });

  test('corsOrigins is an array containing the configured origin', () => {
    expect(Array.isArray(config.corsOrigins)).toBe(true);
    expect(config.corsOrigins).toContain('http://localhost:3001');
  });

  test('smtp has all required string fields', () => {
    expect(typeof config.smtp.pass).toBe('string');
    expect(typeof config.smtp.from).toBe('string');
    expect(config.smtp.from.length).toBeGreaterThan(0);
  });

  test('aws has all required fields', () => {
    expect(typeof config.aws.region).toBe('string');
    expect(typeof config.aws.s3BucketName).toBe('string');
    expect(config.aws.region).toBe('us-east-1');
  });

  test('rateLimit.windowMs is a number', () => {
    expect(typeof config.rateLimit.windowMs).toBe('number');
    expect(config.rateLimit.windowMs).toBe(900000);
  });

  test('rateLimit.maxRequests is a number', () => {
    expect(typeof config.rateLimit.maxRequests).toBe('number');
    expect(config.rateLimit.maxRequests).toBe(1000);
  });

  test('CORS_ORIGINS whitespace padding is trimmed and empty entries filtered', () => {
    const raw    = ' http://localhost:3001 , http://localhost:3002 , ';
    const parsed = raw.split(',').map((s) => s.trim()).filter(Boolean);
    expect(parsed).toEqual(['http://localhost:3001', 'http://localhost:3002']);
  });

  test('jwtExpiry default is 1h from test setup', () => {
    expect(config.jwtExpiry).toBe('1h');
  });

  test('inviteJwtExpiry default is 48h', () => {
    expect(config.inviteJwtExpiry).toBe('48h');
  });
});
