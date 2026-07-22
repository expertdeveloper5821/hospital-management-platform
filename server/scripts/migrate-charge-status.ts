import path from 'path';
import mongoose from 'mongoose';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { connectDatabase, disconnectDatabase } from '../src/shared/config/database';
import { ChargeModel } from '../src/modules/charges/charges.model';

// One-off migration: rename the old 'VOIDED' charge status to 'CANCELLED' and
// move the voided* metadata fields onto their cancelled* equivalents.
async function main() {
  await connectDatabase();

  const result = await ChargeModel.collection.updateMany(
    { status: 'VOIDED' },
    {
      $set:    { status: 'CANCELLED' },
      $rename: { voidedBy: 'cancelledBy', voidedAt: 'cancelledAt' },
    },
  );

  console.log(`Migrated ${result.modifiedCount} charge(s) from VOIDED → CANCELLED.`);

  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error('migrate-charge-status failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
