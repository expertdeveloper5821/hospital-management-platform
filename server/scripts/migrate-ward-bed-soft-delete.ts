import path from 'path';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { connectDatabase, disconnectDatabase } from '../src/shared/config/database';
import { WardModel } from '../src/modules/ipd/ward.model';
import { BedModel }  from '../src/modules/ipd/bed.model';

// One-off migration for Ward/Bed soft delete (see ward.model.ts / bed.model.ts).
// Needed in production because autoIndex is disabled there (see
// shared/config/database.ts); dev/test pick up the new indexes via autoIndex
// but still need this script to drop the old ones.
//
//   1. Backfills `isDeleted: false` on legacy wards/beds missing the field, so
//      the new partial unique indexes (which only cover `isDeleted: false`)
//      apply to them.
//   2. Creates `uniq_active_ward_name` / `uniq_active_bed_number_per_ward`.
//   3. Drops the old non-partial unique indexes `tenantId_1_name_1` (wards) and
//      `tenantId_1_wardId_1_bedNumber_1` (beds), which would otherwise keep
//      blocking reuse of a deleted ward's name / deleted bed's number.
//
// Safe to re-run. `-- --dry-run` reports what would change without writing.

const DRY_RUN = process.argv.includes('--dry-run');

async function dropIndexIfExists(
  collection: typeof WardModel.collection,
  name:       string,
): Promise<void> {
  const exists = (await collection.indexes()).some((i) => i.name === name);
  if (!exists) {
    console.log(`Index ${collection.collectionName}.${name} not present — skipping.`);
    return;
  }
  if (DRY_RUN) {
    console.log(`[dry-run] Would drop index ${collection.collectionName}.${name}.`);
    return;
  }
  await collection.dropIndex(name);
  console.log(`Dropped index ${collection.collectionName}.${name}.`);
}

async function main() {
  await connectDatabase();

  const missing = { isDeleted: { $exists: false } };
  const [wardsMissing, bedsMissing] = await Promise.all([
    WardModel.collection.countDocuments(missing),
    BedModel.collection.countDocuments(missing),
  ]);
  console.log(`${wardsMissing} ward(s) and ${bedsMissing} bed(s) need isDeleted backfilled.`);

  if (DRY_RUN) {
    console.log('[dry-run] Would create uniq_active_ward_name and uniq_active_bed_number_per_ward.');
  } else {
    await WardModel.collection.updateMany(missing, { $set: { isDeleted: false, deletedAt: null, deletedBy: null } });
    await BedModel.collection.updateMany(missing, { $set: { isDeleted: false, deletedAt: null, deletedBy: null } });

    await WardModel.collection.createIndex(
      { tenantId: 1, name: 1 },
      { unique: true, partialFilterExpression: { isDeleted: false }, name: 'uniq_active_ward_name' },
    );
    console.log('Created index uniq_active_ward_name.');
    await BedModel.collection.createIndex(
      { tenantId: 1, wardId: 1, bedNumber: 1 },
      { unique: true, partialFilterExpression: { isDeleted: false }, name: 'uniq_active_bed_number_per_ward' },
    );
    console.log('Created index uniq_active_bed_number_per_ward.');
  }

  // Dropped only after the replacements exist, so uniqueness is never unenforced.
  await dropIndexIfExists(WardModel.collection, 'tenantId_1_name_1');
  await dropIndexIfExists(BedModel.collection,  'tenantId_1_wardId_1_bedNumber_1');

  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error('migrate-ward-bed-soft-delete failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
