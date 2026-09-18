import * as fc from 'fast-check';
import {
  encryptField,
  decryptField,
  isEncryptedField,
  EncryptionKeyPurpose,
} from '../../../src/shared/utils/field-encryption';

describe('field-encryption — example-based', () => {
  test('encryptField produces a value in the versioned envelope format', () => {
    const cipherText = encryptField('123456789012');
    expect(cipherText.startsWith('enc:v1:')).toBe(true);
    expect(isEncryptedField(cipherText)).toBe(true);
  });

  test('encrypted value never contains the plaintext Aadhaar digits', () => {
    const plain      = '123456789012';
    const cipherText = encryptField(plain);
    expect(cipherText).not.toContain(plain);
  });

  test('decryptField reverses encryptField (round-trip)', () => {
    const plain = '123456789012';
    expect(decryptField(encryptField(plain))).toBe(plain);
  });

  test('two encryptions of the same plaintext produce different ciphertext (random IV)', () => {
    const a = encryptField('123456789012');
    const b = encryptField('123456789012');
    expect(a).not.toBe(b);
  });

  test('decryptField passes through legacy plaintext (no "enc:v1:" prefix) unchanged', () => {
    expect(decryptField('123456789012')).toBe('123456789012');
    expect(isEncryptedField('123456789012')).toBe(false);
  });

  test('decryptField throws (never returns garbage) on a tampered ciphertext', () => {
    const cipherText = encryptField('123456789012');
    const tampered    = cipherText.slice(0, -2) + (cipherText.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(() => decryptField(tampered)).toThrow();
  });
});

describe('field-encryption — key purposes', () => {
  // MEDICAL covers clinical free-text (OPD diagnosis/prescription); AADHAAR
  // covers patient PII. tests/setup.ts configures a distinct key for each.
  const MEDICAL = EncryptionKeyPurpose.MEDICAL;

  test('round-trips clinical free-text under the MEDICAL key', () => {
    const plain = 'Acute viral fever with pharyngitis; advise rest for 3 days.';
    const cipherText = encryptField(plain, MEDICAL);

    expect(isEncryptedField(cipherText)).toBe(true);
    expect(cipherText).not.toContain('fever');
    expect(decryptField(cipherText, MEDICAL)).toBe(plain);
  });

  test('round-trips multiline prescription text', () => {
    const plain = 'Paracetamol 500mg TDS × 3d\nORS sachets PRN\nReview after 1 week';
    expect(decryptField(encryptField(plain, MEDICAL), MEDICAL)).toBe(plain);
  });

  test('round-trips rich-text HTML notes byte-for-byte', () => {
    const plain = '<p>Vitals stable. <strong>BP 120/80</strong>.</p><ul><li>Review in 1 week</li></ul>';
    const cipherText = encryptField(plain, MEDICAL);
    expect(isEncryptedField(cipherText)).toBe(true);
    expect(cipherText).not.toContain('120/80');
    expect(decryptField(cipherText, MEDICAL)).toBe(plain);
  });

  test('keys are domain-separated — a MEDICAL value cannot be read with the AADHAAR key', () => {
    const cipherText = encryptField('Confidential diagnosis', MEDICAL);
    // Default purpose is AADHAAR; GCM authentication must reject the wrong key
    // rather than return anything at all.
    expect(() => decryptField(cipherText, EncryptionKeyPurpose.AADHAAR)).toThrow();
  });

  test('legacy plaintext clinical values pass through unchanged', () => {
    expect(decryptField('Legacy hypertension', MEDICAL)).toBe('Legacy hypertension');
  });

  test('decryption failures never leak the value into the error', () => {
    const cipherText = encryptField('Highly confidential diagnosis', MEDICAL);
    const tampered   = cipherText.slice(0, -2) + (cipherText.slice(-2) === 'AA' ? 'BB' : 'AA');

    expect(() => decryptField(tampered, MEDICAL)).toThrow('Failed to decrypt field value.');
    try {
      decryptField(tampered, MEDICAL);
    } catch (err) {
      expect((err as Error).message).not.toContain('confidential');
      expect((err as Error).message).not.toContain(cipherText);
    }
  });
});

describe('field-encryption — property-based', () => {
  test('PBT: round-trips any 12-digit Aadhaar-shaped string', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 12 }).map((digits) => digits.join('')),
        (aadhaar) => {
          const cipherText = encryptField(aadhaar);
          expect(cipherText.startsWith('enc:v1:')).toBe(true);
          expect(cipherText).not.toContain(aadhaar);
          expect(decryptField(cipherText)).toBe(aadhaar);
        },
      ),
      { numRuns: 50, seed: 42 },
    );
  });
});
