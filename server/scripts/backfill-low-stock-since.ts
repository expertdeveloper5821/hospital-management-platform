import path from 'path';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { connectDatabase, disconnectDatabase } from '../src/shared/config/database';
import { InventoryItemModel } from '../src/modules/inventory/inventory.model';

// One-off migration: stamps `lowStockSince` on every inventory item that is
// currently low-stock (quantity < lowStockThreshold, threshold > 0) but has no
// lowStockSince recorded yet — items that crossed into low-stock before this
// field existed. There is no real history to recover, so "now" is used as the
// best available flag date; going forward, InventoryService stamps the real
// crossing moment on every stock/threshold change (see syncLowStockSince).
//
// Not encryption, so no legacy-format detection needed — this only needs to
// run once per deployment. Safe to re-run: items that already have
// lowStockSince (set by this script or by a later stock change) are skipped.
//
// Usage:
//   npm run migrate:backfill-low-stock-since            # apply
//   npm run migrate:backfill-low-stock-since -- --dry-run

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await connectDatabase();

  const filter = {
    isDeleted:     { $ne: true },
    lowStockSince: null,
    $expr: { $and: [{ $gt: ['$lowStockThreshold', 0] }, { $lt: ['$quantity', '$lowStockThreshold'] }] },
  };

  const matchCount = await InventoryItemModel.countDocuments(filter);

  if (dryRun) {
    console.log(`[dry-run] Would stamp lowStockSince on ${matchCount} currently low-stock item(s).`);
  } else {
    const result = await InventoryItemModel.updateMany(filter, { $set: { lowStockSince: new Date() } });
    console.log(`Stamped lowStockSince on ${result.modifiedCount} of ${matchCount} matched low-stock item(s).`);
  }

  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error('backfill-low-stock-since failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
