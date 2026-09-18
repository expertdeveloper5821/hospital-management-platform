import path from 'path';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { connectDatabase, disconnectDatabase } from '../src/shared/config/database';
import { OPDVisitModel } from '../src/modules/opd/opd.model';
import {
  encryptField,
  isEncryptedField,
  EncryptionKeyPurpose,
} from '../src/shared/utils/field-encryption';

// One-off migration: encrypts clinical free-text written before field-level
// encryption existed (OPDVisit.diagnosis / .prescription / .notes).
//
// Encryption is backward compatible without this script — decryptField passes
// a value through untouched unless it carries the "enc:v1:" envelope, so legacy
// plaintext rows keep reading correctly and are encrypted the next time they
// are written. This script converts them at rest instead of waiting for that.
//
// Reads and writes go through the raw driver collection, NOT the model, so the
// encrypt/decrypt middleware can't double-encrypt or interfere. Safe to re-run:
// values already in the envelope format are skipped.
//
// Usage:
//   npm run migrate:encrypt-medical-fields            # apply
//   npm run migrate:encrypt-medical-fields -- --dry-run

const ENCRYPTED_FIELDS = ['diagnosis', 'prescription', 'notes'] as const;
const BATCH_SIZE = 200;

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await connectDatabase();
  const collection = OPDVisitModel.collection;

  // Anything that is a non-empty string and not already enveloped. The regex is
  // anchored on the prefix, so this matches legacy plaintext only.
  const filter = {
    $or: ENCRYPTED_FIELDS.map((field) => ({
      [field]: { $type: 'string', $not: /^enc:v1:/, $ne: '' },
    })),
  };

  const total = await collection.countDocuments(filter);
  console.log(`Found ${total} OPD visit(s) with unencrypted clinical field(s).`);
  if (dryRun) {
    console.log('Dry run — no documents were modified.');
    await disconnectDatabase();
    process.exit(0);
  }

  const cursor = collection.find(filter, {
    projection: { _id: 1, ...Object.fromEntries(ENCRYPTED_FIELDS.map((f) => [f, 1])) },
  });

  let updated = 0;
  let batch: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];

  async function flush(): Promise<void> {
    if (!batch.length) return;
    await collection.bulkWrite(batch);
    updated += batch.length;
    batch = [];
  }

  while (await cursor.hasNext()) {
    const doc = (await cursor.next()) as Record<string, unknown> | null;
    if (!doc) break;

    const $set: Record<string, string> = {};
    for (const field of ENCRYPTED_FIELDS) {
      const value = doc[field];
      if (typeof value === 'string' && value.length > 0 && !isEncryptedField(value)) {
        $set[field] = encryptField(value, EncryptionKeyPurpose.MEDICAL);
      }
    }
    if (!Object.keys($set).length) continue;

    // Re-assert the field is still unencrypted at write time, so a concurrent
    // write from the running app is never overwritten by this migration.
    batch.push({
      updateOne: {
        filter: {
          _id: doc._id,
          ...Object.fromEntries(
            Object.keys($set).map((field) => [field, doc[field]]),
          ),
        },
        update: { $set },
      },
    });

    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`Encrypted clinical field(s) on ${updated} OPD visit(s).`);

  await disconnectDatabase();
  process.exit(0);
}

// Never print the offending value — only the failure itself.
main().catch((err) => {
  console.error('encrypt-medical-fields failed:', err instanceof Error ? err.message : 'unknown error');
  process.exit(1);
});
