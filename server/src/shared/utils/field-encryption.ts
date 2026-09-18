import crypto from 'crypto';
import config from '../config/env';

// ─── Field-level authenticated encryption (AES-256-GCM) ───────────────────────
// Used for encrypting sensitive fields at rest: PII (e.g. Patient.aadhaarNumber),
// clinical data (OPDVisit.diagnosis / .prescription / .notes) and payment
// free-text / references (Payment.description / .transactionId).
//
// Keys are loaded from environment/config only — never hard-coded, never stored
// in the database, and never sent to the frontend. Each purpose has its own key
// so a compromise of one data domain's key does not expose the other.
//
// Ciphertext envelope: "enc:v1:" + base64(iv[12] + authTag[16] + ciphertext)
// The prefix lets decryptField() tell already-encrypted values apart from
// legacy plaintext values that predate this feature, so pre-existing records
// aren't corrupted by a best-effort decrypt attempt.

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12; // recommended nonce length for GCM
const TAG_LENGTH = 16;
const PREFIX     = 'enc:v1:';

// Which key a given field is encrypted under. Each purpose resolves to its own
// 32-byte key (see AppConfig.security); MEDICAL and PAYMENT fall back to the
// AADHAAR key when their own env var is unset so existing deployments keep
// starting.
export const EncryptionKeyPurpose = {
  AADHAAR: 'AADHAAR',
  MEDICAL: 'MEDICAL',
  PAYMENT: 'PAYMENT',
} as const;

export type EncryptionKeyPurpose = typeof EncryptionKeyPurpose[keyof typeof EncryptionKeyPurpose];

const KEY_SOURCES: Record<EncryptionKeyPurpose, { envVar: string; read: () => string }> = {
  [EncryptionKeyPurpose.AADHAAR]: {
    envVar: 'AADHAAR_ENCRYPTION_KEY',
    read:   () => config.security.aadhaarEncryptionKey,
  },
  [EncryptionKeyPurpose.MEDICAL]: {
    envVar: 'MEDICAL_DATA_ENCRYPTION_KEY',
    read:   () => config.security.medicalDataEncryptionKey,
  },
  [EncryptionKeyPurpose.PAYMENT]: {
    envVar: 'PAYMENT_DATA_ENCRYPTION_KEY',
    read:   () => config.security.paymentDataEncryptionKey,
  },
};

const cachedKeys = new Map<EncryptionKeyPurpose, Buffer>();

function getKey(purpose: EncryptionKeyPurpose): Buffer {
  const cached = cachedKeys.get(purpose);
  if (cached) return cached;

  const source = KEY_SOURCES[purpose];
  const key    = Buffer.from(source.read() ?? '', 'base64');
  if (key.length !== 32) {
    // Never include the key material itself in the error message.
    throw new Error(
      `${source.envVar} must be a base64-encoded 32-byte (256-bit) key.`,
    );
  }
  cachedKeys.set(purpose, key);
  return key;
}

/** True when `value` is already in this module's encrypted envelope format. */
export function isEncryptedField(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Encrypts `plainText` with AES-256-GCM. Returns the versioned ciphertext envelope. */
export function encryptField(
  plainText: string,
  purpose:   EncryptionKeyPurpose = EncryptionKeyPurpose.AADHAAR,
): string {
  const key    = getKey(purpose);
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypts a value produced by encryptField(). Values not in the encrypted
 * envelope format are returned unchanged (legacy plaintext written before
 * encryption was introduced) so existing records keep working without a
 * migration. Never logs or throws the plaintext/ciphertext on failure.
 *
 * Throws on a value that claims to be encrypted but fails GCM authentication —
 * tampering or a wrong/rotated key. Failing loudly is deliberate: silently
 * handing back ciphertext (or garbage) as if it were a clinical record would
 * be worse than an error.
 */
export function decryptField(
  value:   string,
  purpose: EncryptionKeyPurpose = EncryptionKeyPurpose.AADHAAR,
): string {
  if (!isEncryptedField(value)) return value;

  try {
    const key = getKey(purpose);
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');

    const iv        = raw.subarray(0, IV_LENGTH);
    const authTag   = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = raw.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (err) {
    // Logs the failure and the key purpose only — never the value, the
    // plaintext, or any key material.
    console.error(JSON.stringify({
      level:     'error',
      event:     'field_decryption_failed',
      purpose,
      message:   (err as Error).message,
      timestamp: new Date().toISOString(),
    }));
    throw new Error('Failed to decrypt field value.');
  }
}
