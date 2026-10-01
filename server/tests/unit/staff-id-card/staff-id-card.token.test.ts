import crypto from 'crypto';
import {
  generateVerificationToken,
  hashVerificationToken,
  isWellFormedVerificationToken,
  resolveStaffVerifyBaseUrl,
  buildVerificationUrl,
  STAFF_VERIFY_PATH,
} from '../../../src/modules/staff-id-card/staff-id-card.token';

describe('generateVerificationToken', () => {
  test('uses crypto.randomBytes(32)', () => {
    const spy = jest.spyOn(crypto, 'randomBytes');
    generateVerificationToken();
    expect(spy).toHaveBeenCalledWith(32);
    spy.mockRestore();
  });

  test('is 43-char base64url (256 bits) and well-formed', () => {
    const token = generateVerificationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(isWellFormedVerificationToken(token)).toBe(true);
  });

  test('1000 tokens are all unique', () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateVerificationToken));
    expect(tokens.size).toBe(1000);
  });
});

describe('hashVerificationToken', () => {
  test('is SHA-256 hex, deterministic, and never equals the token', () => {
    const token = generateVerificationToken();
    const hash  = hashVerificationToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(hashVerificationToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  test('different tokens hash differently', () => {
    expect(hashVerificationToken(generateVerificationToken()))
      .not.toBe(hashVerificationToken(generateVerificationToken()));
  });
});

describe('isWellFormedVerificationToken', () => {
  test.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(44)],
    ['bad chars', `${'a'.repeat(42)}+`],
    ['mongo ObjectId', '507f1f77bcf86cd799439011'],
    ['NoSQL operator string', '{"$ne":null}'],
  ])('rejects %s', (_label, value) => {
    expect(isWellFormedVerificationToken(value)).toBe(false);
  });

  test.each([[undefined], [null], [42], [{ $ne: null }], [['x']]])('rejects non-string %p', (value) => {
    expect(isWellFormedVerificationToken(value)).toBe(false);
  });
});

describe('resolveStaffVerifyBaseUrl', () => {
  test('returns null when unset — generation must fail closed', () => {
    expect(resolveStaffVerifyBaseUrl('', 'development')).toBeNull();
    expect(resolveStaffVerifyBaseUrl('   ', 'production')).toBeNull();
  });

  test('normalises trailing slashes', () => {
    expect(resolveStaffVerifyBaseUrl('https://hms.example.com/', 'production')).toBe('https://hms.example.com');
    expect(resolveStaffVerifyBaseUrl('https://example.com/hms//', 'production')).toBe('https://example.com/hms');
  });

  test('allows http outside production only', () => {
    expect(resolveStaffVerifyBaseUrl('http://localhost:3001', 'development')).toBe('http://localhost:3001');
    expect(resolveStaffVerifyBaseUrl('http://hms.example.com', 'production')).toBeNull();
  });

  test.each([
    'not a url',
    'javascript:alert(1)',
    'ftp://example.com',
    'https://example.com/?next=evil',
    'https://example.com/#frag',
    'https://user:pass@example.com',
    'https://a.com,https://b.com',
  ])('rejects %s', (value) => {
    expect(resolveStaffVerifyBaseUrl(value, 'production')).toBeNull();
  });
});

describe('buildVerificationUrl', () => {
  test('contains only base URL, verify path and the token in the fragment', () => {
    const token = generateVerificationToken();
    const url   = buildVerificationUrl('https://hms.example.com', token);
    expect(url).toBe(`https://hms.example.com${STAFF_VERIFY_PATH}#${token}`);

    const parsed = new URL(url);
    expect(parsed.search).toBe('');
    expect(parsed.hash).toBe(`#${token}`);
  });
});
