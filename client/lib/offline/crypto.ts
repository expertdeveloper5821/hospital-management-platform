// Client-side AES-256-GCM encryption for data at rest in IndexedDB. This is a
// SEPARATE layer from the backend's own field-level encryption
// (server/src/shared/utils/field-encryption.ts) — different key, different
// envelope, different threat model (a lost/stolen device or a shared
// front-desk PC, not the backend's Mongo-at-rest threat). The backend's
// encryption keys never leave the server; this module never talks to them.
//
// The key is generated with `extractable: false`, so its raw bytes can never
// be exported via `crypto.subtle.exportKey` — even by an XSS payload running
// in this origin. The `CryptoKey` handle itself is what gets structured-cloned
// into IndexedDB (browsers support storing non-extractable CryptoKey objects
// directly), never serialized to JSON or sent over the network. This protects
// data at rest on disk; it cannot (and is not meant to) defend against a live
// XSS calling `decrypt()` while the page is open.

import { openOfflineDb } from './db';

export const CLIENT_ENVELOPE_PREFIX = 'enc:client:v1:';
const IV_LENGTH_BYTES = 12;
const KEY_RECORD_ID = 'primary' as const;

function bufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Returns this (tenantId, userId)'s client-side crypto key, generating and
 * persisting a new non-extractable AES-256-GCM key on first use. Never
 * derived from the password, JWT, or anything server-known — independent of
 * any value an intercepted network payload could reconstruct.
 */
export async function getOrCreateClientKey(tenantId: string, userId: string): Promise<CryptoKey> {
  const db = await openOfflineDb(tenantId, userId);
  const existing = await db.get('cryptoKeys', KEY_RECORD_ID);
  if (existing) return existing.key;

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // extractable: false — raw key bytes can never be read back out
    ['encrypt', 'decrypt'],
  );

  await db.put('cryptoKeys', {
    id:        KEY_RECORD_ID,
    key,
    algorithm: 'AES-GCM-256',
    createdAt: Date.now(),
  });

  return key;
}

export function isClientEncryptedField(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CLIENT_ENVELOPE_PREFIX);
}

/** Encrypts a plaintext string, returning the `enc:client:v1:<base64(iv|ciphertext+tag)>` envelope. */
export async function encryptClientField(plainText: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encoded = new TextEncoder().encode(plainText);
  // WebCrypto's AES-GCM output already appends the 16-byte auth tag — no
  // separate tag handling needed (unlike the backend's Node `crypto` module).
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return CLIENT_ENVELOPE_PREFIX + bufferToBase64(combined);
}

/**
 * Decrypts an `enc:client:v1:...` envelope. Throws if the ciphertext was
 * tampered with or the wrong key is used (GCM auth-tag verification fails).
 * A value that isn't in the envelope format is returned unchanged.
 */
export async function decryptClientField(value: string, key: CryptoKey): Promise<string> {
  if (!isClientEncryptedField(value)) return value;

  const combined  = base64ToBuffer(value.slice(CLIENT_ENVELOPE_PREFIX.length));
  const iv         = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuffer);
}
