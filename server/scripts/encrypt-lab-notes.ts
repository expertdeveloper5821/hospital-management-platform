import path from 'path';

// Minimal structural shape shared by the mongodb-native and mongoose driver
// `Collection` types — enough for this migration, so callers can pass either.
interface MigratableCollection {
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  find(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): { hasNext(): Promise<boolean>; next(): Promise<unknown> };
  bulkWrite(operations: object[]): Promise<unknown>;
}

// Guarded so this module can be imported by a test that has already loaded env.
try {
  require('dotenv-safe').config({
    path:    path.resolve(__dirname, '../.env'),
    example: path.resolve(__dirname, '../.env.example'),
  });
} catch { /* env already provided by the caller (e.g. jest setup) */ }

import { connectDatabase, disconnectDatabase } from '../src/shared/config/database';
import { PathologyRequestModel, RadiologyRequestModel } from '../src/modules/lab/lab.model';
import {
  encryptField,
  isEncryptedField,
  EncryptionKeyPurpose,
} from '../src/shared/utils/field-encryption';

// One-off migration: encrypts the pathology/radiology request `notes` field
// written before field-level encryption covered it.
//
// Encryption is backward compatible without this script — the model passes a
// non-"enc:v1:" value through untouched on read, and each row is encrypted the
// next time it is written. This converts them at rest instead of waiting.
//
// Reads and writes go through the raw driver collection, NOT the model, so the
// encrypt/decrypt middleware can't double-encrypt or interfere. Safe to re-run:
// values already in the envelope format are skipped, so an interrupted run
// resumes cleanly and a completed run is a no-op.
//
// Usage:
//   npm run migrate:encrypt-lab-notes            # apply
//   npm run migrate:encrypt-lab-notes -- --dry-run

const FIELDS = ['notes'] as const;
const BATCH_SIZE = 200;
const KEY = EncryptionKeyPurpose.MEDICAL;

// A non-empty string that is not already in the "enc:v1:" envelope — i.e.
// legacy plaintext.
const LEGACY_PLAINTEXT = { $type: 'string', $not: /^enc:v1:/, $ne: '' };

// Core migration, decoupled from process/connection lifecycle so it can be
// unit-tested against an in-memory Mongo. Returns the number of docs updated.
export async function migrateLabNotes(
  collection: MigratableCollection,
  opts: { dryRun?: boolean } = {},
): Promise<number> {
  const filter = { $or: FIELDS.map((field) => ({ [field]: LEGACY_PLAINTEXT })) };

  const total = await collection.countDocuments(filter);
  console.log(`Found ${total} lab request(s) with an unencrypted notes field.`);
  if (opts.dryRun) {
    console.log('Dry run — no documents were modified.');
    return 0;
  }

  const cursor = collection.find(filter, {
    projection: { _id: 1, ...Object.fromEntries(FIELDS.map((f) => [f, 1])) },
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

    const $set:  Record<string, string>  = {};
    const guard: Record<string, unknown> = {};

    for (const field of FIELDS) {
      const value = doc[field];
      if (typeof value === 'string' && value.length > 0 && !isEncryptedField(value)) {
        $set[field]  = encryptField(value, KEY);
        guard[field] = value; // exact prior value for the concurrency guard
      }
    }

    if (!Object.keys($set).length) continue;

    // Re-assert every field's prior value at write time, so a concurrent write
    // from the running app is never overwritten by this migration.
    batch.push({ updateOne: { filter: { _id: doc._id, ...guard }, update: { $set } } });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`Encrypted notes on ${updated} lab request(s).`);
  return updated;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  await connectDatabase();
  try {
    console.log('— pathology_requests —');
    await migrateLabNotes(PathologyRequestModel.collection, { dryRun });
    console.log('— radiology_requests —');
    await migrateLabNotes(RadiologyRequestModel.collection, { dryRun });
  } finally {
    await disconnectDatabase();
  }
  process.exit(0);
}

// Only auto-run when invoked directly (ts-node scripts/...), not when imported.
if (require.main === module) {
  // Never print the offending value — only the failure itself.
  main().catch((err) => {
    console.error('encrypt-lab-notes failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  });
}
