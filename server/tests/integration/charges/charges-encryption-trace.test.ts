import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { ChargeModel } from '../../../src/modules/charges/charges.model';
import { migrateChargeFields } from '../../../scripts/encrypt-charge-fields';

const ENVELOPE = /^enc:v1:/;
const TENANT = 'tenant-charge-trace';
const SECRET_DESC = 'Termination of pregnancy — counselling & procedure';

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
async function raw(chargeId: string): Promise<Record<string, unknown>> {
  const doc = await mongoose.connection.collection('charges').findOne({ chargeId });
  if (!doc) throw new Error(`raw charge ${chargeId} not found`);
  return doc as Record<string, unknown>;
}

function chargeDoc(chargeId: string) {
  return {
    chargeId,
    tenantId:    TENANT,
    patientId:   'PAT-CHGTRACE1',
    category:    'PROCEDURE',
    description: SECRET_DESC,
    amount:      1200,
    addedBy:     'user-1',
    status:      'UNPAID',
  };
}

function assertDescCiphertext(stored: Record<string, unknown>): void {
  expect(stored.description).toEqual(expect.stringMatching(ENVELOPE));
  expect(JSON.stringify(stored)).not.toContain('Termination of pregnancy');
  // Non-encrypted fields remain queryable plaintext.
  expect(stored.amount).toBe(1200);
  expect(stored.category).toBe('PROCEDURE');
  expect(stored.status).toBe('UNPAID');
  expect(stored.patientId).toBe('PAT-CHGTRACE1');
}

describe('Charge description encryption — full write-path trace (raw MongoDB)', () => {
  test('Model.create (save) stores ciphertext; the returned doc is plaintext', async () => {
    const created = await ChargeModel.create(chargeDoc('chg-pt-001'));
    expect(created.description).toBe(SECRET_DESC);
    assertDescCiphertext(await raw('chg-pt-001'));
  });

  test('reads round-trip description back to plaintext (hydrated + lean)', async () => {
    await ChargeModel.create(chargeDoc('chg-pt-002'));

    const hydrated = await ChargeModel.findOne({ chargeId: 'chg-pt-002' });
    expect(hydrated?.description).toBe(SECRET_DESC);

    const leaned = await ChargeModel.findOne({ chargeId: 'chg-pt-002' }).lean();
    expect((leaned as Record<string, unknown>).description).toBe(SECRET_DESC);

    // list()-style lean find also decrypts
    const [row] = await ChargeModel.find({ tenantId: TENANT, patientId: 'PAT-CHGTRACE1' }).lean();
    expect((row as Record<string, unknown>).description).toBe(SECRET_DESC);
  });

  test('insertMany cannot bypass encryption', async () => {
    await ChargeModel.insertMany([chargeDoc('chg-pt-003')]);
    assertDescCiphertext(await raw('chg-pt-003'));
  });

  test('findOneAndUpdate ($set) cannot bypass encryption', async () => {
    await ChargeModel.create(chargeDoc('chg-pt-004'));
    await ChargeModel.findOneAndUpdate(
      { chargeId: 'chg-pt-004' },
      { $set: { description: 'Revised sensitive description' } },
      { new: true },
    );
    const stored = await raw('chg-pt-004');
    expect(stored.description).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('Revised sensitive description');
    const back = await ChargeModel.findOne({ chargeId: 'chg-pt-004' });
    expect(back?.description).toBe('Revised sensitive description');
  });

  test('a status-only findOneAndUpdate leaves the returned description readable', async () => {
    await ChargeModel.create(chargeDoc('chg-pt-005'));
    const updated = await ChargeModel.findOneAndUpdate(
      { chargeId: 'chg-pt-005', status: 'UNPAID' },
      { status: 'PAID', paidBy: 'user-2', paidAt: new Date() },
      { new: true },
    );
    // markPaid() builds the auto-Payment description from exactly this value.
    expect(updated?.description).toBe(SECRET_DESC);
    expect((await raw('chg-pt-005')).description).toMatch(ENVELOPE);
  });

  test('bulkWrite cannot bypass encryption', async () => {
    await ChargeModel.create(chargeDoc('chg-pt-006'));
    await ChargeModel.bulkWrite([
      {
        updateOne: {
          filter: { chargeId: 'chg-pt-006' },
          update: { $set: { description: 'bulkwrite sensitive description' } },
        },
      },
      { insertOne: { document: chargeDoc('chg-pt-007') } },
    ]);
    expect((await raw('chg-pt-006')).description).toMatch(ENVELOPE);
    assertDescCiphertext(await raw('chg-pt-007'));
  });

  test('a max-length description (whose ciphertext exceeds the old maxlength) still persists', async () => {
    const bigDesc = 'D'.repeat(500); // the Zod cap
    await ChargeModel.create({ ...chargeDoc('chg-pt-009'), description: bigDesc });
    expect((await raw('chg-pt-009')).description).toMatch(ENVELOPE);
    expect((await ChargeModel.findOne({ chargeId: 'chg-pt-009' }))?.description).toBe(bigDesc);
  });

  test('legacy plaintext row stays readable, then encrypts on next write', async () => {
    await mongoose.connection.collection('charges').insertOne({
      ...chargeDoc('chg-pt-008'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const before = await ChargeModel.findOne({ chargeId: 'chg-pt-008' });
    expect(before?.description).toBe(SECRET_DESC);

    await ChargeModel.updateOne({ chargeId: 'chg-pt-008' }, { $set: { status: 'CANCELLED' } });
    expect((await raw('chg-pt-008')).description).toBe(SECRET_DESC); // untouched, still plaintext

    await ChargeModel.updateOne({ chargeId: 'chg-pt-008' }, { $set: { description: 'now encrypted' } });
    expect((await raw('chg-pt-008')).description).toMatch(ENVELOPE);
    expect((await ChargeModel.findOne({ chargeId: 'chg-pt-008' }))?.description).toBe('now encrypted');
  });
});

describe('encrypt-charge-fields migration script', () => {
  const col = () => mongoose.connection.collection('charges');

  async function insertLegacy(chargeId: string): Promise<void> {
    await col().insertOne({
      ...chargeDoc(chargeId),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  test('--dry-run reports but changes nothing', async () => {
    await insertLegacy('chg-mig-001');
    const n = await migrateChargeFields(col(), { dryRun: true });
    expect(n).toBe(0);
    expect((await col().findOne({ chargeId: 'chg-mig-001' }))?.description).toBe(SECRET_DESC);
  });

  test('encrypts the legacy description at rest; API still returns plaintext', async () => {
    await insertLegacy('chg-mig-002');
    const n = await migrateChargeFields(col());
    expect(n).toBe(1);

    const stored = await col().findOne({ chargeId: 'chg-mig-002' }) as Record<string, unknown>;
    expect(stored.description).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('Termination of pregnancy');

    const doc = await ChargeModel.findOne({ chargeId: 'chg-mig-002' });
    expect(doc?.description).toBe(SECRET_DESC);
  });

  test('is idempotent and never re-encrypts an already-encrypted value', async () => {
    await insertLegacy('chg-mig-003');
    await migrateChargeFields(col());
    const firstPass = await col().findOne({ chargeId: 'chg-mig-003' }) as Record<string, unknown>;

    const n2 = await migrateChargeFields(col());
    expect(n2).toBe(0);
    const secondPass = await col().findOne({ chargeId: 'chg-mig-003' }) as Record<string, unknown>;
    expect(secondPass.description).toBe(firstPass.description);
  });

  test('leaves an already-encrypted row untouched and still encrypts a legacy one', async () => {
    await ChargeModel.create(chargeDoc('chg-mig-004')); // encrypted via the model
    await insertLegacy('chg-mig-005');

    const n = await migrateChargeFields(col());
    expect(n).toBe(1); // only the legacy row

    expect((await col().findOne({ chargeId: 'chg-mig-005' }))?.description as string).toMatch(ENVELOPE);
    const untouched = await ChargeModel.findOne({ chargeId: 'chg-mig-004' });
    expect(untouched?.description).toBe(SECRET_DESC);
  });
});
