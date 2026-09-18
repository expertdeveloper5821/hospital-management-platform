import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { OPDVisitModel } from '../../../src/modules/opd/opd.model';
import { opdRepository } from '../../../src/modules/opd/opd.repository';
import { opdService } from '../../../src/modules/opd/opd.service';
import { OPDVisitStatus } from '../../../src/modules/opd/opd.types';
import { UserRole } from '../../../src/shared/types/common.types';
import { migrateOpdVitals } from '../../../scripts/encrypt-opd-vitals';

jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/modules/patient/patient.repository', () => ({
  patientRepository: {
    findByPatientId:      jest.fn().mockResolvedValue({ patientId: 'PAT-TRACE01', fullName: 'Trace Patient' }),
    findNamesByPatientIds: jest.fn().mockResolvedValue(new Map()),
  },
}));

const ENVELOPE = /^enc:v1:/;
const TENANT = 'tenant-trace';

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

// Raw driver read — NO Mongoose middleware, so this is the exact BSON on disk.
async function rawDoc(visitId: string): Promise<Record<string, unknown>> {
  const doc = await mongoose.connection.collection('opd_visits').findOne({ visitId });
  if (!doc) throw new Error(`raw doc ${visitId} not found`);
  return doc as Record<string, unknown>;
}

async function seedOpenVisit(visitId: string): Promise<void> {
  await OPDVisitModel.create({
    visitId,
    tenantId:     TENANT,
    patientId:    'PAT-TRACE01',
    doctorIds:    ['doctor-1'],
    nurseIds:     [],
    departmentId: null,
    visitDate:    new Date('2026-05-15T00:00:00.000Z'),
    queueNumber:  1,
    status:       OPDVisitStatus.OPEN,
    diagnosis:    null,
    prescription: null,
    notes:        null,
  });
}

// Every clinical free-text field the plugin encrypts. `notes` is sanitized
// rich-text HTML in production, so a representative tag is included here.
const CLINICAL = {
  diagnosis:    'Bacterial pharyngitis',
  prescription: 'Amoxicillin 500mg',
  notes:        '<p>Follow-up in <strong>1 week</strong>; hydrate well.</p>',
} as const;

function assertAllCiphertext(stored: Record<string, unknown>): void {
  expect(stored.diagnosis).toMatch(ENVELOPE);
  expect(stored.prescription).toMatch(ENVELOPE);
  expect(stored.notes).toMatch(ENVELOPE);
  const blob = JSON.stringify(stored);
  expect(blob).not.toContain('pharyngitis');
  expect(blob).not.toContain('Amoxicillin');
  expect(blob).not.toContain('Follow-up in');
}

describe('OPD clinical-field encryption — full write-path trace', () => {
  test('service.completeVisit → repository.update → findOneAndUpdate stores ciphertext', async () => {
    await seedOpenVisit('OPD-TRACE001');

    await opdService.completeVisit(
      TENANT,
      'OPD-TRACE001',
      { diagnosis: CLINICAL.diagnosis, prescription: CLINICAL.prescription, notes: CLINICAL.notes },
      'doctor-1',
    );

    assertAllCiphertext(await rawDoc('OPD-TRACE001'));
  });

  test('service.updateVisit → repository.update stores ciphertext and round-trips', async () => {
    await seedOpenVisit('OPD-TRACE002');

    await opdService.updateVisit(
      TENANT,
      'OPD-TRACE002',
      { diagnosis: 'Migraine w/ aura', prescription: 'Sumatriptan PRN', notes: '<p>Rest in a dark room.</p>' },
      'doctor-1',
      UserRole.DOCTOR,
    );

    const stored = await rawDoc('OPD-TRACE002');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.notes).toMatch(ENVELOPE);

    const readBack = await opdRepository.findByVisitId(TENANT, 'OPD-TRACE002');
    expect(readBack?.diagnosis).toBe('Migraine w/ aura');
    expect(readBack?.prescription).toBe('Sumatriptan PRN');
    expect(readBack?.notes).toBe('<p>Rest in a dark room.</p>');
  });

  test('service.createVisit → repository.save → Model.create stores notes as ciphertext', async () => {
    const created = await opdService.createVisit(
      TENANT,
      { patientId: 'PAT-TRACE01', doctorIds: ['doctor-1'], notes: '<p>New patient intake note.</p>' },
      'reception-1',
      UserRole.RECEPTIONIST,
    );

    // The value handed back to the caller is plaintext (post-save decrypt)…
    expect(created.notes).toBe('<p>New patient intake note.</p>');
    // …but what landed in MongoDB is ciphertext.
    const stored = await rawDoc(created.visitId);
    expect(stored.notes).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('intake note');
  });

  // ── The paths the plugin must also cover, exercised directly on the model ──

  test('Model.updateOne cannot bypass encryption', async () => {
    await seedOpenVisit('OPD-TRACE003');
    await OPDVisitModel.updateOne(
      { tenantId: TENANT, visitId: 'OPD-TRACE003' },
      { $set: { diagnosis: 'updateOne dx', prescription: 'updateOne rx', notes: 'updateOne notes' } },
    );
    const stored = await rawDoc('OPD-TRACE003');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.prescription).toMatch(ENVELOPE);
    expect(stored.notes).toMatch(ENVELOPE);
  });

  test('Model.updateMany cannot bypass encryption', async () => {
    await seedOpenVisit('OPD-TRACE004');
    await OPDVisitModel.updateMany(
      { tenantId: TENANT, visitId: 'OPD-TRACE004' },
      { $set: { diagnosis: 'updateMany dx', notes: 'updateMany notes' } },
    );
    const stored = await rawDoc('OPD-TRACE004');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.notes).toMatch(ENVELOPE);
  });

  test('bare (no-operator) update object cannot bypass encryption', async () => {
    await seedOpenVisit('OPD-TRACE005');
    await OPDVisitModel.updateOne(
      { tenantId: TENANT, visitId: 'OPD-TRACE005' },
      { diagnosis: 'bare-update dx', notes: 'bare-update notes' },
    );
    const stored = await rawDoc('OPD-TRACE005');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.notes).toMatch(ENVELOPE);
  });

  test('findOneAndUpdate with $setOnInsert (upsert) cannot bypass encryption', async () => {
    await OPDVisitModel.findOneAndUpdate(
      { tenantId: TENANT, visitId: 'OPD-TRACE006' },
      {
        $setOnInsert: {
          tenantId:     TENANT,
          patientId:    'PAT-TRACE01',
          doctorIds:    ['doctor-1'],
          visitDate:    new Date('2026-05-15T00:00:00.000Z'),
          queueNumber:  1,
          status:       OPDVisitStatus.COMPLETED,
          diagnosis:    'setOnInsert dx',
          prescription: 'setOnInsert rx',
          notes:        'setOnInsert notes',
        },
      },
      { upsert: true, new: true },
    );
    const stored = await rawDoc('OPD-TRACE006');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.prescription).toMatch(ENVELOPE);
    expect(stored.notes).toMatch(ENVELOPE);
  });

  test('replaceOne cannot bypass encryption', async () => {
    await seedOpenVisit('OPD-TRACE007');
    await OPDVisitModel.replaceOne(
      { tenantId: TENANT, visitId: 'OPD-TRACE007' },
      {
        visitId:      'OPD-TRACE007',
        tenantId:     TENANT,
        patientId:    'PAT-TRACE01',
        doctorIds:    ['doctor-1'],
        nurseIds:     [],
        departmentId: null,
        visitDate:    new Date('2026-05-15T00:00:00.000Z'),
        queueNumber:  1,
        status:       OPDVisitStatus.COMPLETED,
        diagnosis:    'replaceOne dx',
        prescription: 'replaceOne rx',
        notes:        'replaceOne notes',
      },
    );
    const stored = await rawDoc('OPD-TRACE007');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.notes).toMatch(ENVELOPE);
  });

  test('insertMany cannot bypass encryption', async () => {
    await OPDVisitModel.insertMany([
      {
        visitId:      'OPD-TRACE008',
        tenantId:     TENANT,
        patientId:    'PAT-TRACE01',
        doctorIds:    ['doctor-1'],
        visitDate:    new Date('2026-05-15T00:00:00.000Z'),
        queueNumber:  1,
        status:       OPDVisitStatus.COMPLETED,
        diagnosis:    'insertMany dx',
        prescription: 'insertMany rx',
        notes:        'insertMany notes',
      },
    ]);
    const stored = await rawDoc('OPD-TRACE008');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.prescription).toMatch(ENVELOPE);
    expect(stored.notes).toMatch(ENVELOPE);
  });

  test('bulkWrite cannot bypass encryption', async () => {
    await seedOpenVisit('OPD-TRACE009');
    await OPDVisitModel.bulkWrite([
      {
        updateOne: {
          filter: { tenantId: TENANT, visitId: 'OPD-TRACE009' },
          update: { $set: { diagnosis: 'bulkWrite dx', prescription: 'bulkWrite rx', notes: 'bulkWrite notes' } },
        },
      },
    ]);
    const stored = await rawDoc('OPD-TRACE009');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.prescription).toMatch(ENVELOPE);
    expect(stored.notes).toMatch(ENVELOPE);
  });

  test('legacy plaintext notes read back unchanged, then encrypt on next write', async () => {
    // Raw insert — lands as plaintext, exactly like a pre-encryption row.
    await mongoose.connection.collection('opd_visits').insertOne({
      visitId:      'OPD-TRACE010',
      tenantId:     TENANT,
      patientId:    'PAT-TRACE01',
      doctorIds:    ['doctor-1'],
      nurseIds:     [],
      departmentId: null,
      visitDate:    new Date('2026-05-15T00:00:00.000Z'),
      queueNumber:  1,
      status:       OPDVisitStatus.OPEN,
      diagnosis:    null,
      prescription: null,
      notes:        '<p>Legacy plaintext note.</p>',
      createdAt:    new Date('2026-05-15T00:00:00.000Z'),
      updatedAt:    new Date('2026-05-15T00:00:00.000Z'),
    });

    const beforeWrite = await opdRepository.findByVisitId(TENANT, 'OPD-TRACE010');
    expect(beforeWrite?.notes).toBe('<p>Legacy plaintext note.</p>');

    await opdService.updateVisit(
      TENANT, 'OPD-TRACE010', { notes: '<p>Updated note.</p>' }, 'doctor-1', UserRole.DOCTOR,
    );
    expect((await rawDoc('OPD-TRACE010')).notes).toMatch(ENVELOPE);
    expect((await opdRepository.findByVisitId(TENANT, 'OPD-TRACE010'))?.notes).toBe('<p>Updated note.</p>');
  });
});

// ── vitals: weight/height/sugar/bodyTemperature (numeric) + bloodPressure ──
const VITALS = {
  weight:          72.5,
  height:          171,
  bloodPressure:   '120/80',
  sugar:           95,
  bodyTemperature: 98.6,
} as const;

function rawVitals(stored: Record<string, unknown>): Record<string, unknown> {
  return (stored.vitals ?? {}) as Record<string, unknown>;
}

function assertVitalsCiphertext(stored: Record<string, unknown>): void {
  const v = rawVitals(stored);
  expect(v.weight).toEqual(expect.stringMatching(ENVELOPE));
  expect(v.height).toEqual(expect.stringMatching(ENVELOPE));
  expect(v.sugar).toEqual(expect.stringMatching(ENVELOPE));
  expect(v.bodyTemperature).toEqual(expect.stringMatching(ENVELOPE));
  expect(v.bloodPressure).toEqual(expect.stringMatching(ENVELOPE));
  expect(JSON.stringify(stored)).not.toContain('120/80');
}

// A hydrated document's `vitals` is a live Mongoose subdocument, not a plain
// object — comparing it directly with `toEqual` walks its internal
// getters/bookkeeping and blows up under Jest's strict-mode check. Extract
// the plain fields first, exactly like opd.controller.ts's toResponse() does
// for the same reason.
function pickVitals(v: {
  weight: number | null; height: number | null; bloodPressure: string | null;
  sugar: number | null; bodyTemperature: number | null;
}) {
  return {
    weight: v.weight, height: v.height, bloodPressure: v.bloodPressure,
    sugar: v.sugar, bodyTemperature: v.bodyTemperature,
  };
}

describe('OPD vitals encryption — full write-path trace, Create → Save → Fetch → Edit → Fetch', () => {
  test('service.updateVisit stores every vitals sub-field as ciphertext at rest', async () => {
    await seedOpenVisit('OPD-VIT001');

    await opdService.updateVisit(
      TENANT, 'OPD-VIT001', { vitals: { ...VITALS } }, 'doctor-1', UserRole.DOCTOR,
    );

    assertVitalsCiphertext(await rawDoc('OPD-VIT001'));
  });

  test('hydrated find + lean find both round-trip vitals back to real numbers, not strings', async () => {
    await seedOpenVisit('OPD-VIT002');
    await opdService.updateVisit(
      TENANT, 'OPD-VIT002', { vitals: { ...VITALS } }, 'doctor-1', UserRole.DOCTOR,
    );

    const hydrated = await opdRepository.findByVisitId(TENANT, 'OPD-VIT002');
    expect(pickVitals(hydrated!.vitals)).toEqual(VITALS);
    expect(typeof hydrated!.vitals.weight).toBe('number');
    expect(typeof hydrated!.vitals.bodyTemperature).toBe('number');

    const leanPage = await opdRepository.findByPatient(TENANT, 'PAT-TRACE01', { page: 1, limit: 10 });
    const leanVisit = leanPage.data.find((v) => v.visitId === 'OPD-VIT002')!;
    expect(pickVitals(leanVisit.vitals)).toEqual(VITALS);
    expect(typeof leanVisit.vitals.weight).toBe('number');
  });

  test('Model.updateOne with a whole-object $set of vitals cannot bypass encryption', async () => {
    await seedOpenVisit('OPD-VIT003');
    await OPDVisitModel.updateOne(
      { tenantId: TENANT, visitId: 'OPD-VIT003' },
      { $set: { vitals: { ...VITALS, weight: 80.2 } } },
    );
    const stored = await rawDoc('OPD-VIT003');
    assertVitalsCiphertext(stored);
    expect(JSON.stringify(stored)).not.toContain('80.2');

    const back = await opdRepository.findByVisitId(TENANT, 'OPD-VIT003');
    expect(back!.vitals.weight).toBe(80.2);
  });

  test('bulkWrite cannot bypass vitals encryption', async () => {
    await seedOpenVisit('OPD-VIT004');
    await OPDVisitModel.bulkWrite([
      {
        updateOne: {
          filter: { tenantId: TENANT, visitId: 'OPD-VIT004' },
          update: { $set: { vitals: { ...VITALS } } },
        },
      },
    ]);
    assertVitalsCiphertext(await rawDoc('OPD-VIT004'));
  });

  test('partial vitals update merges onto existing readings without disturbing them', async () => {
    await seedOpenVisit('OPD-VIT005');
    await opdService.updateVisit(
      TENANT, 'OPD-VIT005', { vitals: { ...VITALS } }, 'doctor-1', UserRole.DOCTOR,
    );

    // Only weight is sent — height/bloodPressure/sugar/bodyTemperature must
    // survive the merge untouched (OPDService.updateVisit's merge logic).
    await opdService.updateVisit(
      TENANT, 'OPD-VIT005', { vitals: { weight: 74 } }, 'doctor-1', UserRole.DOCTOR,
    );

    const back = await opdRepository.findByVisitId(TENANT, 'OPD-VIT005');
    expect(pickVitals(back!.vitals)).toEqual({ ...VITALS, weight: 74 });

    const stored = await rawDoc('OPD-VIT005');
    assertVitalsCiphertext(stored); // height/sugar/etc. re-encrypted as part of the whole-object $set
  });

  test('sending a field as null explicitly clears it', async () => {
    await seedOpenVisit('OPD-VIT006');
    await opdService.updateVisit(
      TENANT, 'OPD-VIT006', { vitals: { ...VITALS } }, 'doctor-1', UserRole.DOCTOR,
    );
    await opdService.updateVisit(
      TENANT, 'OPD-VIT006', { vitals: { weight: null } }, 'doctor-1', UserRole.DOCTOR,
    );

    const back = await opdRepository.findByVisitId(TENANT, 'OPD-VIT006');
    expect(back!.vitals.weight).toBeNull();
    expect(back!.vitals.height).toBe(VITALS.height);
  });

  test('legacy plaintext vitals read back unchanged, then encrypt on next write', async () => {
    await mongoose.connection.collection('opd_visits').insertOne({
      visitId:      'OPD-VIT007',
      tenantId:     TENANT,
      patientId:    'PAT-TRACE01',
      doctorIds:    ['doctor-1'],
      nurseIds:     [],
      departmentId: null,
      visitDate:    new Date('2026-05-15T00:00:00.000Z'),
      queueNumber:  1,
      status:       OPDVisitStatus.OPEN,
      diagnosis:    null,
      prescription: null,
      notes:        null,
      vitals:       { ...VITALS }, // raw BSON numbers/string, pre-encryption shape
      createdAt:    new Date('2026-05-15T00:00:00.000Z'),
      updatedAt:    new Date('2026-05-15T00:00:00.000Z'),
    });

    const beforeWrite = await opdRepository.findByVisitId(TENANT, 'OPD-VIT007');
    expect(pickVitals(beforeWrite!.vitals)).toEqual(VITALS);
    expect(typeof beforeWrite!.vitals.weight).toBe('number');

    await opdService.updateVisit(
      TENANT, 'OPD-VIT007', { vitals: { sugar: 110 } }, 'doctor-1', UserRole.DOCTOR,
    );
    assertVitalsCiphertext(await rawDoc('OPD-VIT007'));

    const after = await opdRepository.findByVisitId(TENANT, 'OPD-VIT007');
    expect(pickVitals(after!.vitals)).toEqual({ ...VITALS, sugar: 110 });
  });

  test('audit log redacts vitals instead of storing readings in plain form', async () => {
    const auditMock = (jest.requireMock('../../../src/shared/services/audit.service') as {
      auditService: { log: jest.Mock };
    }).auditService.log;
    auditMock.mockClear();

    await seedOpenVisit('OPD-VIT008');
    await opdService.updateVisit(
      TENANT, 'OPD-VIT008', { vitals: { ...VITALS } }, 'doctor-1', UserRole.DOCTOR,
    );

    const call = auditMock.mock.calls.find((c) => c[0]?.entityId === 'OPD-VIT008');
    expect(call).toBeDefined();
    expect(call![0].newValue.vitals).toBe('[redacted]');
    expect(JSON.stringify(call![0])).not.toContain('120/80');
  });
});

describe('encrypt-opd-vitals migration script', () => {
  const col = () => mongoose.connection.collection('opd_visits');

  async function insertLegacy(visitId: string, vitals: Record<string, unknown>): Promise<void> {
    await col().insertOne({
      visitId,
      tenantId:     TENANT,
      patientId:    'PAT-TRACE01',
      doctorIds:    ['doctor-1'],
      nurseIds:     [],
      departmentId: null,
      visitDate:    new Date('2026-05-15T00:00:00.000Z'),
      queueNumber:  1,
      status:       OPDVisitStatus.OPEN,
      diagnosis:    null,
      prescription: null,
      notes:        null,
      vitals,
      createdAt:    new Date('2026-05-15T00:00:00.000Z'),
      updatedAt:    new Date('2026-05-15T00:00:00.000Z'),
    });
  }

  test('--dry-run reports but changes nothing', async () => {
    await insertLegacy('mig-vit-001', { ...VITALS });
    const n = await migrateOpdVitals(col(), { dryRun: true });
    expect(n).toBe(0);
    expect(rawVitals((await col().findOne({ visitId: 'mig-vit-001' }))!)).toEqual(VITALS);
  });

  test('encrypts legacy vitals at rest; the model still returns plaintext', async () => {
    await insertLegacy('mig-vit-002', { ...VITALS });
    const n = await migrateOpdVitals(col());
    expect(n).toBe(1);

    assertVitalsCiphertext((await col().findOne({ visitId: 'mig-vit-002' }))!);

    const back = await opdRepository.findByVisitId(TENANT, 'mig-vit-002');
    expect(pickVitals(back!.vitals)).toEqual(VITALS);
    expect(typeof back!.vitals.weight).toBe('number');
  });

  test('is idempotent and never re-encrypts already-encrypted vitals', async () => {
    await insertLegacy('mig-vit-003', { ...VITALS });
    await migrateOpdVitals(col());
    const first = rawVitals((await col().findOne({ visitId: 'mig-vit-003' }))!);

    const n2 = await migrateOpdVitals(col());
    expect(n2).toBe(0);
    const second = rawVitals((await col().findOne({ visitId: 'mig-vit-003' }))!);
    expect(second).toEqual(first);
  });

  test('a visit with no vitals recorded (all null) is not matched or modified', async () => {
    await insertLegacy('mig-vit-004', {
      weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null,
    });
    const n = await migrateOpdVitals(col());
    expect(n).toBe(0);
  });
});
