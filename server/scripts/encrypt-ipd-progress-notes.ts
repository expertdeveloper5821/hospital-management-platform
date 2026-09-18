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
import { IPDAdmissionModel } from '../src/modules/ipd/ipd.model';
import {
  encryptField,
  isEncryptedField,
  EncryptionKeyPurpose,
} from '../src/shared/utils/field-encryption';

// One-off migration: encrypts every IPDAdmission `progressNotes[].note` written
// before field-level encryption covered it.
//
// Encryption is backward compatible without this script — the model passes a
// non-"enc:v1:" note element through untouched on read, and each note is
// encrypted the next time its admission's progressNotes array is written. This
// converts them at rest instead of waiting.
//
// Reads and writes go through the raw driver collection, NOT the model, so the
// encrypt/decrypt middleware can't double-encrypt or interfere. Safe to re-run:
// notes already in the envelope format are skipped, so an interrupted run
// resumes cleanly and a completed run is a no-op. Each write re-asserts the
// admission's exact prior progressNotes array as a concurrency guard, so a
// concurrent note append from the running app is never overwritten.
//
// Usage:
//   npm run migrate:encrypt-ipd-progress-notes            # apply
//   npm run migrate:encrypt-ipd-progress-notes -- --dry-run

const BATCH_SIZE = 200;
const KEY = EncryptionKeyPurpose.MEDICAL;

// Matches a doc holding at least one note that is a non-empty string not
// already in the "enc:v1:" envelope — i.e. legacy plaintext.
const HAS_LEGACY_PLAINTEXT_NOTE = {
  progressNotes: {
    $elemMatch: { note: { $type: 'string', $not: /^enc:v1:/, $ne: '' } },
  },
};

interface RawNote { note?: unknown; [k: string]: unknown }

// Returns a copy of `notes` with every legacy-plaintext `note` encrypted, or
// `null` when nothing in the array needs changing.
function encryptNotes(notes: RawNote[]): RawNote[] | null {
  let changed = false;
  const next = notes.map((n) => {
    const value = n?.note;
    if (typeof value === 'string' && value.length > 0 && !isEncryptedField(value)) {
      changed = true;
      return { ...n, note: encryptField(value, KEY) };
    }
    return n;
  });
  return changed ? next : null;
}

// Core migration, decoupled from process/connection lifecycle so it can be
// unit-tested against an in-memory Mongo. Returns the number of docs updated.
export async function migrateIpdProgressNotes(
  collection: MigratableCollection,
  opts: { dryRun?: boolean } = {},
): Promise<number> {
  const total = await collection.countDocuments(HAS_LEGACY_PLAINTEXT_NOTE);
  console.log(`Found ${total} IPD admission(s) with an unencrypted progress note.`);
  if (opts.dryRun) {
    console.log('Dry run — no documents were modified.');
    return 0;
  }

  const cursor = collection.find(HAS_LEGACY_PLAINTEXT_NOTE, {
    projection: { _id: 1, progressNotes: 1 },
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
    const doc = (await cursor.next()) as { _id: unknown; progressNotes?: unknown } | null;
    if (!doc) break;
    if (!Array.isArray(doc.progressNotes)) continue;

    const original = doc.progressNotes as RawNote[];
    const encrypted = encryptNotes(original);
    if (!encrypted) continue;

    // Re-assert the exact prior array at write time, so a concurrent progress
    // note append from the running app is never overwritten by this migration.
    batch.push({
      updateOne: {
        filter: { _id: doc._id, progressNotes: original },
        update: { $set: { progressNotes: encrypted } },
      },
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`Encrypted progress notes on ${updated} IPD admission(s).`);
  return updated;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  await connectDatabase();
  try {
    await migrateIpdProgressNotes(IPDAdmissionModel.collection, { dryRun });
  } finally {
    await disconnectDatabase();
  }
  process.exit(0);
}

// Only auto-run when invoked directly (ts-node scripts/...), not when imported.
if (require.main === module) {
  // Never print the offending value — only the failure itself.
  main().catch((err) => {
    console.error('encrypt-ipd-progress-notes failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  });
}
