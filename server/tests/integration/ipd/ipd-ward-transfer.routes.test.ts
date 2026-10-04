/**
 * Integration tests — moving an ADMITTED admission to another ward.
 *
 * A ward change must come with a bed in the target ward: the admission's
 * bedId/bedNumber must always sit in its wardId, and the old bed must be
 * released (and the new one occupied) in the same transaction. Every rejected
 * request must leave the admission and both beds untouched.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';

jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));

import app                   from '../../../src/app';
import { TenantModel }       from '../../../src/modules/tenant/tenant.model';
import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
import { WardModel }         from '../../../src/modules/ipd/ward.model';
import { BedModel }          from '../../../src/modules/ipd/bed.model';
import { PatientModel }      from '../../../src/modules/patient/patient.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env['JWT_SECRET']!;
let mongod: MongoMemoryReplSet;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all([IPDAdmissionModel.init(), BedModel.init(), WardModel.init()]);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
});

const toId = (doc: mongoose.Document) => (doc._id as mongoose.Types.ObjectId).toString();

function token(tenantId: string, role: UserRole) {
  return jwt.sign(
    { userId: `${role}-user`, tenantId, role, email: `${role}@test.com`, isFirstLogin: false },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

async function setup() {
  const tenant = await TenantModel.create({
    name:       'Ward Transfer Hospital',
    status:     TenantStatus.ACTIVE,
    adminEmail: 'wardtransfer@test.com',
    onboardingDocuments: {
      registrationCertificate: 'k1', gstNumber: 'GST', panCard: 'k2',
      addressLine: '1 Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001',
    },
  });
  const tid = toId(tenant);
  const patient = await PatientModel.create({
    patientId:    'PAT-WTR00001',
    tenantId:     tid,
    fullName:     'Transfer Patient',
    dateOfBirth:  new Date('1990-01-01'),
    gender:       'FEMALE',
    mobileNumber: '9000000001',
    address:      'Addr',
  });
  const wardA = await WardModel.create({ tenantId: tid, name: 'Ward A' });
  const wardB = await WardModel.create({ tenantId: tid, name: 'Ward B' });
  const bedA1 = await BedModel.create({ tenantId: tid, wardId: toId(wardA), bedNumber: 'A-01' });
  const bedA2 = await BedModel.create({ tenantId: tid, wardId: toId(wardA), bedNumber: 'A-02' });
  const bedB1 = await BedModel.create({ tenantId: tid, wardId: toId(wardB), bedNumber: 'B-01' });

  const created = await request(app)
    .post('/api/ipd/admissions')
    .set('Authorization', `Bearer ${token(tid, UserRole.HOSPITAL_ADMIN)}`)
    .send({ patientId: patient.patientId, wardId: toId(wardA), bedId: toId(bedA1) });
  expect(created.status).toBe(201);

  return { tid, wardA, wardB, bedA1, bedA2, bedB1, admissionId: created.body.data.admissionId as string };
}

function patch(tid: string, admissionId: string, body: Record<string, unknown>) {
  return request(app)
    .patch(`/api/ipd/admissions/${admissionId}`)
    .set('Authorization', `Bearer ${token(tid, UserRole.HOSPITAL_ADMIN)}`)
    .send(body);
}

async function expectUnchanged(s: Awaited<ReturnType<typeof setup>>) {
  const adm = await IPDAdmissionModel.findOne({ admissionId: s.admissionId });
  expect(adm?.wardId).toBe(toId(s.wardA));
  expect(adm?.wardName).toBe('Ward A');
  expect(adm?.bedId).toBe(toId(s.bedA1));
  expect(adm?.bedNumber).toBe('A-01');
  const a1 = await BedModel.findById(s.bedA1._id);
  expect(a1?.isOccupied).toBe(true);
  expect(a1?.currentAdmissionId).toBe(s.admissionId);
  expect((await BedModel.findById(s.bedA2._id))?.isOccupied).toBe(false);
  expect((await BedModel.findById(s.bedB1._id))?.isOccupied).toBe(false);
}

describe('PATCH /api/ipd/admissions/:admissionId — ward transfer', () => {
  test('400 when wardId changes without a bedId; nothing changes', async () => {
    const s = await setup();
    const res = await patch(s.tid, s.admissionId, { wardId: toId(s.wardB) });
    expect(res.status).toBe(400);
    expect(res.body.message ?? res.body.error?.message ?? JSON.stringify(res.body))
      .toMatch(/bed in the new ward must be selected/i);
    await expectUnchanged(s);
  });

  test('400 when wardId changes but bedId is the current (old-ward) bed', async () => {
    const s = await setup();
    const res = await patch(s.tid, s.admissionId, { wardId: toId(s.wardB), bedId: toId(s.bedA1) });
    expect(res.status).toBe(400);
    await expectUnchanged(s);
  });

  test('400 when the bed belongs to a different ward than the target ward', async () => {
    const s = await setup();
    const res = await patch(s.tid, s.admissionId, { wardId: toId(s.wardB), bedId: toId(s.bedA2) });
    expect(res.status).toBe(400);
    await expectUnchanged(s);
  });

  test('409 when the target bed is occupied by another active admission', async () => {
    const s = await setup();
    await PatientModel.create({
      patientId: 'PAT-WTR00002', tenantId: s.tid, fullName: 'Other', dateOfBirth: new Date('1990-01-01'),
      gender: 'MALE', mobileNumber: '9000000002', address: 'Addr',
    });
    const other = await request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token(s.tid, UserRole.HOSPITAL_ADMIN)}`)
      .send({ patientId: 'PAT-WTR00002', wardId: toId(s.wardB), bedId: toId(s.bedB1) });
    expect(other.status).toBe(201);

    const res = await patch(s.tid, s.admissionId, { wardId: toId(s.wardB), bedId: toId(s.bedB1) });
    expect(res.status).toBe(409);
    const adm = await IPDAdmissionModel.findOne({ admissionId: s.admissionId });
    expect(adm?.bedId).toBe(toId(s.bedA1));
    expect((await BedModel.findById(s.bedA1._id))?.isOccupied).toBe(true);
  });

  test('200 on ward + bed transfer: admission re-pointed, old bed released, new bed occupied', async () => {
    const s = await setup();
    const res = await patch(s.tid, s.admissionId, { wardId: toId(s.wardB), bedId: toId(s.bedB1) });
    expect(res.status).toBe(200);
    expect(res.body.data.wardId).toBe(toId(s.wardB));
    expect(res.body.data.bedId).toBe(toId(s.bedB1));

    const adm = await IPDAdmissionModel.findOne({ admissionId: s.admissionId });
    expect(adm?.wardId).toBe(toId(s.wardB));
    expect(adm?.wardName).toBe('Ward B');
    expect(adm?.bedId).toBe(toId(s.bedB1));
    expect(adm?.bedNumber).toBe('B-01');

    const a1 = await BedModel.findById(s.bedA1._id);
    expect(a1?.isOccupied).toBe(false);
    expect(a1?.currentAdmissionId).toBeNull();
    const b1 = await BedModel.findById(s.bedB1._id);
    expect(b1?.isOccupied).toBe(true);
    expect(b1?.currentAdmissionId).toBe(s.admissionId);
  });

  test('200 on a same-ward bed change without wardId (unchanged behaviour)', async () => {
    const s = await setup();
    const res = await patch(s.tid, s.admissionId, { bedId: toId(s.bedA2) });
    expect(res.status).toBe(200);
    expect(res.body.data.wardId).toBe(toId(s.wardA));
    expect(res.body.data.bedId).toBe(toId(s.bedA2));
    expect((await BedModel.findById(s.bedA1._id))?.isOccupied).toBe(false);
    expect((await BedModel.findById(s.bedA2._id))?.isOccupied).toBe(true);
  });

  test('200 when wardId is sent unchanged without a bedId (no-op ward)', async () => {
    const s = await setup();
    const res = await patch(s.tid, s.admissionId, { wardId: toId(s.wardA) });
    expect(res.status).toBe(200);
    await expectUnchanged(s);
  });
});
