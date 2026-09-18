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

// One-off migration: encrypts every IPDAdmission `vitals.*` value written
// before field-level encryption covered it (weight/height/sugar/
// bodyTemperature — numeric — and bloodPressure — string). Mirrors
// scripts/encrypt-opd-vitals.ts field-for-field.
//
// Encryption is backward compatible without this script — the model passes a
// legacy plaintext vitals value through untouched on read, and it is
// encrypted the next time its admission's vitals are written. This converts
// them at rest instead of waiting.
//
// Reads and writes go through the raw driver collection, NOT the model, so
// the encrypt/decrypt middleware can't double-encrypt or interfere. Safe to
// re-run: values already in the envelope format are skipped, so an
// interrupted run resumes cleanly and a completed run is a no-op. Each write
// re-asserts the admission's exact prior vitals object as a concurrency
// guard, so a concurrent vitals edit from the running app is never
// overwritten.
//
// Usage:
//   npm run migrate:encrypt-ipd-vitals            # apply
//   npm run migrate:encrypt-ipd-vitals -- --dry-run

const BATCH_SIZE = 200;
const KEY = EncryptionKeyPurpose.MEDICAL;
const NUMBER_FIELDS = ['weight', 'height', 'sugar', 'bodyTemperature'] as const;

// Matches an admission holding at least one legacy-plaintext vitals value: a
// real BSON number in one of the numeric fields, or a non-empty string not
// already in the "enc:v1:" envelope for bloodPressure.
const HAS_LEGACY_PLAINTEXT_VITALS = {
  $or: [
    ...NUMBER_FIELDS.map((f) => ({ [`vitals.${f}`]: { $type: 'number' } })),
    { 'vitals.bloodPressure': { $type: 'string', $not: /^enc:v1:/, $ne: '' } },
  ],
};

interface RawVitals {
  weight?:          unknown;
  height?:          unknown;
  bloodPressure?:   unknown;
  sugar?:           unknown;
  bodyTemperature?: unknown;
  [k: string]: unknown;
}

// Returns an encrypted copy of `vitals`, or `null` when nothing in it needs
// changing (already encrypted / not present).
function encryptVitals(vitals: RawVitals): RawVitals | null {
  let changed = false;
  const next: RawVitals = { ...vitals };

  for (const field of NUMBER_FIELDS) {
    const value = next[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      next[field] = encryptField(String(value), KEY);
      changed = true;
    }
  }

  const bp = next.bloodPressure;
  if (typeof bp === 'string' && bp.length > 0 && !isEncryptedField(bp)) {
    next.bloodPressure = encryptField(bp, KEY);
    changed = true;
  }

  return changed ? next : null;
}

// Core migration, decoupled from process/connection lifecycle so it can be
// unit-tested against an in-memory Mongo. Returns the number of docs updated.
export async function migrateIpdVitals(
  collection: MigratableCollection,
  opts: { dryRun?: boolean } = {},
): Promise<number> {
  const total = await collection.countDocuments(HAS_LEGACY_PLAINTEXT_VITALS);
  console.log(`Found ${total} IPD admission(s) with unencrypted vitals.`);
  if (opts.dryRun) {
    console.log('Dry run — no documents were modified.');
    return 0;
  }

  const cursor = collection.find(HAS_LEGACY_PLAINTEXT_VITALS, {
    projection: { _id: 1, vitals: 1 },
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
    const doc = (await cursor.next()) as { _id: unknown; vitals?: unknown } | null;
    if (!doc || !doc.vitals || typeof doc.vitals !== 'object') continue;

    const original  = doc.vitals as RawVitals;
    const encrypted = encryptVitals(original);
    if (!encrypted) continue;

    // Re-assert the exact prior vitals object at write time, so a concurrent
    // vitals edit from the running app is never overwritten by this migration.
    batch.push({
      updateOne: {
        filter: { _id: doc._id, vitals: original },
        update: { $set: { vitals: encrypted } },
      },
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`Encrypted vitals on ${updated} IPD admission(s).`);
  return updated;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  await connectDatabase();
  try {
    await migrateIpdVitals(IPDAdmissionModel.collection, { dryRun });
  } finally {
    await disconnectDatabase();
  }
  process.exit(0);
}

// Only auto-run when invoked directly (ts-node scripts/...), not when imported.
if (require.main === module) {
  // Never print the offending value — only the failure itself.
  main().catch((err) => {
    console.error('encrypt-ipd-vitals failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  });
}
