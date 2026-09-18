import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { PathologyRequestModel, RadiologyRequestModel } from '../../../src/modules/lab/lab.model';
import { migrateLabNotes } from '../../../scripts/encrypt-lab-notes';

const ENVELOPE = /^enc:v1:/;
const TENANT = 'tenant-lab-trace';
const SECRET_NOTE = '<p>Patient has a sensitive HIV-positive history — confidential.</p>';

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
async function raw(collection: string, requestId: string): Promise<Record<string, unknown>> {
  const doc = await mongoose.connection.collection(collection).findOne({ requestId });
  if (!doc) throw new Error(`raw ${collection} ${requestId} not found`);
  return doc as Record<string, unknown>;
}

function pathologyDoc(requestId: string) {
  return {
    requestId,
    patientId:   'PAT-LABTRACE1',
    tenantId:    TENANT,
    requestedBy: 'user-1',
    testType:    'Complete Blood Count',
    notes:       SECRET_NOTE,
  };
}

function radiologyDoc(requestId: string) {
  return {
    requestId,
    patientId:   'PAT-LABTRACE1',
    tenantId:    TENANT,
    requestedBy: 'user-1',
    imagingType: 'Chest X-Ray',
    notes:       SECRET_NOTE,
  };
}

function assertNoteCiphertext(stored: Record<string, unknown>): void {
  expect(stored.notes).toEqual(expect.stringMatching(ENVELOPE));
  expect(JSON.stringify(stored)).not.toContain('HIV-positive');
  expect(JSON.stringify(stored)).not.toContain('confidential');
  // Non-encrypted fields remain queryable plaintext.
  expect(stored.tenantId).toBe(TENANT);
  expect(stored.patientId).toBe('PAT-LABTRACE1');
  expect(stored.status).toBe('PENDING');
}

describe.each([
  ['pathology_requests', PathologyRequestModel, pathologyDoc] as const,
  ['radiology_requests', RadiologyRequestModel, radiologyDoc] as const,
])('%s notes encryption — full write-path trace (raw MongoDB)', (collection, Model, makeDoc) => {
  const M = Model as unknown as import('mongoose').Model<Record<string, unknown>>;

  test('Model.create (save) stores ciphertext; the returned doc is plaintext', async () => {
    const created = await M.create(makeDoc('lab-pt-001'));
    expect((created as Record<string, unknown>).notes).toBe(SECRET_NOTE);
    assertNoteCiphertext(await raw(collection, 'lab-pt-001'));
  });

  test('reads round-trip notes back to plaintext (hydrated + lean)', async () => {
    await M.create(makeDoc('lab-pt-002'));

    const hydrated = await M.findOne({ requestId: 'lab-pt-002' });
    expect((hydrated as Record<string, unknown>).notes).toBe(SECRET_NOTE);

    const leaned = await M.findOne({ requestId: 'lab-pt-002' }).lean();
    expect((leaned as Record<string, unknown>).notes).toBe(SECRET_NOTE);
  });

  test('insertMany cannot bypass encryption', async () => {
    await M.insertMany([makeDoc('lab-pt-003')]);
    assertNoteCiphertext(await raw(collection, 'lab-pt-003'));
  });

  test('findOneAndUpdate ($set) cannot bypass encryption', async () => {
    await M.create(makeDoc('lab-pt-004'));
    await M.findOneAndUpdate(
      { requestId: 'lab-pt-004' },
      { $set: { notes: '<p>Revised confidential note</p>' } },
    );
    const stored = await raw(collection, 'lab-pt-004');
    expect(stored.notes).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('Revised confidential note');
    const back = await M.findOne({ requestId: 'lab-pt-004' });
    expect((back as Record<string, unknown>).notes).toBe('<p>Revised confidential note</p>');
  });

  test('updateOne ($set) cannot bypass encryption', async () => {
    await M.create(makeDoc('lab-pt-005'));
    await M.updateOne({ requestId: 'lab-pt-005' }, { $set: { notes: '<p>bulk note</p>' } });
    expect((await raw(collection, 'lab-pt-005')).notes).toMatch(ENVELOPE);
  });

  test('bulkWrite cannot bypass encryption', async () => {
    await M.create(makeDoc('lab-pt-006'));
    await M.bulkWrite([
      {
        updateOne: {
          filter: { requestId: 'lab-pt-006' },
          update: { $set: { notes: '<p>bulkwrite confidential note</p>' } },
        },
      },
      { insertOne: { document: makeDoc('lab-pt-007') } },
    ]);
    expect((await raw(collection, 'lab-pt-006')).notes).toMatch(ENVELOPE);
    assertNoteCiphertext(await raw(collection, 'lab-pt-007'));
  });

  test('a near-max-length note (whose ciphertext exceeds the old maxlength) still persists', async () => {
    const bigNote = '<p>' + 'x'.repeat(11_900) + '</p>'; // ~12 000 chars, near the Zod cap
    await M.create({ ...makeDoc('lab-pt-009'), notes: bigNote });
    expect((await raw(collection, 'lab-pt-009')).notes).toMatch(ENVELOPE);
    const back = await M.findOne({ requestId: 'lab-pt-009' });
    expect((back as Record<string, unknown>).notes).toBe(bigNote);
  });

  test('legacy plaintext row stays readable, then encrypts on next write', async () => {
    await mongoose.connection.collection(collection).insertOne({
      ...makeDoc('lab-pt-008'),
      status:      'PENDING',
      priority:    'NORMAL',
      isDeleted:   false,
      requestedAt: new Date(),
      createdAt:   new Date(),
      updatedAt:   new Date(),
    });

    const before = await M.findOne({ requestId: 'lab-pt-008' });
    expect((before as Record<string, unknown>).notes).toBe(SECRET_NOTE);

    await M.updateOne({ requestId: 'lab-pt-008' }, { $set: { status: 'COMPLETED' } });
    // status-only update didn't touch notes — still plaintext at rest
    expect((await raw(collection, 'lab-pt-008')).notes).toBe(SECRET_NOTE);

    await M.updateOne({ requestId: 'lab-pt-008' }, { $set: { notes: '<p>now encrypted</p>' } });
    expect((await raw(collection, 'lab-pt-008')).notes).toMatch(ENVELOPE);
    expect((await M.findOne({ requestId: 'lab-pt-008' }) as Record<string, unknown>).notes).toBe('<p>now encrypted</p>');
  });
});

describe('encrypt-lab-notes migration script', () => {
  const pathCol = () => mongoose.connection.collection('pathology_requests');

  async function insertLegacy(requestId: string): Promise<void> {
    await pathCol().insertOne({
      ...pathologyDoc(requestId),
      notes:       SECRET_NOTE,
      status:      'PENDING',
      priority:    'NORMAL',
      isDeleted:   false,
      requestedAt: new Date(),
      createdAt:   new Date(),
      updatedAt:   new Date(),
    });
  }

  test('--dry-run reports but changes nothing', async () => {
    await insertLegacy('lab-mig-001');
    const n = await migrateLabNotes(pathCol(), { dryRun: true });
    expect(n).toBe(0);
    expect((await pathCol().findOne({ requestId: 'lab-mig-001' }))?.notes).toBe(SECRET_NOTE);
  });

  test('encrypts the legacy notes at rest; API still returns plaintext', async () => {
    await insertLegacy('lab-mig-002');
    const n = await migrateLabNotes(pathCol());
    expect(n).toBe(1);

    const stored = await pathCol().findOne({ requestId: 'lab-mig-002' }) as Record<string, unknown>;
    expect(stored.notes).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('HIV-positive');

    const doc = await PathologyRequestModel.findOne({ requestId: 'lab-mig-002' });
    expect(doc?.notes).toBe(SECRET_NOTE);
  });

  test('is idempotent and never re-encrypts an already-encrypted value', async () => {
    await insertLegacy('lab-mig-003');
    await migrateLabNotes(pathCol());
    const firstPass = await pathCol().findOne({ requestId: 'lab-mig-003' }) as Record<string, unknown>;

    const n2 = await migrateLabNotes(pathCol());
    expect(n2).toBe(0);
    const secondPass = await pathCol().findOne({ requestId: 'lab-mig-003' }) as Record<string, unknown>;
    expect(secondPass.notes).toBe(firstPass.notes);
  });

  test('leaves an already-encrypted row untouched and still encrypts a legacy one', async () => {
    await PathologyRequestModel.create(pathologyDoc('lab-mig-004')); // encrypted via the model
    await insertLegacy('lab-mig-005');

    const n = await migrateLabNotes(pathCol());
    expect(n).toBe(1); // only the legacy row

    expect((await pathCol().findOne({ requestId: 'lab-mig-005' }))?.notes as string).toMatch(ENVELOPE);
    const untouched = await PathologyRequestModel.findOne({ requestId: 'lab-mig-004' });
    expect(untouched?.notes).toBe(SECRET_NOTE);
  });

  test('a null-notes row is not matched or modified', async () => {
    await pathCol().insertOne({
      ...pathologyDoc('lab-mig-006'),
      notes:       null,
      status:      'PENDING',
      isDeleted:   false,
      requestedAt: new Date(),
    });
    const n = await migrateLabNotes(pathCol());
    expect(n).toBe(0);
    expect((await pathCol().findOne({ requestId: 'lab-mig-006' }))?.notes).toBeNull();
  });
});
