import crypto from 'crypto';

// Public verification path on the frontend. The token travels in the URL
// *fragment* (`#<token>`), which browsers never send to any server — so it
// never reaches the frontend host's access logs, a CDN, or a Referer header.
export const STAFF_VERIFY_PATH = '/verify-staff';

const TOKEN_BYTES = 32;

// base64url of 32 bytes is always exactly 43 characters with no padding.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 256-bit CSPRNG token. Only ever embedded in the card PDF — never stored. */
export function generateVerificationToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex digest — the only form of the token persisted in the database. */
export function hashVerificationToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedVerificationToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/**
 * Validates and normalises STAFF_VERIFY_BASE_URL. Returns null when unset or
 * invalid so callers fail closed rather than printing a wrong domain onto a
 * physical card. Production requires https.
 */
export function resolveStaffVerifyBaseUrl(raw: string, nodeEnv: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  // A single origin only — a comma-separated list (FRONTEND_URL style) or any
  // whitespace would otherwise be accepted by the URL parser as a hostname.
  if (/[\s,]/.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') return null;
  if (parsed.search || parsed.hash || parsed.username || parsed.password) return null;

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

/** The exact string encoded in the QR code: base URL + path + fragment token. Nothing else. */
export function buildVerificationUrl(baseUrl: string, token: string): string {
  return `${baseUrl}${STAFF_VERIFY_PATH}#${token}`;
}
