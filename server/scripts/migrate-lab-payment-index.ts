import path from 'path';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { connectDatabase, disconnectDatabase } from '../src/shared/config/database';
import { PaymentModel } from '../src/modules/payment/payment.model';
import { LAB_PAYMENT_REFERENCE_TYPES, PaymentStatus } from '../src/modules/payment/payment.types';

// One-off migration: creates the partial unique index that allows at most one
// COMPLETED payment per Pathology/Radiology request (see payment.model.ts).
// Needed in production because autoIndex is disabled there (see
// shared/config/database.ts); dev/test pick it up automatically via
// Mongoose's own autoIndex on connect.
//
// Safe to re-run — MongoDB no-ops creating an index that already exists with
// the same spec. Before creating it, this script checks for any lab request
// that already has more than one COMPLETED payment and reports it instead of
// letting index creation fail opaquely — those duplicates need manual
// resolution (e.g. refunding/cancelling the extra payment) first.

const INDEX_KEYS    = { tenantId: 1, referenceId: 1, referenceType: 1 } as const;
const INDEX_OPTIONS = {
  unique: true,
  partialFilterExpression: {
    status:        PaymentStatus.COMPLETED,
    referenceType: { $in: [...LAB_PAYMENT_REFERENCE_TYPES] },
  },
  name: 'uniq_completed_lab_payment_per_request',
};

async function main() {
  await connectDatabase();

  const conflicts = await PaymentModel.aggregate([
    { $match: INDEX_OPTIONS.partialFilterExpression },
    {
      $group: {
        _id:   { tenantId: '$tenantId', referenceType: '$referenceType', referenceId: '$referenceId' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (conflicts.length > 0) {
    console.error('Refusing to create index — existing data violates the new constraint:');
    console.error(`  ${conflicts.length} lab request(s) with more than one COMPLETED payment:`, conflicts);
    console.error('Resolve these duplicates and re-run this script.');
    await disconnectDatabase();
    process.exit(1);
  }

  await PaymentModel.collection.createIndex(INDEX_KEYS, INDEX_OPTIONS);
  console.log(`Created index ${INDEX_OPTIONS.name}.`);

  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error('migrate-lab-payment-index failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
