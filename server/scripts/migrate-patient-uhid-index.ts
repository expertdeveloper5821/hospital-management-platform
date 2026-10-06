import path from 'path';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { connectDatabase, disconnectDatabase } from '../src/shared/config/database';
import { PatientModel } from '../src/modules/patient/patient.model';
import { PatientUhidCounterModel } from '../src/modules/patient/patient-uhid-counter.model';

// One-off migration for per-hospital sequential UHIDs (PAT-<INITIALS><SEQ>).
//
// 1. Drops the legacy *global* unique index on `patients.patientId`
//    (`patientId_1`). Each hospital now runs its own sequence, so two hospitals
//    with the same initials (e.g. "Narayan Hospital" / "Nova Hospital") both
//    issue PAT-NH01. Uniqueness is enforced per tenant by the existing
//    `{ tenantId: 1, patientId: 1 }` unique index, which this script ensures.
//    Mongoose never drops indexes on its own, so this is needed in every
//    environment with an existing database — not only production.
// 2. Creates the unique `tenantId` index on `patient_uhid_counters`
//    (autoIndex is disabled in production — see shared/config/database.ts).
//
// Existing patient UHIDs are not touched. Safe to re-run. `-- --dry-run`
// reports what would change without modifying anything.

const LEGACY_INDEX_NAME = 'patientId_1';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDatabase();

  const conflicts = await PatientModel.collection.aggregate([
    { $group: { _id: { tenantId: '$tenantId', patientId: '$patientId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  if (conflicts.length > 0) {
    console.error('Refusing to continue — duplicate (tenantId, patientId) pairs exist:', conflicts);
    await disconnectDatabase();
    process.exit(1);
  }

  const indexes  = await PatientModel.collection.indexes();
  const hasGlobal = indexes.some((ix) => ix.name === LEGACY_INDEX_NAME);

  if (dryRun) {
    console.log(`[dry-run] ${hasGlobal ? `would drop ${LEGACY_INDEX_NAME}` : `${LEGACY_INDEX_NAME} not present`}`);
    console.log('[dry-run] would ensure { tenantId: 1, patientId: 1 } unique and patient_uhid_counters.tenantId unique');
  } else {
    await PatientModel.collection.createIndex({ tenantId: 1, patientId: 1 }, { unique: true });
    if (hasGlobal) {
      await PatientModel.collection.dropIndex(LEGACY_INDEX_NAME);
      console.log(`Dropped ${LEGACY_INDEX_NAME}.`);
    } else {
      console.log(`${LEGACY_INDEX_NAME} not present — nothing to drop.`);
    }
    await PatientUhidCounterModel.collection.createIndex({ tenantId: 1 }, { unique: true });
    console.log('Ensured per-tenant UHID indexes.');
  }

  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error('migrate-patient-uhid-index failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
