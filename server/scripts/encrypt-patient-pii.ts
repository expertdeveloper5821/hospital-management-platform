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
import { PatientModel } from '../src/modules/patient/patient.model';
import {
  encryptField,
  isEncryptedField,
  EncryptionKeyPurpose,
} from '../src/shared/utils/field-encryption';

// One-off migration: encrypts Patient PII written before field-level encryption
// covered these fields — aadhaarNumber, dateOfBirth, bloodGroup, the
// emergency-contact pair (emergencyContactName / emergencyContactMobile), and
// the address block (address / addressLine1 / addressLine2 / city / state /
// country / pincode).
//
// Encryption is backward compatible without this script — the model passes a
// non-"enc:v1:" value through untouched on read (dateOfBirth still stored as a
// BSON Date is normalised to an ISO string), and each row is encrypted the next
// time it is written. This converts them at rest instead of waiting for that.
//
// Reads and writes go through the raw driver collection, NOT the model, so the
// encrypt/decrypt middleware can't double-encrypt or interfere. Safe to re-run:
// values already in the envelope format are skipped.
//
// Usage:
//   npm run migrate:encrypt-patient-pii            # apply
//   npm run migrate:encrypt-patient-pii -- --dry-run

const STRING_FIELDS = [
  'aadhaarNumber', 'bloodGroup', 'emergencyContactName', 'emergencyContactMobile',
  'address', 'addressLine1', 'addressLine2',
  'city', 'state', 'country', 'pincode',
] as const;
const DATE_FIELD = 'dateOfBirth';
const ALL_FIELDS = [...STRING_FIELDS, DATE_FIELD];
const BATCH_SIZE = 200;
const KEY = EncryptionKeyPurpose.AADHAAR;

// Any value that is not already an "enc:v1:" string. For a string field this is
// legacy plaintext; for dateOfBirth it also matches a BSON Date.
const NOT_ENCRYPTED = { $not: /^enc:v1:/ };

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string' && value.length > 0) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? value : new Date(t).toISOString();
  }
  return null;
}

// Core migration, decoupled from process/connection lifecycle so it can be
// unit-tested against an in-memory Mongo. Returns the number of docs updated.
export async function migratePatientPii(
  collection: MigratableCollection,
  opts: { dryRun?: boolean } = {},
): Promise<number> {
  const filter = {
    $or: [
      ...STRING_FIELDS.map((field) => ({ [field]: { $type: 'string', ...NOT_ENCRYPTED, $ne: '' } })),
      { [DATE_FIELD]: { $exists: true, ...NOT_ENCRYPTED } },
    ],
  };

  const total = await collection.countDocuments(filter);
  console.log(`Found ${total} patient(s) with at least one unencrypted PII field.`);
  if (opts.dryRun) {
    console.log('Dry run — no documents were modified.');
    return 0;
  }

  const cursor = collection.find(filter, {
    projection: { _id: 1, ...Object.fromEntries(ALL_FIELDS.map((f) => [f, 1])) },
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

    for (const field of STRING_FIELDS) {
      const value = doc[field];
      if (typeof value === 'string' && value.length > 0 && !isEncryptedField(value)) {
        $set[field]  = encryptField(value, KEY);
        guard[field] = value;
      }
    }

    const dob = doc[DATE_FIELD];
    if (dob != null && !(typeof dob === 'string' && isEncryptedField(dob))) {
      const iso = toIsoString(dob);
      if (iso) {
        $set[DATE_FIELD]  = encryptField(iso, KEY);
        guard[DATE_FIELD] = dob; // exact prior value (Date or string) for the concurrency guard
      }
    }

    if (!Object.keys($set).length) continue;

    // Re-assert every field's prior value at write time, so a concurrent write
    // from the running app is never overwritten by this migration.
    batch.push({ updateOne: { filter: { _id: doc._id, ...guard }, update: { $set } } });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`Encrypted PII on ${updated} patient(s).`);
  return updated;
}

async function main(): Promise<void> {
  await connectDatabase();
  try {
    await migratePatientPii(PatientModel.collection, { dryRun: process.argv.includes('--dry-run') });
  } finally {
    await disconnectDatabase();
  }
  process.exit(0);
}

// Only auto-run when invoked directly (ts-node scripts/...), not when imported.
if (require.main === module) {
  // Never print the offending value — only the failure itself.
  main().catch((err) => {
    console.error('encrypt-patient-pii failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  });
}
