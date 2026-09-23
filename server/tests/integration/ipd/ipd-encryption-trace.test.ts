import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
import { ipdRepository } from '../../../src/modules/ipd/ipd.repository';
import { ipdService } from '../../../src/modules/ipd/ipd.service';
import { encryptField, EncryptionKeyPurpose } from '../../../src/shared/utils/field-encryption';
import { migrateIpdProgressNotes } from '../../../scripts/encrypt-ipd-progress-notes';
import { migrateIpdVitals } from '../../../scripts/encrypt-ipd-vitals';

const ENVELOPE = /^enc:v1:/;
const TENANT = 'tenant-ipd-trace';
const SECRET = '<p>Patient disclosed a confidential psychiatric history — HIV-positive.</p>';

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
async function raw(admissionId: string): Promise<Record<string, unknown>> {
  const doc = await mongoose.connection.collection('ipd_admissions').findOne({ admissionId });
  if (!doc) throw new Error(`raw ipd_admissions ${admissionId} not found`);
  return doc as Record<string, unknown>;
}

function note(noteId: string, text: string = SECRET, doctorId = 'user-doc-1') {
  return { noteId, doctorId, note: text, timestamp: new Date('2026-01-02T00:00:00.000Z') };
}

type NoteInput = ReturnType<typeof note>;

function makeAdmission(admissionId: string, notes: NoteInput[] = []) {
  return {
    admissionId,
    patientId:         'PAT-IPDTRACE1',
    wardId:            'ward-1',
    bedId:             'bed-1',
    bedNumber:         'B-1',
    wardName:          'ICU',
    assignedDoctorIds: ['user-doc-1'],
    departmentId:      null,
    tenantId:          TENANT,
    progressNotes:     notes,
  };
}

function rawNotes(stored: Record<string, unknown>): Array<Record<string, unknown>> {
  return (stored.progressNotes ?? []) as Array<Record<string, unknown>>;
}

// Every stored `note` is ciphertext, no plaintext PHI leaked anywhere in the
// document, and the sibling scalars are still plaintext.
function assertNotesCiphertext(stored: Record<string, unknown>, expectedPatientId = 'PAT-IPDTRACE1'): void {
  const notes = rawNotes(stored);
  expect(notes.length).toBeGreaterThan(0);
  for (const n of notes) {
    expect(n.note).toEqual(expect.stringMatching(ENVELOPE));
    expect(typeof n.noteId).toBe('string');
    expect(typeof n.doctorId).toBe('string');
  }
  const blob = JSON.stringify(stored);
  expect(blob).not.toContain('HIV-positive');
  expect(blob).not.toContain('confidential psychiatric');
  expect(stored.tenantId).toBe(TENANT);
  expect(stored.patientId).toBe(expectedPatientId);
}

describe('IPDAdmission progressNotes[].note encryption — full write-path trace (raw MongoDB)', () => {
  test('Model.create (save) stores note ciphertext; the returned doc is plaintext', async () => {
    const created = await IPDAdmissionModel.create(makeAdmission('adm-001', [note('n1')]));
    expect(created.progressNotes[0]!.note).toBe(SECRET);

    const stored = await raw('adm-001');
    assertNotesCiphertext(stored);
    // ids and timestamps are left exactly as written
    expect(rawNotes(stored)[0]!.noteId).toBe('n1');
    expect(rawNotes(stored)[0]!.doctorId).toBe('user-doc-1');
    expect(rawNotes(stored)[0]!.timestamp).toBeInstanceOf(Date);
  });

  test('reads round-trip notes back to plaintext (hydrated findOne + lean find)', async () => {
    await IPDAdmissionModel.create(
      makeAdmission('adm-002', [note('n1'), note('n2', '<p>second secret note</p>')]),
    );

    const hydrated = await ipdRepository.findById('adm-002', TENANT);
    expect(hydrated!.progressNotes.map((n) => n.note)).toEqual([
      SECRET,
      '<p>second secret note</p>',
    ]);

    const leanPage = await ipdRepository.findByPatient(TENANT, 'PAT-IPDTRACE1', 1, 10);
    expect(leanPage.data[0]!.progressNotes[0]!.note).toBe(SECRET);
    expect(leanPage.data[0]!.progressNotes[1]!.note).toBe('<p>second secret note</p>');
  });

  test('repository.appendProgressNote ($push) stores ciphertext and returns plaintext', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-003'));

    const updated = await ipdRepository.appendProgressNote('adm-003', TENANT, note('n1'));
    expect(updated!.progressNotes[0]!.note).toBe(SECRET);

    const stored = await raw('adm-003');
    expect(rawNotes(stored)[0]!.note).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('HIV-positive');
  });

  test('$push with $each cannot bypass encryption', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-004'));
    await IPDAdmissionModel.findOneAndUpdate(
      { admissionId: 'adm-004' },
      { $push: { progressNotes: { $each: [note('n1'), note('n2', '<p>each secret two</p>')] } } },
    );
    const stored = await raw('adm-004');
    expect(rawNotes(stored)).toHaveLength(2);
    rawNotes(stored).forEach((n) => expect(n.note).toMatch(ENVELOPE));
    expect(JSON.stringify(stored)).not.toContain('each secret two');
  });

  test('$set of the whole progressNotes array cannot bypass encryption', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-005', [note('n1')]));
    await IPDAdmissionModel.updateOne(
      { admissionId: 'adm-005' },
      { $set: { progressNotes: [note('n1'), note('n2', '<p>set array secret</p>')] } },
    );
    const stored = await raw('adm-005');
    rawNotes(stored).forEach((n) => expect(n.note).toMatch(ENVELOPE));
    const back = await ipdRepository.findById('adm-005', TENANT);
    expect(back!.progressNotes.map((n) => n.note)).toEqual([SECRET, '<p>set array secret</p>']);
  });

  test('$set of a positional/indexed note field cannot bypass encryption', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-006', [note('n1')]));
    await IPDAdmissionModel.updateOne(
      { admissionId: 'adm-006' },
      { $set: { 'progressNotes.0.note': '<p>indexed secret</p>' } },
    );
    expect(rawNotes(await raw('adm-006'))[0]!.note).toMatch(ENVELOPE);
    const back = await ipdRepository.findById('adm-006', TENANT);
    expect(back!.progressNotes[0]!.note).toBe('<p>indexed secret</p>');
  });

  test('bare (no-operator) replacement update cannot bypass encryption', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-006b', [note('n1')]));
    await IPDAdmissionModel.replaceOne(
      { admissionId: 'adm-006b' },
      makeAdmission('adm-006b', [note('n1', '<p>replaced secret</p>')]),
    );
    expect(rawNotes(await raw('adm-006b'))[0]!.note).toMatch(ENVELOPE);
    expect(JSON.stringify(await raw('adm-006b'))).not.toContain('replaced secret');
  });

  test('insertMany cannot bypass encryption', async () => {
    await IPDAdmissionModel.insertMany([makeAdmission('adm-007', [note('n1')])]);
    assertNotesCiphertext(await raw('adm-007'));
  });

  test('bulkWrite ($push + insertOne) cannot bypass encryption', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-008'));
    await IPDAdmissionModel.bulkWrite([
      {
        updateOne: {
          filter: { admissionId: 'adm-008' },
          update: { $push: { progressNotes: note('n1', '<p>bulkwrite push secret</p>') } },
        },
      },
      { insertOne: { document: { ...makeAdmission('adm-009', [note('n1')]), bedId: 'bed-2', patientId: 'PAT-IPDTRACE2' } } },
    ]);
    expect(rawNotes(await raw('adm-008'))[0]!.note).toMatch(ENVELOPE);
    expect(JSON.stringify(await raw('adm-008'))).not.toContain('bulkwrite push secret');
    assertNotesCiphertext(await raw('adm-009'), 'PAT-IPDTRACE2');
  });

  test('save path: pushing a note onto a hydrated doc then save() encrypts it', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-010', [note('n1')]));

    const doc = await IPDAdmissionModel.findOne({ admissionId: 'adm-010' });
    expect(doc!.progressNotes[0]!.note).toBe(SECRET); // came back decrypted

    doc!.progressNotes.push(note('n2', '<p>save-path secret</p>') as never);
    await doc!.save();

    const stored = await raw('adm-010');
    expect(rawNotes(stored)).toHaveLength(2);
    rawNotes(stored).forEach((n) => expect(n.note).toMatch(ENVELOPE));

    const back = await IPDAdmissionModel.findOne({ admissionId: 'adm-010' });
    expect(back!.progressNotes.map((n) => n.note)).toEqual([SECRET, '<p>save-path secret</p>']);
  });

  test('a near-max-length note (ciphertext far exceeds the old 30000 maxlength) still persists', async () => {
    const bigNote = '<p>' + 'x'.repeat(29_900) + '</p>';
    await IPDAdmissionModel.create(makeAdmission('adm-011', [note('n1', bigNote)]));
    expect(rawNotes(await raw('adm-011'))[0]!.note).toMatch(ENVELOPE);
    const back = await IPDAdmissionModel.findOne({ admissionId: 'adm-011' });
    expect(back!.progressNotes[0]!.note).toBe(bigNote);
  });

  test('legacy plaintext note stays readable; a later $push encrypts only the new element', async () => {
    await mongoose.connection.collection('ipd_admissions').insertOne({
      ...makeAdmission('adm-012', [note('n1')]),
      status:        'ADMITTED',
      admissionDate: new Date(),
      dischargeDate: null,
      createdAt:     new Date(),
      updatedAt:     new Date(),
    });

    const before = await ipdRepository.findById('adm-012', TENANT);
    expect(before!.progressNotes[0]!.note).toBe(SECRET);

    // An update that doesn't touch progressNotes leaves the note plaintext at rest.
    await IPDAdmissionModel.updateOne({ admissionId: 'adm-012' }, { $set: { wardName: 'HDU' } });
    expect(rawNotes(await raw('adm-012'))[0]!.note).toBe(SECRET);

    await ipdRepository.appendProgressNote('adm-012', TENANT, note('n2', '<p>freshly encrypted</p>'));
    const stored = await raw('adm-012');
    expect(rawNotes(stored)[0]!.note).toBe(SECRET);            // legacy element untouched
    expect(rawNotes(stored)[1]!.note).toMatch(ENVELOPE);       // new element encrypted

    const back = await ipdRepository.findById('adm-012', TENANT);
    expect(back!.progressNotes.map((n) => n.note)).toEqual([SECRET, '<p>freshly encrypted</p>']);
  });

  test('an already-encrypted note is not double-wrapped on re-write', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-013', [note('n1')]));
    const ct = rawNotes(await raw('adm-013'))[0]!.note as string;

    // Unrelated update — ciphertext must be byte-identical afterwards.
    await IPDAdmissionModel.updateOne({ admissionId: 'adm-013' }, { $set: { wardName: 'HDU' } });
    expect(rawNotes(await raw('adm-013'))[0]!.note).toBe(ct);

    // $set of the exact stored ciphertext must not re-encrypt it.
    await IPDAdmissionModel.updateOne(
      { admissionId: 'adm-013' },
      { $set: { 'progressNotes.0.note': ct } },
    );
    expect(rawNotes(await raw('adm-013'))[0]!.note).toBe(ct);
    expect((await ipdRepository.findById('adm-013', TENANT))!.progressNotes[0]!.note).toBe(SECRET);
  });
});

describe('encrypt-ipd-progress-notes migration script', () => {
  const col = () => mongoose.connection.collection('ipd_admissions');

  async function insertLegacy(admissionId: string, notes: NoteInput[]): Promise<void> {
    await col().insertOne({
      ...makeAdmission(admissionId, notes),
      status:        'ADMITTED',
      admissionDate: new Date(),
      dischargeDate: null,
      createdAt:     new Date(),
      updatedAt:     new Date(),
    });
  }

  test('--dry-run reports but changes nothing', async () => {
    await insertLegacy('mig-001', [note('n1')]);
    const n = await migrateIpdProgressNotes(col(), { dryRun: true });
    expect(n).toBe(0);
    expect(rawNotes((await col().findOne({ admissionId: 'mig-001' }))!)[0]!.note).toBe(SECRET);
  });

  test('encrypts legacy notes at rest; the model still returns plaintext', async () => {
    await insertLegacy('mig-002', [note('n1'), note('n2', '<p>second</p>')]);
    const n = await migrateIpdProgressNotes(col());
    expect(n).toBe(1);

    const stored = (await col().findOne({ admissionId: 'mig-002' }))!;
    rawNotes(stored).forEach((x) => expect(x.note).toMatch(ENVELOPE));
    expect(JSON.stringify(stored)).not.toContain('HIV-positive');

    const doc = await IPDAdmissionModel.findOne({ admissionId: 'mig-002' });
    expect(doc!.progressNotes.map((x) => x.note)).toEqual([SECRET, '<p>second</p>']);
  });

  test('is idempotent and never re-encrypts an already-encrypted note', async () => {
    await insertLegacy('mig-003', [note('n1')]);
    await migrateIpdProgressNotes(col());
    const first = (await col().findOne({ admissionId: 'mig-003' }))!;

    const n2 = await migrateIpdProgressNotes(col());
    expect(n2).toBe(0);
    const second = (await col().findOne({ admissionId: 'mig-003' }))!;
    expect(rawNotes(second)[0]!.note).toBe(rawNotes(first)[0]!.note);
  });

  test('leaves a model-encrypted admission untouched and still encrypts a legacy one', async () => {
    await IPDAdmissionModel.create({
      ...makeAdmission('mig-004', [note('n1')]), bedId: 'bed-mig-004', patientId: 'PAT-IPDTRACE-MIG4',
    });
    await insertLegacy('mig-005', [note('n1')]);

    const n = await migrateIpdProgressNotes(col());
    expect(n).toBe(1); // only the legacy row

    expect(rawNotes((await col().findOne({ admissionId: 'mig-005' }))!)[0]!.note).toMatch(ENVELOPE);
    const untouched = await IPDAdmissionModel.findOne({ admissionId: 'mig-004' });
    expect(untouched!.progressNotes[0]!.note).toBe(SECRET);
  });

  test('a mixed array encrypts only the plaintext note, leaving the encrypted one as-is', async () => {
    const enc = encryptField('<p>already encrypted</p>', EncryptionKeyPurpose.MEDICAL);
    await insertLegacy('mig-006', []);
    await col().updateOne(
      { admissionId: 'mig-006' },
      {
        $set: {
          progressNotes: [
            { noteId: 'n1', doctorId: 'user-doc-1', note: enc,    timestamp: new Date() },
            { noteId: 'n2', doctorId: 'user-doc-1', note: SECRET, timestamp: new Date() },
          ],
        },
      },
    );

    const n = await migrateIpdProgressNotes(col());
    expect(n).toBe(1);

    const stored = (await col().findOne({ admissionId: 'mig-006' }))!;
    expect(rawNotes(stored)[0]!.note).toBe(enc);           // untouched
    expect(rawNotes(stored)[1]!.note).toMatch(ENVELOPE);   // newly encrypted
    expect(rawNotes(stored)[1]!.note).not.toBe(SECRET);

    const doc = await IPDAdmissionModel.findOne({ admissionId: 'mig-006' });
    expect(doc!.progressNotes.map((x) => x.note)).toEqual(['<p>already encrypted</p>', SECRET]);
  });

  test('an admission with an empty progressNotes array is not matched or modified', async () => {
    await insertLegacy('mig-007', []);
    const n = await migrateIpdProgressNotes(col());
    expect(n).toBe(0);
    expect(rawNotes((await col().findOne({ admissionId: 'mig-007' }))!)).toEqual([]);
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
// the plain fields first, exactly like ipd.controller.ts's toResponse() does
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

describe('IPDAdmission vitals encryption — full write-path trace, Create → Save → Fetch → Edit → Fetch', () => {
  test('ipdService.updateAdmission stores every vitals sub-field as ciphertext at rest', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-vit-001'));

    await ipdService.updateAdmission('adm-vit-001', TENANT, { vitals: { ...VITALS } }, 'user-doc-1');

    assertVitalsCiphertext(await raw('adm-vit-001'));
  });

  test('hydrated find + lean find both round-trip vitals back to real numbers, not strings', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-vit-002'));
    await ipdService.updateAdmission('adm-vit-002', TENANT, { vitals: { ...VITALS } }, 'user-doc-1');

    const hydrated = await ipdRepository.findById('adm-vit-002', TENANT);
    expect(pickVitals(hydrated!.vitals)).toEqual(VITALS);
    expect(typeof hydrated!.vitals.weight).toBe('number');
    expect(typeof hydrated!.vitals.bodyTemperature).toBe('number');

    const leanPage = await ipdRepository.findByPatient(TENANT, 'PAT-IPDTRACE1', 1, 10);
    const leanAdmission = leanPage.data.find((a) => a.admissionId === 'adm-vit-002')!;
    expect(pickVitals(leanAdmission.vitals)).toEqual(VITALS);
    expect(typeof leanAdmission.vitals.weight).toBe('number');
  });

  test('Model.updateOne with a whole-object $set of vitals cannot bypass encryption', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-vit-003'));
    await IPDAdmissionModel.updateOne(
      { admissionId: 'adm-vit-003' },
      { $set: { vitals: { ...VITALS, weight: 80.2 } } },
    );
    const stored = await raw('adm-vit-003');
    assertVitalsCiphertext(stored);
    expect(JSON.stringify(stored)).not.toContain('80.2');

    const back = await ipdRepository.findById('adm-vit-003', TENANT);
    expect(back!.vitals.weight).toBe(80.2);
  });

  test('bulkWrite cannot bypass vitals encryption', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-vit-004'));
    await IPDAdmissionModel.bulkWrite([
      {
        updateOne: {
          filter: { admissionId: 'adm-vit-004' },
          update: { $set: { vitals: { ...VITALS } } },
        },
      },
    ]);
    assertVitalsCiphertext(await raw('adm-vit-004'));
  });

  test('partial vitals update merges onto existing readings without disturbing them', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-vit-005'));
    await ipdService.updateAdmission('adm-vit-005', TENANT, { vitals: { ...VITALS } }, 'user-doc-1');

    // Only weight is sent — height/bloodPressure/sugar/bodyTemperature must
    // survive the merge untouched (IPDService.updateAdmission's merge logic).
    await ipdService.updateAdmission('adm-vit-005', TENANT, { vitals: { weight: 74 } }, 'user-doc-1');

    const back = await ipdRepository.findById('adm-vit-005', TENANT);
    expect(pickVitals(back!.vitals)).toEqual({ ...VITALS, weight: 74 });
    assertVitalsCiphertext(await raw('adm-vit-005'));
  });

  test('sending a field as null explicitly clears it', async () => {
    await IPDAdmissionModel.create(makeAdmission('adm-vit-006'));
    await ipdService.updateAdmission('adm-vit-006', TENANT, { vitals: { ...VITALS } }, 'user-doc-1');
    await ipdService.updateAdmission('adm-vit-006', TENANT, { vitals: { weight: null } }, 'user-doc-1');

    const back = await ipdRepository.findById('adm-vit-006', TENANT);
    expect(back!.vitals.weight).toBeNull();
    expect(back!.vitals.height).toBe(VITALS.height);
  });

  test('legacy plaintext vitals read back unchanged, then encrypt on next write', async () => {
    await mongoose.connection.collection('ipd_admissions').insertOne({
      ...makeAdmission('adm-vit-007'),
      status:        'ADMITTED',
      admissionDate: new Date(),
      dischargeDate: null,
      vitals:        { ...VITALS }, // raw BSON numbers/string, pre-encryption shape
      createdAt:     new Date(),
      updatedAt:     new Date(),
    });

    const beforeWrite = await ipdRepository.findById('adm-vit-007', TENANT);
    expect(pickVitals(beforeWrite!.vitals)).toEqual(VITALS);
    expect(typeof beforeWrite!.vitals.weight).toBe('number');

    await ipdService.updateAdmission('adm-vit-007', TENANT, { vitals: { sugar: 110 } }, 'user-doc-1');
    assertVitalsCiphertext(await raw('adm-vit-007'));

    const after = await ipdRepository.findById('adm-vit-007', TENANT);
    expect(pickVitals(after!.vitals)).toEqual({ ...VITALS, sugar: 110 });
  });
});

describe('encrypt-ipd-vitals migration script', () => {
  const col = () => mongoose.connection.collection('ipd_admissions');

  async function insertLegacy(admissionId: string, vitals: Record<string, unknown>): Promise<void> {
    await col().insertOne({
      ...makeAdmission(admissionId),
      status:        'ADMITTED',
      admissionDate: new Date(),
      dischargeDate: null,
      vitals,
      createdAt:     new Date(),
      updatedAt:     new Date(),
    });
  }

  test('--dry-run reports but changes nothing', async () => {
    await insertLegacy('mig-vit-001', { ...VITALS });
    const n = await migrateIpdVitals(col(), { dryRun: true });
    expect(n).toBe(0);
    expect(rawVitals((await col().findOne({ admissionId: 'mig-vit-001' }))!)).toEqual(VITALS);
  });

  test('encrypts legacy vitals at rest; the model still returns plaintext', async () => {
    await insertLegacy('mig-vit-002', { ...VITALS });
    const n = await migrateIpdVitals(col());
    expect(n).toBe(1);

    assertVitalsCiphertext((await col().findOne({ admissionId: 'mig-vit-002' }))!);

    const back = await ipdRepository.findById('mig-vit-002', TENANT);
    expect(pickVitals(back!.vitals)).toEqual(VITALS);
    expect(typeof back!.vitals.weight).toBe('number');
  });

  test('is idempotent and never re-encrypts already-encrypted vitals', async () => {
    await insertLegacy('mig-vit-003', { ...VITALS });
    await migrateIpdVitals(col());
    const first = rawVitals((await col().findOne({ admissionId: 'mig-vit-003' }))!);

    const n2 = await migrateIpdVitals(col());
    expect(n2).toBe(0);
    const second = rawVitals((await col().findOne({ admissionId: 'mig-vit-003' }))!);
    expect(second).toEqual(first);
  });

  test('an admission with no vitals recorded (all null) is not matched or modified', async () => {
    await insertLegacy('mig-vit-004', {
      weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null,
    });
    const n = await migrateIpdVitals(col());
    expect(n).toBe(0);
  });
});
