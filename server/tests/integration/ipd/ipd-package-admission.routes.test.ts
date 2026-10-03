/**
 * Integration tests — Package-wise Ward and Bed allocation on IPD admission.
 *
 * Package selection is optional. When a packageId is sent, the admission's
 * ward must be the package's linked ward (same tenant), the bed must belong
 * to that ward, and the admission's ward is then locked for later edits.
 * Without a package, admission behaves exactly as before.
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
import { PackageModel }      from '../../../src/modules/packages/packages.model';
import { ChargeModel }       from '../../../src/modules/charges/charges.model';
import { PackageAssignmentModel } from '../../../src/modules/packages/package-assignment.model';
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

async function seedTenant(name = 'Pkg IPD Hospital') {
  return TenantModel.create({
    name,
    status:     TenantStatus.ACTIVE,
    adminEmail: `${name.replace(/\s/g, '').toLowerCase()}@test.com`,
    onboardingDocuments: {
      registrationCertificate: 'k1', gstNumber: 'GST', panCard: 'k2',
      addressLine: '1 Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001',
    },
  });
}

async function seedPatient(tenantId: string, n = 1) {
  return PatientModel.create({
    patientId:    `PAT-PKG0000${n}`,
    tenantId,
    fullName:     `Patient ${n}`,
    dateOfBirth:  new Date('1990-01-01'),
    gender:       'FEMALE',
    mobileNumber: `900000000${n}`,
    address:      'Addr',
  });
}

async function seedWard(tenantId: string, name: string) {
  return WardModel.create({ tenantId, name });
}

async function seedBed(tenantId: string, wardId: string, bedNumber: string, isOccupied = false) {
  return BedModel.create({ tenantId, wardId, bedNumber, isOccupied });
}

async function seedPackage(tenantId: string, overrides: Record<string, unknown> = {}) {
  return PackageModel.create({
    packageId:        'PKG-WARD0001',
    tenantId,
    name:             'Maternity',
    price:            25000,
    includedServices: ['Delivery'],
    status:           'ACTIVE',
    ...overrides,
  });
}

async function setup() {
  const tenant   = await seedTenant();
  const tid      = toId(tenant);
  const patient  = await seedPatient(tid);
  const pkgWard  = await seedWard(tid, 'Maternity Ward');
  const other    = await seedWard(tid, 'General Ward');
  const pkgBed   = await seedBed(tid, toId(pkgWard), 'M-01');
  const otherBed = await seedBed(tid, toId(other), 'G-01');
  const pkg      = await seedPackage(tid, { wardId: toId(pkgWard) });
  return { tid, patient, pkgWard, other, pkgBed, otherBed, pkg };
}

function admit(tid: string, body: Record<string, unknown>, role: UserRole = UserRole.RECEPTIONIST) {
  return request(app)
    .post('/api/ipd/admissions')
    .set('Authorization', `Bearer ${token(tid, role)}`)
    .send(body);
}

describe('POST /api/ipd/admissions — with a package', () => {
  test.each([UserRole.RECEPTIONIST, UserRole.NURSE, UserRole.HOSPITAL_ADMIN])(
    '%s admits into a bed of the package ward and the packageId is stored',
    async (role) => {
      const s = await setup();
      const res = await admit(s.tid, {
        patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: s.pkg.packageId,
      }, role);

      expect(res.status).toBe(201);
      expect(res.body.data.packageId).toBe(s.pkg.packageId);
      expect(res.body.data.wardId).toBe(toId(s.pkgWard));
      const stored = await IPDAdmissionModel.findOne({ admissionId: res.body.data.admissionId }).lean();
      expect(stored?.packageId).toBe(s.pkg.packageId);
      expect((await BedModel.findById(s.pkgBed._id))?.isOccupied).toBe(true);
    },
  );

  test('does not create a package assignment or a package charge (billing flow unchanged)', async () => {
    const s = await setup();
    const res = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: s.pkg.packageId,
    });
    expect(res.status).toBe(201);
    expect(await PackageAssignmentModel.countDocuments({})).toBe(0);
    expect(await ChargeModel.countDocuments({})).toBe(0);
  });

  test('400 when the ward is not the package-linked ward (bed untouched)', async () => {
    const s = await setup();
    const res = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.other), bedId: toId(s.otherBed), packageId: s.pkg.packageId,
    });
    expect(res.status).toBe(400);
    expect(await IPDAdmissionModel.countDocuments({})).toBe(0);
    expect((await BedModel.findById(s.otherBed._id))?.isOccupied).toBe(false);
  });

  test('400 when the bed does not belong to the package ward', async () => {
    const s = await setup();
    const res = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.otherBed), packageId: s.pkg.packageId,
    });
    expect(res.status).toBe(400);
    expect(await IPDAdmissionModel.countDocuments({})).toBe(0);
  });

  test('400 when the package has no linked ward', async () => {
    const s = await setup();
    await PackageModel.updateOne({ packageId: s.pkg.packageId }, { wardId: null });
    const res = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: s.pkg.packageId,
    });
    expect(res.status).toBe(400);
  });

  test('400 when the package is inactive', async () => {
    const s = await setup();
    await PackageModel.updateOne({ packageId: s.pkg.packageId }, { status: 'INACTIVE' });
    const res = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: s.pkg.packageId,
    });
    expect(res.status).toBe(400);
  });

  test('404 when the package is soft-deleted or unknown', async () => {
    const s = await setup();
    await PackageModel.updateOne({ packageId: s.pkg.packageId }, { isDeleted: true });
    const res = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: s.pkg.packageId,
    });
    expect(res.status).toBe(404);
  });

  test("404 for another tenant's package", async () => {
    const s = await setup();
    const otherTenant = await seedTenant('Other Hospital');
    const foreignWard = await seedWard(toId(otherTenant), 'Foreign Ward');
    await seedPackage(toId(otherTenant), { packageId: 'PKG-FOREIGN1', wardId: toId(foreignWard) });
    const res = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: 'PKG-FOREIGN1',
    });
    expect(res.status).toBe(404);
  });

  test('409 when the package-ward bed is already occupied', async () => {
    const s = await setup();
    const first = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: s.pkg.packageId,
    });
    expect(first.status).toBe(201);
    const p2 = await seedPatient(s.tid, 2);
    const second = await admit(s.tid, {
      patientId: p2.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: s.pkg.packageId,
    });
    expect(second.status).toBe(409);
  });

  test('concurrent package admissions for the same bed: exactly one wins', async () => {
    const s  = await setup();
    const p2 = await seedPatient(s.tid, 2);
    const results = await Promise.all([s.patient, p2].map((p) => admit(s.tid, {
      patientId: p.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: s.pkg.packageId,
    })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await IPDAdmissionModel.countDocuments({ bedId: toId(s.pkgBed), status: 'ADMITTED' })).toBe(1);
  });
});

describe('POST /api/ipd/admissions — without a package (unchanged)', () => {
  test('any ward/bed can be chosen and packageId is null', async () => {
    const s = await setup();
    const res = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.other), bedId: toId(s.otherBed),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.packageId).toBeNull();
    expect(res.body.data.wardId).toBe(toId(s.other));
  });
});

describe('PATCH /api/ipd/admissions/:admissionId — package-linked ward lock', () => {
  async function admitWithPackage() {
    const s = await setup();
    const res = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed), packageId: s.pkg.packageId,
    });
    expect(res.status).toBe(201);
    return { ...s, admissionId: res.body.data.admissionId as string };
  }

  function patch(tid: string, admissionId: string, body: Record<string, unknown>) {
    return request(app)
      .patch(`/api/ipd/admissions/${admissionId}`)
      .set('Authorization', `Bearer ${token(tid, UserRole.RECEPTIONIST)}`)
      .send(body);
  }

  test('400 when moving a package admission to another ward; beds unchanged', async () => {
    const s = await admitWithPackage();
    const res = await patch(s.tid, s.admissionId, { wardId: toId(s.other), bedId: toId(s.otherBed) });
    expect(res.status).toBe(400);
    expect((await BedModel.findById(s.pkgBed._id))?.isOccupied).toBe(true);
    expect((await BedModel.findById(s.otherBed._id))?.isOccupied).toBe(false);
  });

  test('200 when changing to another bed in the same package ward', async () => {
    const s = await admitWithPackage();
    const bed2 = await seedBed(s.tid, toId(s.pkgWard), 'M-02');
    const res = await patch(s.tid, s.admissionId, { bedId: toId(bed2) });
    expect(res.status).toBe(200);
    expect(res.body.data.bedId).toBe(toId(bed2));
    expect(res.body.data.wardId).toBe(toId(s.pkgWard));
    expect((await BedModel.findById(s.pkgBed._id))?.isOccupied).toBe(false);
    expect((await BedModel.findById(bed2._id))?.isOccupied).toBe(true);
  });

  test('400 when the new bed is in another ward even without sending wardId', async () => {
    const s = await admitWithPackage();
    const res = await patch(s.tid, s.admissionId, { bedId: toId(s.otherBed) });
    expect(res.status).toBe(400);
  });

  test('a package-less admission can still change ward (unchanged)', async () => {
    const s = await setup();
    const created = await admit(s.tid, {
      patientId: s.patient.patientId, wardId: toId(s.pkgWard), bedId: toId(s.pkgBed),
    });
    const res = await patch(s.tid, created.body.data.admissionId, { wardId: toId(s.other), bedId: toId(s.otherBed) });
    expect(res.status).toBe(200);
    expect(res.body.data.wardId).toBe(toId(s.other));
  });
});
