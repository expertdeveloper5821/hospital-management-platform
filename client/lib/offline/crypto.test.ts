/**
 * @jest-environment node
 *
 * WebCrypto + IndexedDB together need Node's real `structuredClone` (used
 * internally by fake-indexeddb to clone stored values, including the
 * non-extractable CryptoKey object) — jsdom's sandboxed global lacks it, but
 * Node's own "node" test environment has both natively.
 */
import 'fake-indexeddb/auto';
import {
  getOrCreateClientKey,
  encryptClientField,
  decryptClientField,
  isClientEncryptedField,
  CLIENT_ENVELOPE_PREFIX,
} from './crypto';

const TENANT = 'tenant-1';
const USER = 'user-1';

describe('offline crypto', () => {
  test('round-trips a plaintext string through encrypt/decrypt', async () => {
    const key = await getOrCreateClientKey(TENANT, USER);
    const ciphertext = await encryptClientField('123456789012', key);

    expect(ciphertext).not.toBe('123456789012');
    expect(isClientEncryptedField(ciphertext)).toBe(true);
    expect(ciphertext.startsWith(CLIENT_ENVELOPE_PREFIX)).toBe(true);

    const plain = await decryptClientField(ciphertext, key);
    expect(plain).toBe('123456789012');
  });

  test('the same plaintext encrypts differently each time (random IV)', async () => {
    const key = await getOrCreateClientKey(TENANT, USER);
    const a = await encryptClientField('same value', key);
    const b = await encryptClientField('same value', key);
    expect(a).not.toBe(b);
  });

  test('returns a value unchanged if it is not in the client envelope format', async () => {
    const plain = await decryptClientField('plain-legacy-value', {} as CryptoKey);
    expect(plain).toBe('plain-legacy-value');
  });

  test('tamper detection: corrupted ciphertext fails to decrypt (GCM auth tag)', async () => {
    const key = await getOrCreateClientKey(TENANT, USER);
    const ciphertext = await encryptClientField('sensitive value', key);

    const tampered = ciphertext.slice(0, -4) + (ciphertext.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');

    await expect(decryptClientField(tampered, key)).rejects.toThrow();
  });

  test('decrypting with a different key fails', async () => {
    const key = await getOrCreateClientKey(TENANT, USER);
    const otherKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

    const ciphertext = await encryptClientField('secret', key);

    await expect(decryptClientField(ciphertext, otherKey)).rejects.toThrow();
  });

  test('the generated key is not extractable', async () => {
    const key = await getOrCreateClientKey(TENANT, USER);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  test('the key survives across calls (persisted, not regenerated)', async () => {
    const key1 = await getOrCreateClientKey(TENANT, USER);
    const key2 = await getOrCreateClientKey(TENANT, USER);

    const ciphertext = await encryptClientField('persisted-key-check', key1);
    const plain = await decryptClientField(ciphertext, key2);
    expect(plain).toBe('persisted-key-check');
  });

  test('different (tenantId, userId) pairs get independent keys', async () => {
    const keyA = await getOrCreateClientKey('tenant-a', 'user-a');
    const keyB = await getOrCreateClientKey('tenant-b', 'user-b');

    const ciphertext = await encryptClientField('cross-tenant-secret', keyA);
    await expect(decryptClientField(ciphertext, keyB)).rejects.toThrow();
  });
});
