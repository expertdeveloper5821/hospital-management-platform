import path from 'path';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { connectDatabase, disconnectDatabase } from '../src/shared/config/database';
import { IPDAdmissionModel } from '../src/modules/ipd/ipd.model';

// One-off migration: creates the two partial unique indexes added to
// IPDAdmission for offline-sync race-safety — "at most one ADMITTED
// admission per bed" and "...per patient" (see ipd.model.ts). Needed in
// production because autoIndex is disabled there (see
// shared/config/database.ts); dev/test pick these up automatically via
// Mongoose's own autoIndex on connect.
//
// Safe to re-run — Mongoose/MongoDB no-ops creating an index that already
// exists with the same spec. Before creating either index, this script
// checks for any pre-existing violation (more than one ADMITTED admission
// sharing a bed, or a patient with more than one ADMITTED admission) via
// aggregation, and reports it instead of letting index creation fail
// opaquely — those are pre-existing data-integrity bugs that need manual
// resolution (e.g. discharging a stale duplicate) before the constraint can
// be added.

async function findConflicts(groupField: 'bedId' | 'patientId'): Promise<Array<{ _id: unknown; count: number }>> {
  return IPDAdmissionModel.aggregate([
    { $match: { status: 'ADMITTED' } },
    { $group: { _id: { tenantId: '$tenantId', [groupField]: `$${groupField}` }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
}

async function main() {
  await connectDatabase();

  const [bedConflicts, patientConflicts] = await Promise.all([
    findConflicts('bedId'),
    findConflicts('patientId'),
  ]);

  if (bedConflicts.length > 0 || patientConflicts.length > 0) {
    console.error('Refusing to create indexes — existing data violates the new constraint(s):');
    if (bedConflicts.length > 0) {
      console.error(`  ${bedConflicts.length} bed(s) with more than one ADMITTED admission:`, bedConflicts);
    }
    if (patientConflicts.length > 0) {
      console.error(`  ${patientConflicts.length} patient(s) with more than one ADMITTED admission:`, patientConflicts);
    }
    console.error('Resolve these (e.g. discharge the stale duplicate) and re-run this script.');
    await disconnectDatabase();
    process.exit(1);
  }

  await IPDAdmissionModel.collection.createIndex(
    { tenantId: 1, bedId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: 'ADMITTED' }, name: 'uniq_active_admission_per_bed' },
  );
  console.log('Created index uniq_active_admission_per_bed.');

  await IPDAdmissionModel.collection.createIndex(
    { tenantId: 1, patientId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: 'ADMITTED' }, name: 'uniq_active_admission_per_patient' },
  );
  console.log('Created index uniq_active_admission_per_patient.');

  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error('migrate-ipd-add-active-admission-indexes failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
