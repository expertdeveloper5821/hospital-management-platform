/**
 * Integration tests — Ward soft delete + Bed edit/delete (Hospital Admin only).
 *
 * Covers: role gates, active-admission / occupied-bed / active-package
 * restrictions, exclusion of deleted wards/beds from active lists and counts,
 * preservation of discharged history and ward-nurse access, and races between
 * ward/bed deletes and concurrent admission creates / bed moves.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';
import { randomUUID }         from 'crypto';

jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: {
    sendInviteEmail:        jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail:       jest.fn().mockResolvedValue(undefined),
    sendAccountLockEmail:   jest.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  },
}));

import app                     from '../../../src/app';
import { TenantModel }         from '../../../src/modules/tenant/tenant.model';
import { UserModel }           from '../../../src/modules/auth/auth.model';
import { PatientModel }        from '../../../src/modules/patient/patient.model';
import { IPDAdmissionModel }   from '../../../src/modules/ipd/ipd.model';
import { WardModel }           from '../../../src/modules/ipd/ward.model';
import { BedModel }            from '../../../src/modules/ipd/bed.model';
import { PackageModel }        from '../../../src/modules/packages/packages.model';
import { packageRepository }   from '../../../src/modules/packages/packages.repository';
import { dashboardRepository } from '../../../src/modules/dashboard/dashboard.repository';
import { auditService }        from '../../../src/shared/services/audit.service';
import { TenantStatus, UserRole, AuditEntityType } from '../../../src/shared/types/common.types';
import { AdmissionStatus }     from '../../../src/modules/ipd/ipd.types';

const JWT_SECRET = process.env['JWT_SECRET']!;

let mongod: MongoMemoryReplSet;
let tenantId: string;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  // Collections and the partial unique indexes must exist before any
  // transaction writes to them.
  await Promise.all([WardModel.init(), BedModel.init(), IPDAdmissionModel.init(), PackageModel.init()]);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
  (auditService.log as jest.Mock).mockClear();
  tenantId = await seedTenant('Ward Mgmt Hospital');
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toId = (doc: mongoose.Document) => (doc._id as mongoose.Types.ObjectId).toString();

async function seedTenant(name: string): Promise<string> {
  const t = await TenantModel.create({
    name,
    adminEmail: `${name.replace(/\s/g, '').toLowerCase()}@test.com`,
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg', gstNumber: 'GST', panCard: 'PAN',
      addressLine: '1 Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001',
    },
  });
  return toId(t);
}

function token(role: UserRole, userId = `${role.toLowerCase()}-1`, tid = tenantId): string {
  return jwt.sign({ userId, tenantId: tid, role, email: `${role}@test.com`, isFirstLogin: false }, JWT_SECRET);
}
const HA = () => token(UserRole.HOSPITAL_ADMIN, 'ha-1');

async function seedWard(name = 'General Ward', extra: Record<string, unknown> = {}) {
  return WardModel.create({ tenantId, name, ...extra });
}

async function seedBed(wardId: string, bedNumber = 'G-01', isOccupied = false) {
  return BedModel.create({ tenantId, wardId, bedNumber, isOccupied });
}

let patientSeq = 0;
async function seedPatient() {
  patientSeq += 1;
  return PatientModel.create({
    patientId:    `PAT-WB${String(patientSeq).padStart(5, '0')}`,
    tenantId,
    fullName:     `Patient ${patientSeq}`,
    dateOfBirth:  new Date('1985-01-01'),
    gender:       'MALE',
    mobileNumber: '9000000001',
    address:      'Test Address',
  });
}

// Admission written directly (bypasses the API) — mirrors what createAdmission stores.
async function seedAdmission(
  ward: mongoose.Document & { name: string },
  bed:  mongoose.Document & { bedNumber: string },
  status: AdmissionStatus = AdmissionStatus.ADMITTED,
) {
  const patient = await seedPatient();
  const admission = await IPDAdmissionModel.create({
    admissionId:   randomUUID(),
    patientId:     patient.patientId,
    wardId:        toId(ward),
    wardName:      ward.name,
    bedId:         toId(bed),
    bedNumber:     bed.bedNumber,
    status,
    admissionDate: new Date(),
    dischargeDate: status === AdmissionStatus.DISCHARGED ? new Date() : null,
    tenantId,
  });
  if (status === AdmissionStatus.ADMITTED) {
    await BedModel.updateOne({ _id: bed._id }, { isOccupied: true, currentAdmissionId: admission.admissionId });
  }
  return admission;
}

function admit(patientId: string, wardId: string, bedId: string) {
  return request(app)
    .post('/api/ipd/admissions')
    .set('Authorization', `Bearer ${token(UserRole.RECEPTIONIST, 'recept-1')}`)
    .send({ patientId, wardId, bedId });
}

const deleteWard = (wardId: string, auth = HA()) =>
  request(app).delete(`/api/ipd/wards/${wardId}`).set('Authorization', `Bearer ${auth}`);
const deleteBed = (wardId: string, bedId: string, auth = HA()) =>
  request(app).delete(`/api/ipd/wards/${wardId}/beds/${bedId}`).set('Authorization', `Bearer ${auth}`);
const editBed = (wardId: string, bedId: string, bedNumber: string, auth = HA()) =>
  request(app).patch(`/api/ipd/wards/${wardId}/beds/${bedId}`).set('Authorization', `Bearer ${auth}`).send({ bedNumber });

// ─── Permissions ──────────────────────────────────────────────────────────────

describe('permissions — Hospital Admin only', () => {
  const OTHER_ROLES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.RECEPTIONIST, UserRole.DOCTOR, UserRole.NURSE];

  test.each(OTHER_ROLES)('%s cannot delete a ward (403, ward untouched)', async (role) => {
    const ward = await seedWard();
    const res  = await deleteWard(toId(ward), token(role));
    expect(res.status).toBe(403);
    expect((await WardModel.findById(ward._id))?.isDeleted).toBe(false);
  });

  test.each(OTHER_ROLES)('%s cannot edit or delete a bed (403, bed untouched)', async (role) => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward));
    expect((await editBed(toId(ward), toId(bed), 'X-1', token(role))).status).toBe(403);
    expect((await deleteBed(toId(ward), toId(bed), token(role))).status).toBe(403);
    const stored = await BedModel.findById(bed._id);
    expect(stored?.bedNumber).toBe('G-01');
    expect(stored?.isDeleted).toBe(false);
  });

  test('unauthenticated requests are rejected with 401', async () => {
    const ward = await seedWard();
    const res  = await request(app).delete(`/api/ipd/wards/${toId(ward)}`);
    expect(res.status).toBe(401);
  });

  test("a Hospital Admin of another tenant gets 404 for this tenant's ward and bed", async () => {
    const ward     = await seedWard();
    const bed      = await seedBed(toId(ward));
    const otherTid = await seedTenant('Other Hospital');
    const foreign  = token(UserRole.HOSPITAL_ADMIN, 'ha-2', otherTid);

    expect((await deleteWard(toId(ward), foreign)).status).toBe(404);
    expect((await deleteBed(toId(ward), toId(bed), foreign)).status).toBe(404);
    expect((await editBed(toId(ward), toId(bed), 'X-1', foreign)).status).toBe(404);
    expect((await WardModel.findById(ward._id))?.isDeleted).toBe(false);
    expect((await BedModel.findById(bed._id))?.isDeleted).toBe(false);
  });
});

// ─── Ward delete ──────────────────────────────────────────────────────────────

describe('DELETE /api/ipd/wards/:wardId', () => {
  test('soft-deletes an empty ward and retires its beds; record and audit kept', async () => {
    const ward = await seedWard();
    await seedBed(toId(ward), 'G-01');
    await seedBed(toId(ward), 'G-02');

    const res = await deleteWard(toId(ward));
    expect(res.status).toBe(200);

    const stored = await WardModel.findById(ward._id);
    expect(stored?.isDeleted).toBe(true);
    expect(stored?.deletedBy).toBe('ha-1');
    expect(stored?.deletedAt).toBeInstanceOf(Date);
    const beds = await BedModel.find({ wardId: toId(ward) });
    expect(beds).toHaveLength(2);
    expect(beds.every((b) => b.isDeleted)).toBe(true);

    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      entityType: AuditEntityType.IPD_ADMISSION,
      entityId:   toId(ward),
      action:     'DELETE',
      userId:     'ha-1',
      newValue:   { isDeleted: true, retiredBeds: 2 },
    }));
  });

  test('returns 404 for an already-deleted, unknown or malformed ward id', async () => {
    const ward = await seedWard('Old Ward', { isDeleted: true });
    expect((await deleteWard(toId(ward))).status).toBe(404);
    expect((await deleteWard(new mongoose.Types.ObjectId().toString())).status).toBe(404);
    expect((await deleteWard('not-an-id')).status).toBe(404);
  });

  test('blocked (409) while a patient is ADMITTED in the ward — nothing changes', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward));
    await seedAdmission(ward, bed);

    const res = await deleteWard(toId(ward));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/currently admitted/);
    expect((await WardModel.findById(ward._id))?.isDeleted).toBe(false);
    expect((await BedModel.findById(bed._id))?.isDeleted).toBe(false);
    expect(auditService.log).not.toHaveBeenCalled();
  });

  test('blocked (409) while any bed is still flagged occupied', async () => {
    const ward = await seedWard();
    await seedBed(toId(ward), 'G-01', true);
    const res = await deleteWard(toId(ward));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/occupied/);
    expect((await WardModel.findById(ward._id))?.isDeleted).toBe(false);
  });

  test('blocked (409) while an ACTIVE package is linked; allowed once the package is inactive or deleted', async () => {
    const ward = await seedWard();
    const pkg  = await PackageModel.create({
      packageId: 'PKG-1', tenantId, name: 'Maternity', price: 1000, wardId: toId(ward), status: 'ACTIVE',
    });

    const blocked = await deleteWard(toId(ward));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/active package/);
    expect((await WardModel.findById(ward._id))?.isDeleted).toBe(false);

    await PackageModel.updateOne({ _id: pkg._id }, { status: 'INACTIVE' });
    await PackageModel.create({
      packageId: 'PKG-2', tenantId, name: 'Old', price: 1, wardId: toId(ward), status: 'ACTIVE', isDeleted: true,
    });
    expect((await deleteWard(toId(ward))).status).toBe(200);
  });

  test('a package cannot be re-activated while its linked ward is deleted', async () => {
    const ward = await seedWard();
    await PackageModel.create({
      packageId: 'PKG-1', tenantId, name: 'Maternity', price: 1000, wardId: toId(ward), status: 'INACTIVE',
    });
    expect((await deleteWard(toId(ward))).status).toBe(200);

    const res = await request(app)
      .patch('/api/packages/PKG-1')
      .set('Authorization', `Bearer ${HA()}`)
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(404);
    expect((await PackageModel.findOne({ packageId: 'PKG-1' }))?.status).toBe('INACTIVE');
  });

  test('allowed when the ward only has DISCHARGED history — history stays intact', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward));
    const past = await seedAdmission(ward, bed, AdmissionStatus.DISCHARGED);

    expect((await deleteWard(toId(ward))).status).toBe(200);

    const res = await request(app)
      .get(`/api/ipd/admissions/${past.admissionId}`)
      .set('Authorization', `Bearer ${HA()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      wardId: toId(ward), wardName: 'General Ward', bedId: toId(bed), bedNumber: 'G-01',
      status: AdmissionStatus.DISCHARGED,
    });
    expect(await IPDAdmissionModel.countDocuments({ wardId: toId(ward) })).toBe(1);
  });

  test("the ward's nurses keep access to its discharged admissions, but are no longer 'on IPD duty'", async () => {
    const nurse = await UserModel.create({
      tenantId, email: 'nurse@wb.com', name: 'Nurse', passwordHash: 'x',
      role: UserRole.NURSE, isActive: true, isFirstLogin: false,
    });
    const nurseId = toId(nurse);
    const ward = await seedWard('General Ward', { assignedNurseIds: [nurseId] });
    const bed  = await seedBed(toId(ward));
    const past = await seedAdmission(ward, bed, AdmissionStatus.DISCHARGED);

    expect((await deleteWard(toId(ward))).status).toBe(200);
    expect((await WardModel.findById(ward._id))?.assignedNurseIds).toEqual([nurseId]);

    const res = await request(app)
      .get(`/api/ipd/admissions/${past.admissionId}`)
      .set('Authorization', `Bearer ${token(UserRole.NURSE, nurseId)}`);
    expect(res.status).toBe(200);

    const available = await request(app)
      .get('/api/opd/nurses/available')
      .set('Authorization', `Bearer ${HA()}`);
    expect(available.status).toBe(200);
    expect(available.body.data.map((n: { userId: string }) => n.userId)).toContain(nurseId);
  });
});

// ─── Deleted wards/beds are excluded from active lists ───────────────────────

describe('deleted wards and beds are excluded from active lists, pickers and counts', () => {
  test('ward lists, bed list, occupancy and dashboard bed counts', async () => {
    const live = await seedWard('Live Ward');
    await seedBed(toId(live), 'L-01');
    const liveGone = await seedBed(toId(live), 'L-02');
    const gone = await seedWard('Gone Ward');
    await seedBed(toId(gone), 'X-01');

    expect((await deleteWard(toId(gone))).status).toBe(200);
    expect((await deleteBed(toId(live), toId(liveGone))).status).toBe(200);

    const auth = `Bearer ${HA()}`;
    const plain = await request(app).get('/api/ipd/wards').set('Authorization', auth);
    expect(plain.body.data.map((w: { name: string }) => w.name)).toEqual(['Live Ward']);

    const paged = await request(app).get('/api/ipd/wards?page=1&limit=20').set('Authorization', auth);
    expect(paged.body.data.total).toBe(1);
    expect(paged.body.data.data.map((w: { name: string }) => w.name)).toEqual(['Live Ward']);

    const beds = await request(app).get(`/api/ipd/wards/${toId(live)}/beds`).set('Authorization', auth);
    expect(beds.body.data.map((b: { bedNumber: string }) => b.bedNumber)).toEqual(['L-01']);
    expect((await request(app).get(`/api/ipd/wards/${toId(gone)}/beds`).set('Authorization', auth)).status).toBe(404);

    const occupancy = await request(app).get('/api/ipd/occupancy').set('Authorization', auth);
    expect(occupancy.body.data).toEqual([expect.objectContaining({ wardName: 'Live Ward', total: 1 })]);

    expect(await dashboardRepository.bedStats(tenantId)).toEqual({ total: 1, occupied: 0 });
  });

  test('a deleted ward cannot receive admissions, beds, nurses or package links', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward));
    expect((await deleteWard(toId(ward))).status).toBe(200);
    const patient = await seedPatient();
    const auth = `Bearer ${HA()}`;

    expect((await admit(patient.patientId, toId(ward), toId(bed))).status).toBe(404);
    expect((await request(app).post(`/api/ipd/wards/${toId(ward)}/beds`).set('Authorization', auth)
      .send({ bedNumbers: ['N-01'] })).status).toBe(404);
    expect((await request(app).patch(`/api/ipd/wards/${toId(ward)}/nurses`).set('Authorization', auth)
      .send({ nurseIds: [] })).status).toBe(404);
    expect((await request(app).post('/api/packages').set('Authorization', auth)
      .send({ name: 'Pkg', price: 1, includedServices: ['Stay'], wardId: toId(ward) })).status).toBe(404);
    expect(await IPDAdmissionModel.countDocuments({ wardId: toId(ward) })).toBe(0);
  });

  test("a deleted ward's name and a deleted bed's number can be reused", async () => {
    const ward = await seedWard('Reusable');
    const bed  = await seedBed(toId(ward), 'R-01');
    const auth = `Bearer ${HA()}`;

    expect((await deleteBed(toId(ward), toId(bed))).status).toBe(200);
    const readd = await request(app).post(`/api/ipd/wards/${toId(ward)}/beds`).set('Authorization', auth)
      .send({ bedNumbers: ['R-01'] });
    expect(readd.status).toBe(201);

    expect((await deleteWard(toId(ward))).status).toBe(200);
    const recreate = await request(app).post('/api/ipd/wards').set('Authorization', auth).send({ name: 'Reusable' });
    expect(recreate.status).toBe(201);
    expect(await WardModel.countDocuments({ tenantId, name: 'Reusable' })).toBe(2);
  });
});

// ─── Bed edit / delete ────────────────────────────────────────────────────────

describe('PATCH /api/ipd/wards/:wardId/beds/:bedId', () => {
  test('renames a free bed and writes an audit entry', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward));
    const res  = await editBed(toId(ward), toId(bed), 'G-10');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ bedId: toId(bed), bedNumber: 'G-10' });
    expect((await BedModel.findById(bed._id))?.bedNumber).toBe('G-10');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      entityId: toId(bed), action: 'UPDATE',
      previousValue: { wardId: toId(ward), bedNumber: 'G-01' },
      newValue:      { wardId: toId(ward), bedNumber: 'G-10' },
    }));
  });

  test('rejects a duplicate bed number in the same ward (409) and invalid input (400)', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward), 'G-01');
    await seedBed(toId(ward), 'G-02');
    expect((await editBed(toId(ward), toId(bed), 'G-02')).status).toBe(409);
    expect((await editBed(toId(ward), toId(bed), '   ')).status).toBe(400);
    expect((await BedModel.findById(bed._id))?.bedNumber).toBe('G-01');
  });

  test('blocked (409) for a bed holding an active admission — admission copy unchanged', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward));
    const adm  = await seedAdmission(ward, bed);
    const res  = await editBed(toId(ward), toId(bed), 'G-99');
    expect(res.status).toBe(409);
    expect((await BedModel.findById(bed._id))?.bedNumber).toBe('G-01');
    expect((await IPDAdmissionModel.findOne({ admissionId: adm.admissionId }))?.bedNumber).toBe('G-01');
  });

  test('blocked (409) for a bed flagged occupied even without an admission record', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward), 'G-01', true);
    expect((await editBed(toId(ward), toId(bed), 'G-99')).status).toBe(409);
  });

  test('404 when the bed belongs to another ward or is deleted', async () => {
    const ward  = await seedWard('A');
    const other = await seedWard('B');
    const bed   = await seedBed(toId(ward));
    expect((await editBed(toId(other), toId(bed), 'Z-1')).status).toBe(404);
    await BedModel.updateOne({ _id: bed._id }, { isDeleted: true });
    expect((await editBed(toId(ward), toId(bed), 'Z-1')).status).toBe(404);
  });
});

describe('DELETE /api/ipd/wards/:wardId/beds/:bedId', () => {
  test('soft-deletes a free bed — hidden from pickers, record and audit kept', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward));
    expect((await deleteBed(toId(ward), toId(bed))).status).toBe(200);

    const stored = await BedModel.findById(bed._id);
    expect(stored?.isDeleted).toBe(true);
    expect(stored?.deletedBy).toBe('ha-1');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      entityId: toId(bed), action: 'DELETE', newValue: { isDeleted: true },
    }));

    const patient = await seedPatient();
    expect((await admit(patient.patientId, toId(ward), toId(bed))).status).toBe(404);
    expect((await deleteBed(toId(ward), toId(bed))).status).toBe(404);
  });

  test('blocked (409) while the bed holds an ADMITTED admission', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward));
    await seedAdmission(ward, bed);
    const res = await deleteBed(toId(ward), toId(bed));
    expect(res.status).toBe(409);
    expect((await BedModel.findById(bed._id))?.isDeleted).toBe(false);
  });

  test('blocked (409) while the bed is flagged occupied, even with no admission record', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward), 'G-01', true);
    expect((await deleteBed(toId(ward), toId(bed))).status).toBe(409);
    expect((await BedModel.findById(bed._id))?.isDeleted).toBe(false);
  });

  test('allowed once the patient is discharged — the discharged admission keeps its bed labels', async () => {
    const ward = await seedWard();
    const bed  = await seedBed(toId(ward));
    const past = await seedAdmission(ward, bed, AdmissionStatus.DISCHARGED);
    expect((await deleteBed(toId(ward), toId(bed))).status).toBe(200);
    const stored = await IPDAdmissionModel.findOne({ admissionId: past.admissionId });
    expect(stored).toMatchObject({ bedId: toId(bed), bedNumber: 'G-01', wardName: 'General Ward' });
  });

  test('an active admission cannot be moved onto a deleted bed', async () => {
    const ward = await seedWard();
    const from = await seedBed(toId(ward), 'G-01');
    const to   = await seedBed(toId(ward), 'G-02');
    const adm  = await seedAdmission(ward, from);
    expect((await deleteBed(toId(ward), toId(to))).status).toBe(200);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${adm.admissionId}`)
      .set('Authorization', `Bearer ${HA()}`)
      .send({ bedId: toId(to) });
    expect(res.status).toBe(404);
    expect((await IPDAdmissionModel.findOne({ admissionId: adm.admissionId }))?.bedId).toBe(toId(from));
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────────
// Each race fires both requests together several times. Whatever the
// interleaving, exactly one side must win and the data must stay consistent.

const ROUNDS = 6;

describe('concurrent deletes vs admissions / bed moves', () => {
  test('ward delete racing an admission into that ward: exactly one wins, never an admitted patient in a deleted ward', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const ward    = await seedWard(`Race Ward ${i}`);
      const bed     = await seedBed(toId(ward));
      const patient = await seedPatient();

      const [del, adm] = await Promise.all([deleteWard(toId(ward)), admit(patient.patientId, toId(ward), toId(bed))]);

      const wardDeleted = (await WardModel.findById(ward._id))!.isDeleted;
      const admitted    = await IPDAdmissionModel.countDocuments({ wardId: toId(ward), status: 'ADMITTED' });
      expect([del.status, adm.status].filter((s) => s === 200 || s === 201)).toHaveLength(1);
      if (wardDeleted) {
        expect(del.status).toBe(200);
        expect(admitted).toBe(0);
        expect((await BedModel.findById(bed._id))!.isOccupied).toBe(false);
      } else {
        expect(adm.status).toBe(201);
        expect(del.status).toBe(409);
        expect(admitted).toBe(1);
      }
    }
  });

  test('bed delete racing an admission onto that bed: exactly one wins', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const ward    = await seedWard(`Bed Race ${i}`);
      const bed     = await seedBed(toId(ward));
      const patient = await seedPatient();

      const [del, adm] = await Promise.all([deleteBed(toId(ward), toId(bed)), admit(patient.patientId, toId(ward), toId(bed))]);

      const stored   = (await BedModel.findById(bed._id))!;
      const admitted = await IPDAdmissionModel.countDocuments({ bedId: toId(bed), status: 'ADMITTED' });
      expect([del.status, adm.status].filter((s) => s === 200 || s === 201)).toHaveLength(1);
      if (stored.isDeleted) {
        expect(admitted).toBe(0);
        expect(stored.isOccupied).toBe(false);
      } else {
        expect(admitted).toBe(1);
        expect(stored.isOccupied).toBe(true);
      }
    }
  });

  test('bed delete racing a bed move onto that bed: the admission is never left on a deleted bed', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const ward = await seedWard(`Move Race ${i}`);
      const from = await seedBed(toId(ward), 'M-01');
      const to   = await seedBed(toId(ward), 'M-02');
      const adm  = await seedAdmission(ward, from);

      const [del, move] = await Promise.all([
        deleteBed(toId(ward), toId(to)),
        request(app).patch(`/api/ipd/admissions/${adm.admissionId}`)
          .set('Authorization', `Bearer ${HA()}`).send({ bedId: toId(to) }),
      ]);

      const toBed   = (await BedModel.findById(to._id))!;
      const fromBed = (await BedModel.findById(from._id))!;
      const current = (await IPDAdmissionModel.findOne({ admissionId: adm.admissionId }))!;
      expect([del.status, move.status].filter((s) => s === 200)).toHaveLength(1);
      if (toBed.isDeleted) {
        expect(current.bedId).toBe(toId(from));
        expect(fromBed.isOccupied).toBe(true);
        expect(toBed.isOccupied).toBe(false);
      } else {
        expect(current).toMatchObject({ bedId: toId(to), bedNumber: 'M-02' });
        expect(toBed.isOccupied).toBe(true);
        expect(fromBed.isOccupied).toBe(false);
      }
    }
  });

  test('ward delete racing a bed move into that ward: never an admitted patient in a deleted ward', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const src    = await seedWard(`Src ${i}`);
      const dst    = await seedWard(`Dst ${i}`);
      const from   = await seedBed(toId(src), 'S-01');
      const target = await seedBed(toId(dst), 'D-01');
      const adm    = await seedAdmission(src, from);

      const [del, move] = await Promise.all([
        deleteWard(toId(dst)),
        request(app).patch(`/api/ipd/admissions/${adm.admissionId}`)
          .set('Authorization', `Bearer ${HA()}`).send({ wardId: toId(dst), bedId: toId(target) }),
      ]);

      const dstDeleted = (await WardModel.findById(dst._id))!.isDeleted;
      const current    = (await IPDAdmissionModel.findOne({ admissionId: adm.admissionId }))!;
      expect([del.status, move.status].filter((s) => s === 200)).toHaveLength(1);
      if (dstDeleted) {
        expect(current.wardId).toBe(toId(src));
        expect((await BedModel.findById(from._id))!.isOccupied).toBe(true);
      } else {
        expect(current).toMatchObject({ wardId: toId(dst), wardName: `Dst ${i}`, bedId: toId(target) });
        expect(del.status).toBe(409);
      }
    }
  });

  test('bed rename racing an admission onto that bed: the admission never stores a stale bed number', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const ward    = await seedWard(`Rename Race ${i}`);
      const bed     = await seedBed(toId(ward), 'O-01');
      const patient = await seedPatient();

      const [ren, adm] = await Promise.all([editBed(toId(ward), toId(bed), 'N-01'), admit(patient.patientId, toId(ward), toId(bed))]);

      expect(adm.status).toBe(201);
      const stored    = (await BedModel.findById(bed._id))!;
      const admission = (await IPDAdmissionModel.findOne({ admissionId: adm.body.data.admissionId }))!;
      expect(admission.bedNumber).toBe(stored.bedNumber);
      expect(ren.status === 200 ? 'N-01' : 'O-01').toBe(stored.bedNumber);
    }
  });
});

// ─── Ward delete vs package linking ───────────────────────────────────────────
// Package create / ward re-link / re-activation write the ward document under
// the same lock as the ward soft-delete, so the two can never both commit.

describe('ward delete vs package linking', () => {
  const pkgPayload = (i: number | string) => ({ name: `Race Package ${i}`, price: 1000, includedServices: ['Stay'] });
  const createPkg  = (body: Record<string, unknown>) =>
    request(app).post('/api/packages').set('Authorization', `Bearer ${HA()}`).send(body);
  const patchPkg   = (packageId: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/packages/${packageId}`).set('Authorization', `Bearer ${HA()}`).send(body);
  const activeLinked = (wardId: string) =>
    PackageModel.countDocuments({ wardId, status: 'ACTIVE', isDeleted: { $ne: true } });

  test('package linked first → ward delete is rejected (create, re-link, re-activate)', async () => {
    const w1 = await seedWard('Linked Create');
    expect((await createPkg({ ...pkgPayload(1), wardId: toId(w1) })).status).toBe(201);
    expect((await deleteWard(toId(w1))).status).toBe(409);

    const w2 = await seedWard('Linked Update');
    await PackageModel.create({ packageId: 'PKG-L2', tenantId, name: 'L2', price: 1, status: 'ACTIVE' });
    expect((await patchPkg('PKG-L2', { wardId: toId(w2) })).status).toBe(200);
    expect((await deleteWard(toId(w2))).status).toBe(409);

    const w3 = await seedWard('Linked Reactivate');
    await PackageModel.create({ packageId: 'PKG-L3', tenantId, name: 'L3', price: 1, wardId: toId(w3), status: 'INACTIVE' });
    expect((await patchPkg('PKG-L3', { status: 'ACTIVE' })).status).toBe(200);
    expect((await deleteWard(toId(w3))).status).toBe(409);

    for (const w of [w1, w2, w3]) expect((await WardModel.findById(w._id))!.isDeleted).toBe(false);
  });

  test('ward deleted first → package create / re-link / re-activate is rejected', async () => {
    const ward = await seedWard('Deleted First');
    await PackageModel.create({ packageId: 'PKG-D1', tenantId, name: 'D1', price: 1, status: 'ACTIVE' });
    await PackageModel.create({ packageId: 'PKG-D2', tenantId, name: 'D2', price: 1, wardId: toId(ward), status: 'INACTIVE' });
    expect((await deleteWard(toId(ward))).status).toBe(200);

    expect((await createPkg({ ...pkgPayload('D'), wardId: toId(ward) })).status).toBe(404);
    expect((await patchPkg('PKG-D1', { wardId: toId(ward) })).status).toBe(404);
    expect((await patchPkg('PKG-D2', { status: 'ACTIVE' })).status).toBe(404);
    expect(await activeLinked(toId(ward))).toBe(0);
  });

  test('the repository guard itself rejects a link to a deleted ward (the path a request takes when the delete lands after its pre-check)', async () => {
    const ward = await seedWard('Guard Only');
    await PackageModel.create({ packageId: 'PKG-G1', tenantId, name: 'G1', price: 1, status: 'ACTIVE' });
    expect((await deleteWard(toId(ward))).status).toBe(200);

    await expect(packageRepository.save({
      packageId: 'PKG-G2', tenantId, name: 'G2', price: 1, includedServices: [], status: 'ACTIVE', wardId: toId(ward),
    })).rejects.toMatchObject({ statusCode: 409 });
    await expect(packageRepository.update(tenantId, 'PKG-G1', { wardId: toId(ward) }, toId(ward)))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await PackageModel.countDocuments({ packageId: 'PKG-G2' })).toBe(0);
    expect((await PackageModel.findOne({ packageId: 'PKG-G1' }))!.wardId ?? null).toBeNull();
  });

  type Link = (wardId: string, i: number) => Promise<request.Response>;
  const LINKS: Array<[string, Link]> = [
    ['package create', (wardId, i) => createPkg({ ...pkgPayload(i), wardId })],
    ['package ward re-link', async (wardId, i) => {
      await PackageModel.create({ packageId: `PKG-RL${i}`, tenantId, name: `RL${i}`, price: 1, status: 'ACTIVE' });
      return patchPkg(`PKG-RL${i}`, { wardId });
    }],
    ['package re-activation', async (wardId, i) => {
      await PackageModel.create({ packageId: `PKG-RA${i}`, tenantId, name: `RA${i}`, price: 1, wardId, status: 'INACTIVE' });
      return patchPkg(`PKG-RA${i}`, { status: 'ACTIVE' });
    }],
  ];

  test.each(LINKS)('ward delete racing a %s: exactly one wins, never an active package on a deleted ward', async (_label, link) => {
    for (let i = 0; i < ROUNDS; i++) {
      const ward = await seedWard(`Pkg Race ${_label} ${i}`);

      const [del, lnk] = await Promise.all([deleteWard(toId(ward)), link(toId(ward), i)]);

      const wardDeleted = (await WardModel.findById(ward._id))!.isDeleted;
      const linked      = await activeLinked(toId(ward));
      expect([del.status, lnk.status].filter((s) => s === 200 || s === 201)).toHaveLength(1);
      if (wardDeleted) {
        expect(del.status).toBe(200);
        expect([404, 409]).toContain(lnk.status);
        expect(linked).toBe(0);
      } else {
        expect([200, 201]).toContain(lnk.status);
        expect(del.status).toBe(409);
        expect(linked).toBe(1);
      }
    }
  });
});
