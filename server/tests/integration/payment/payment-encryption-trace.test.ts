import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { PaymentModel } from '../../../src/modules/payment/payment.model';
import { migratePaymentFields } from '../../../scripts/encrypt-payment-fields';

const ENVELOPE = /^enc:v1:/;
const TENANT = 'tenant-pay-trace';
const ENC_FIELDS = ['description', 'transactionId'] as const;

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
});

// Raw driver read — no Mongoose middleware, so this is the exact BSON on disk.
async function raw(paymentId: string): Promise<Record<string, unknown>> {
  const doc = await mongoose.connection.collection('payments').findOne({ paymentId });
  if (!doc) throw new Error(`raw payment ${paymentId} not found`);
  return doc as Record<string, unknown>;
}

function fullPayment(paymentId: string) {
  return {
    paymentId,
    tenantId:      TENANT,
    patientId:     'PAT-PAYTRACE1',
    fullName:      'Trace Payer',
    amount:        500,
    paymentMethod: 'UPI',
    description:   'OPD Consultation – secret procedure note',
    status:        'COMPLETED',
    transactionId: 'UPI-REF-TRACE-0001',
    referenceType: 'OPD_VISIT',
    referenceId:   'OPD-PAYTRACE1',
    createdBy:     'user-1',
  };
}

function assertAllCiphertext(stored: Record<string, unknown>): void {
  for (const f of ENC_FIELDS) {
    expect({ field: f, value: stored[f] }).toEqual({ field: f, value: expect.stringMatching(ENVELOPE) });
  }
  const blob = JSON.stringify(stored);
  expect(blob).not.toContain('secret procedure note');
  expect(blob).not.toContain('UPI-REF-TRACE-0001');
  // Non-encrypted fields remain queryable plaintext.
  expect(stored.amount).toBe(500);
  expect(stored.paymentMethod).toBe('UPI');
  expect(stored.status).toBe('COMPLETED');
  expect(stored.referenceId).toBe('OPD-PAYTRACE1');
}

async function seedEncrypted(paymentId: string): Promise<void> {
  await PaymentModel.create(fullPayment(paymentId));
}

describe('Payment field encryption — full write-path trace (raw MongoDB)', () => {
  test('Model.create (save) stores ciphertext; the returned doc is plaintext', async () => {
    const created = await PaymentModel.create(fullPayment('pay-pt-001'));
    expect(created.description).toBe('OPD Consultation – secret procedure note');
    expect(created.transactionId).toBe('UPI-REF-TRACE-0001');
    assertAllCiphertext(await raw('pay-pt-001'));
  });

  test('reads round-trip both fields back to plaintext (hydrated + lean)', async () => {
    await seedEncrypted('pay-pt-002');

    const hydrated = await PaymentModel.findOne({ paymentId: 'pay-pt-002' });
    expect(hydrated?.description).toBe('OPD Consultation – secret procedure note');
    expect(hydrated?.transactionId).toBe('UPI-REF-TRACE-0001');

    const leaned = await PaymentModel.findOne({ paymentId: 'pay-pt-002' }).lean();
    expect((leaned as Record<string, unknown>).description).toBe('OPD Consultation – secret procedure note');
    expect((leaned as Record<string, unknown>).transactionId).toBe('UPI-REF-TRACE-0001');
  });

  test('insertMany cannot bypass encryption', async () => {
    await PaymentModel.insertMany([fullPayment('pay-pt-003')]);
    assertAllCiphertext(await raw('pay-pt-003'));
  });

  test('updateOne ($set) cannot bypass encryption', async () => {
    await seedEncrypted('pay-pt-004');
    await PaymentModel.updateOne(
      { paymentId: 'pay-pt-004' },
      { $set: { description: 'updated note', transactionId: 'UPI-NEW-1' } },
    );
    const stored = await raw('pay-pt-004');
    expect(stored.description).toMatch(ENVELOPE);
    expect(stored.transactionId).toMatch(ENVELOPE);
    const back = await PaymentModel.findOne({ paymentId: 'pay-pt-004' });
    expect(back?.description).toBe('updated note');
    expect(back?.transactionId).toBe('UPI-NEW-1');
  });

  test('updateMany cannot bypass encryption', async () => {
    await seedEncrypted('pay-pt-005');
    await PaymentModel.updateMany({ paymentId: 'pay-pt-005' }, { $set: { description: 'bulk note' } });
    expect((await raw('pay-pt-005')).description).toMatch(ENVELOPE);
  });

  test('bare (no-operator) update cannot bypass encryption', async () => {
    await seedEncrypted('pay-pt-006');
    await PaymentModel.updateOne({ paymentId: 'pay-pt-006' }, { transactionId: 'BARE-REF-9' });
    expect((await raw('pay-pt-006')).transactionId).toMatch(ENVELOPE);
  });

  test('findOneAndUpdate + $setOnInsert (upsert) cannot bypass encryption', async () => {
    await PaymentModel.findOneAndUpdate(
      { paymentId: 'pay-pt-007' },
      { $setOnInsert: fullPayment('pay-pt-007') },
      { upsert: true, new: true },
    );
    assertAllCiphertext(await raw('pay-pt-007'));
  });

  test('replaceOne cannot bypass encryption', async () => {
    await seedEncrypted('pay-pt-008');
    await PaymentModel.replaceOne(
      { paymentId: 'pay-pt-008' },
      { ...fullPayment('pay-pt-008'), description: 'replaced note', transactionId: 'REPL-REF-1' },
    );
    const stored = await raw('pay-pt-008');
    expect(stored.description).toMatch(ENVELOPE);
    expect(stored.transactionId).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('replaced note');
  });

  test('bulkWrite cannot bypass encryption', async () => {
    await seedEncrypted('pay-pt-009');
    await PaymentModel.bulkWrite([
      {
        updateOne: {
          filter: { paymentId: 'pay-pt-009' },
          update: { $set: { description: 'bulkwrite note', transactionId: 'BW-REF-1' } },
        },
      },
      { insertOne: { document: fullPayment('pay-pt-010') } },
    ]);
    const a = await raw('pay-pt-009');
    expect(a.description).toMatch(ENVELOPE);
    expect(a.transactionId).toMatch(ENVELOPE);
    assertAllCiphertext(await raw('pay-pt-010'));
  });

  test('legacy plaintext row stays readable, then encrypts on next write', async () => {
    await mongoose.connection.collection('payments').insertOne({
      paymentId:     'pay-pt-011',
      tenantId:      TENANT,
      patientId:     'PAT-PAYTRACE1',
      amount:        250,
      paymentMethod: 'CASH',
      description:   'Legacy plaintext description',
      status:        'COMPLETED',
      transactionId: 'LEGACY-TXN-123',
      createdBy:     'user-1',
      createdAt:     new Date(),
      updatedAt:     new Date(),
    });

    const before = await PaymentModel.findOne({ paymentId: 'pay-pt-011' });
    expect(before?.description).toBe('Legacy plaintext description');
    expect(before?.transactionId).toBe('LEGACY-TXN-123');

    await PaymentModel.updateOne({ paymentId: 'pay-pt-011' }, { $set: { status: 'FAILED' } });
    // status-only update didn't touch the encrypted fields — still plaintext at rest
    expect((await raw('pay-pt-011')).description).toBe('Legacy plaintext description');

    await PaymentModel.updateOne({ paymentId: 'pay-pt-011' }, { $set: { description: 'Revised description' } });
    expect((await raw('pay-pt-011')).description).toMatch(ENVELOPE);
    expect((await PaymentModel.findOne({ paymentId: 'pay-pt-011' }))?.description).toBe('Revised description');
    // untouched legacy transactionId still reads through
    expect((await PaymentModel.findOne({ paymentId: 'pay-pt-011' }))?.transactionId).toBe('LEGACY-TXN-123');
  });
});

describe('encrypt-payment-fields migration script', () => {
  const col = () => mongoose.connection.collection('payments');

  async function insertLegacy(paymentId: string, extra: Record<string, unknown> = {}): Promise<void> {
    await col().insertOne({
      paymentId,
      tenantId:      TENANT,
      patientId:     'PAT-PAYTRACE1',
      amount:        400,
      paymentMethod: 'UPI',
      description:   'Legacy description text',
      status:        'COMPLETED',
      transactionId: 'LEGACY-REF-999',
      createdBy:     'user-1',
      createdAt:     new Date(),
      updatedAt:     new Date(),
      ...extra,
    });
  }

  test('--dry-run reports but changes nothing', async () => {
    await insertLegacy('pay-mig-001');
    const n = await migratePaymentFields(col(), { dryRun: true });
    expect(n).toBe(0);
    const doc = await col().findOne({ paymentId: 'pay-mig-001' });
    expect(doc?.description).toBe('Legacy description text');
    expect(doc?.transactionId).toBe('LEGACY-REF-999');
  });

  test('encrypts every legacy field at rest; API still returns plaintext', async () => {
    await insertLegacy('pay-mig-002');
    const n = await migratePaymentFields(col());
    expect(n).toBe(1);

    const stored = await col().findOne({ paymentId: 'pay-mig-002' }) as Record<string, unknown>;
    expect(stored.description).toMatch(ENVELOPE);
    expect(stored.transactionId).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('Legacy description text');
    expect(JSON.stringify(stored)).not.toContain('LEGACY-REF-999');

    const doc = await PaymentModel.findOne({ paymentId: 'pay-mig-002' });
    expect(doc?.description).toBe('Legacy description text');
    expect(doc?.transactionId).toBe('LEGACY-REF-999');
  });

  test('is idempotent and never re-encrypts an already-encrypted value', async () => {
    await insertLegacy('pay-mig-003');
    await migratePaymentFields(col());
    const firstPass = await col().findOne({ paymentId: 'pay-mig-003' }) as Record<string, unknown>;

    const n2 = await migratePaymentFields(col());
    expect(n2).toBe(0);
    const secondPass = await col().findOne({ paymentId: 'pay-mig-003' }) as Record<string, unknown>;
    expect(secondPass.description).toBe(firstPass.description);
    expect(secondPass.transactionId).toBe(firstPass.transactionId);
  });

  test('leaves an already-encrypted row untouched and still encrypts a legacy one', async () => {
    await PaymentModel.create(fullPayment('pay-mig-004'));   // encrypted via the model
    await insertLegacy('pay-mig-005');

    const n = await migratePaymentFields(col());
    expect(n).toBe(1); // only the legacy row

    expect((await col().findOne({ paymentId: 'pay-mig-005' }))?.description as string).toMatch(ENVELOPE);
    const untouched = await PaymentModel.findOne({ paymentId: 'pay-mig-004' });
    expect(untouched?.description).toBe('OPD Consultation – secret procedure note');
  });

  test('migrates only the still-plaintext field on a partially-encrypted row', async () => {
    // description encrypted by the model; transactionId forced back to plaintext.
    await PaymentModel.create(fullPayment('pay-mig-006'));
    const encryptedDescription = (await col().findOne({ paymentId: 'pay-mig-006' }))?.description as string;
    await col().updateOne({ paymentId: 'pay-mig-006' }, { $set: { transactionId: 'PLAIN-TXN-ONLY' } });

    const n = await migratePaymentFields(col());
    expect(n).toBe(1);

    const stored = await col().findOne({ paymentId: 'pay-mig-006' }) as Record<string, unknown>;
    expect(stored.transactionId).toMatch(ENVELOPE);
    expect(stored.description).toBe(encryptedDescription); // untouched — no double-encryption
    expect((await PaymentModel.findOne({ paymentId: 'pay-mig-006' }))?.transactionId).toBe('PLAIN-TXN-ONLY');
  });
});
