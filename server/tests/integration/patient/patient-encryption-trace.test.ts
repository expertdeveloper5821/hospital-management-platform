import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { PatientModel } from '../../../src/modules/patient/patient.model';
import { Gender } from '../../../src/modules/patient/patient.types';
import { migratePatientPii } from '../../../scripts/encrypt-patient-pii';

const ENVELOPE = /^enc:v1:/;
const TENANT = 'tenant-pii-trace';

// Every field the Patient model encrypts at rest.
const ENC_FIELDS = [
  'aadhaarNumber', 'dateOfBirth', 'bloodGroup',
  'emergencyContactName', 'emergencyContactMobile',
  'address', 'addressLine1', 'addressLine2', 'city', 'state', 'country', 'pincode',
] as const;

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
async function raw(patientId: string): Promise<Record<string, unknown>> {
  const doc = await mongoose.connection.collection('patients').findOne({ patientId });
  if (!doc) throw new Error(`raw patient ${patientId} not found`);
  return doc as Record<string, unknown>;
}

function fullPii(patientId: string) {
  return {
    patientId,
    tenantId:     TENANT,
    fullName:     'Trace Person',
    dateOfBirth:  '1985-07-21',
    gender:       Gender.FEMALE,
    mobileNumber: '9800000001',
    aadhaarNumber: '123456789012',
    bloodGroup:   'AB-',
    emergencyContactName:   'Kin Cipher',
    emergencyContactMobile: '9811122233',
    address:      '10 Encrypted Ave',
    addressLine1: 'Suite 5',
    addressLine2: 'Old Quarter',
    city:         'Cipherville',
    state:        'Secretstate',
    country:      'Nowhereland',
    pincode:      '424242',
  };
}

function assertAllCiphertext(stored: Record<string, unknown>): void {
  for (const f of ENC_FIELDS) {
    expect({ field: f, value: stored[f] }).toEqual({ field: f, value: expect.stringMatching(ENVELOPE) });
  }
  const blob = JSON.stringify(stored);
  expect(blob).not.toContain('Encrypted Ave');
  expect(blob).not.toContain('Cipherville');
  expect(blob).not.toContain('424242');
  expect(blob).not.toContain('1985-07-21');
  expect(blob).not.toContain('AB-');
  expect(blob).not.toContain('Kin Cipher');
  expect(blob).not.toContain('9811122233');
}

async function seedEncrypted(patientId: string): Promise<void> {
  await PatientModel.create(fullPii(patientId));
}

describe('Patient PII encryption — full write-path trace (raw MongoDB)', () => {
  test('Model.create (save) stores ciphertext; the returned doc is plaintext', async () => {
    const created = await PatientModel.create(fullPii('PAT-PT001'));
    expect(created.address).toBe('10 Encrypted Ave');
    expect(created.dateOfBirth).toBe('1985-07-21T00:00:00.000Z'); // Date-normalised, plaintext
    assertAllCiphertext(await raw('PAT-PT001'));
  });

  test('reads round-trip every field back to plaintext', async () => {
    await seedEncrypted('PAT-PT002');
    const hydrated = await PatientModel.findOne({ patientId: 'PAT-PT002' });
    expect(hydrated?.address).toBe('10 Encrypted Ave');
    expect(hydrated?.pincode).toBe('424242');
    expect(hydrated?.dateOfBirth).toBe('1985-07-21T00:00:00.000Z');
    expect(hydrated?.emergencyContactName).toBe('Kin Cipher');
    expect(hydrated?.emergencyContactMobile).toBe('9811122233');

    const leaned = await PatientModel.findOne({ patientId: 'PAT-PT002' }).lean();
    expect((leaned as Record<string, unknown>).city).toBe('Cipherville');
    expect((leaned as Record<string, unknown>).dateOfBirth).toBe('1985-07-21T00:00:00.000Z');
  });

  test('insertMany cannot bypass encryption', async () => {
    await PatientModel.insertMany([fullPii('PAT-PT003')]);
    assertAllCiphertext(await raw('PAT-PT003'));
  });

  test('updateOne ($set) cannot bypass encryption', async () => {
    await seedEncrypted('PAT-PT004');
    await PatientModel.updateOne(
      { patientId: 'PAT-PT004' },
      { $set: { address: 'Updated Road', city: 'Newtown', bloodGroup: 'O+', emergencyContactName: 'New Kin', emergencyContactMobile: '9822000111', dateOfBirth: new Date('1991-03-03T00:00:00.000Z') } },
    );
    const stored = await raw('PAT-PT004');
    expect(stored.address).toMatch(ENVELOPE);
    expect(stored.city).toMatch(ENVELOPE);
    expect(stored.bloodGroup).toMatch(ENVELOPE);
    expect(stored.emergencyContactName).toMatch(ENVELOPE);
    expect(stored.emergencyContactMobile).toMatch(ENVELOPE);
    expect(stored.dateOfBirth).toMatch(ENVELOPE);
    const back004 = await PatientModel.findOne({ patientId: 'PAT-PT004' });
    expect(back004?.bloodGroup).toBe('O+');
    expect(back004?.emergencyContactName).toBe('New Kin');
    expect(back004?.emergencyContactMobile).toBe('9822000111');
  });

  test('updateMany cannot bypass encryption', async () => {
    await seedEncrypted('PAT-PT005');
    await PatientModel.updateMany({ patientId: 'PAT-PT005' }, { $set: { state: 'Bulkstate' } });
    expect((await raw('PAT-PT005')).state).toMatch(ENVELOPE);
  });

  test('bare (no-operator) update cannot bypass encryption', async () => {
    await seedEncrypted('PAT-PT006');
    await PatientModel.updateOne({ patientId: 'PAT-PT006' }, { pincode: '000111' });
    expect((await raw('PAT-PT006')).pincode).toMatch(ENVELOPE);
  });

  test('findOneAndUpdate + $setOnInsert (upsert) cannot bypass encryption', async () => {
    await PatientModel.findOneAndUpdate(
      { patientId: 'PAT-PT007' },
      { $setOnInsert: fullPii('PAT-PT007') },
      { upsert: true, new: true },
    );
    assertAllCiphertext(await raw('PAT-PT007'));
  });

  test('replaceOne cannot bypass encryption', async () => {
    await seedEncrypted('PAT-PT008');
    await PatientModel.replaceOne({ patientId: 'PAT-PT008' }, {
      ...fullPii('PAT-PT008'),
      address: 'Replaced Blvd',
      city:    'Replacetown',
    });
    const stored = await raw('PAT-PT008');
    expect(stored.address).toMatch(ENVELOPE);
    expect(stored.city).toMatch(ENVELOPE);
    expect(stored.dateOfBirth).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('Replaced Blvd');
  });

  test('bulkWrite cannot bypass encryption', async () => {
    await seedEncrypted('PAT-PT009');
    await PatientModel.bulkWrite([
      {
        updateOne: {
          filter: { patientId: 'PAT-PT009' },
          update: { $set: { address: 'Bulk Street', country: 'Bulkland', dateOfBirth: '1970-12-25' } },
        },
      },
      { insertOne: { document: fullPii('PAT-PT010') } },
    ]);
    const a = await raw('PAT-PT009');
    expect(a.address).toMatch(ENVELOPE);
    expect(a.country).toMatch(ENVELOPE);
    expect(a.dateOfBirth).toMatch(ENVELOPE);
    assertAllCiphertext(await raw('PAT-PT010'));
  });

  test('legacy plaintext row with a BSON Date dateOfBirth reads back as ISO, encrypts on next write', async () => {
    await mongoose.connection.collection('patients').insertOne({
      patientId:    'PAT-PT011',
      tenantId:     TENANT,
      fullName:     'Legacy Trace',
      dateOfBirth:  new Date('1960-01-01T00:00:00.000Z'),
      gender:       Gender.MALE,
      mobileNumber: '9800000011',
      address:      'Legacy Ave',
      city:         'Legacyville',
      isDeleted:    false,
      createdAt:    new Date(),
      updatedAt:    new Date(),
    });

    const before = await PatientModel.findOne({ patientId: 'PAT-PT011' });
    expect(before?.address).toBe('Legacy Ave');
    expect(before?.dateOfBirth).toBe('1960-01-01T00:00:00.000Z');

    await PatientModel.updateOne({ patientId: 'PAT-PT011' }, { $set: { city: 'Migratedville' } });
    const stored = await raw('PAT-PT011');
    expect(stored.city).toMatch(ENVELOPE);

    const after = await PatientModel.findOne({ patientId: 'PAT-PT011' });
    expect(after?.city).toBe('Migratedville');
    expect(after?.dateOfBirth).toBe('1960-01-01T00:00:00.000Z');
  });
});

describe('encrypt-patient-pii migration script', () => {
  const col = () => mongoose.connection.collection('patients');

  async function insertLegacy(patientId: string, extra: Record<string, unknown> = {}): Promise<void> {
    await col().insertOne({
      patientId,
      tenantId:     TENANT,
      fullName:     'Legacy',
      dateOfBirth:  new Date('1980-08-08T00:00:00.000Z'),
      gender:       Gender.MALE,
      mobileNumber: '9700000000',
      bloodGroup:   'A+',
      emergencyContactName:   'Legacy Kin',
      emergencyContactMobile: '9700000009',
      address:      '5 Plaintext Row',
      addressLine1: 'Block A',
      addressLine2: 'Wing B',
      city:         'Plaincity',
      state:        'Plainstate',
      country:      'Plainland',
      pincode:      '500500',
      isDeleted:    false,
      createdAt:    new Date(),
      updatedAt:    new Date(),
      ...extra,
    });
  }

  test('--dry-run reports but changes nothing', async () => {
    await insertLegacy('PAT-MIG001');
    const n = await migratePatientPii(col(), { dryRun: true });
    expect(n).toBe(0);
    const raw = await col().findOne({ patientId: 'PAT-MIG001' });
    expect(raw?.address).toBe('5 Plaintext Row');
    expect(raw?.dateOfBirth).toBeInstanceOf(Date);
  });

  test('encrypts every legacy PII field at rest, incl. a BSON Date dateOfBirth', async () => {
    await insertLegacy('PAT-MIG002');
    const n = await migratePatientPii(col());
    expect(n).toBe(1);

    const raw = await col().findOne({ patientId: 'PAT-MIG002' }) as Record<string, unknown>;
    for (const f of ENC_FIELDS.filter((x) => x !== 'aadhaarNumber')) {
      expect(raw[f]).toMatch(ENVELOPE);
    }
    expect(JSON.stringify(raw)).not.toContain('Plaintext Row');
    expect(JSON.stringify(raw)).not.toContain('500500');
    expect(JSON.stringify(raw)).not.toContain('Legacy Kin');
    expect(JSON.stringify(raw)).not.toContain('9700000009');
    expect(raw.emergencyContactName).toMatch(ENVELOPE);
    expect(raw.emergencyContactMobile).toMatch(ENVELOPE);

    // API still returns the original plaintext, dateOfBirth in ISO shape.
    const doc = await PatientModel.findOne({ patientId: 'PAT-MIG002' });
    expect(doc?.address).toBe('5 Plaintext Row');
    expect(doc?.pincode).toBe('500500');
    expect(doc?.bloodGroup).toBe('A+');
    expect(doc?.dateOfBirth).toBe('1980-08-08T00:00:00.000Z');
    expect(doc?.emergencyContactName).toBe('Legacy Kin');
    expect(doc?.emergencyContactMobile).toBe('9700000009');
  });

  test('is idempotent and never re-encrypts an already-encrypted value', async () => {
    await insertLegacy('PAT-MIG003');
    await migratePatientPii(col());
    const firstPass = await col().findOne({ patientId: 'PAT-MIG003' }) as Record<string, unknown>;

    const n2 = await migratePatientPii(col());
    expect(n2).toBe(0);
    const secondPass = await col().findOne({ patientId: 'PAT-MIG003' }) as Record<string, unknown>;
    expect(secondPass.address).toBe(firstPass.address);
    expect(secondPass.dateOfBirth).toBe(firstPass.dateOfBirth);
  });

  test('leaves an already-migrated row untouched and still encrypts a mixed legacy row', async () => {
    // one already fully encrypted, one still plaintext
    await PatientModel.create(fullPii('PAT-MIG004'));           // encrypted via the model
    await insertLegacy('PAT-MIG005');

    const n = await migratePatientPii(col());
    expect(n).toBe(1); // only the legacy row

    expect((await col().findOne({ patientId: 'PAT-MIG005' }))?.city as string).toMatch(ENVELOPE);
    // untouched row still round-trips
    const untouched = await PatientModel.findOne({ patientId: 'PAT-MIG004' });
    expect(untouched?.city).toBe('Cipherville');
  });
});
