/**
 * Integration tests — U3-B: IPD Admission Lifecycle
 *
 * Dependency note: These tests require U3-A (Ward + Bed models) to be merged.
 * Ward and Bed models are imported from their U3-A locations.
 * Run after `feature/u3-bed-registry` is merged into `unit/3-ipd`.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose              from 'mongoose';
import request               from 'supertest';
import jwt                   from 'jsonwebtoken';

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

import app             from '../../../src/app';
import { TenantModel } from '../../../src/modules/tenant/tenant.model';
import { UserModel }   from '../../../src/modules/auth/auth.model';
import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
// U3-A models — available after feature/u3-bed-registry merges
import { WardModel }   from '../../../src/modules/ipd/ward.model';
import { BedModel }    from '../../../src/modules/ipd/bed.model';
import { PatientModel } from '../../../src/modules/patient/patient.model';
import { OPDVisitModel } from '../../../src/modules/opd/opd.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { AdmissionStatus } from '../../../src/modules/ipd/ipd.types';

const JWT_SECRET = process.env['JWT_SECRET']!;

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toId(doc: mongoose.Document): string {
  return (doc._id as mongoose.Types.ObjectId).toString();
}

async function seedTenant() {
  return TenantModel.create({
    name:      'Integration Hospital',
    status:    TenantStatus.ACTIVE,
    adminEmail: 'admin@inttest.com',
    onboardingDocuments: {
      registrationCertificate: 's3-key-1',
      gstNumber:               'GST123',
      panCard:                 's3-key-2',
      addressLine:            '789 IPD Avenue',
      city:                    'Mumbai',
      state:                   'Maharashtra',
      pincode:                 '400001',
    },
    branding: { displayName: 'Integration Hospital', primaryColor: '#000', logoUrl: null },
  });
}

async function seedUser(role: UserRole, tenantId: string) {
  return UserModel.create({
    name:         `Test ${role}`,
    tenantId,
    email:        `${role.toLowerCase()}@inttest.com`,
    passwordHash: '$2a$12$hashedpwd',
    role,
    isActive:     true,
    isFirstLogin: false,
  });
}

async function seedPatient(tenantId: string) {
  return PatientModel.create({
    patientId:    'PAT-INT00001',
    tenantId,
    fullName:     'Test Patient',
    dateOfBirth:  new Date('1985-01-01'),
    gender:       'MALE',
    mobileNumber: '9000000001',
    address:      'Test Address, City',
  });
}

async function seedWard(tenantId: string) {
  return WardModel.create({
    name:     'General Ward',
    tenantId,
  });
}

async function seedBed(wardId: string, tenantId: string, isOccupied = false) {
  return BedModel.create({
    wardId,
    bedNumber:  'G-01',
    isOccupied,
    tenantId,
  });
}

function makeToken(userId: string, tenantId: string, role: UserRole) {
  return jwt.sign(
    { userId, tenantId, role, email: `${role}@test.com`, isFirstLogin: false },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

// ─── Integration Checkpoint Tests ────────────────────────────────────────────

describe('POST /api/ipd/admissions', () => {
  test('creates admission with status ADMITTED and assigns bed', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant));
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));
    const token   = makeToken('recept-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId:        patient.patientId,
        wardId:           toId(ward),
        bedId:            toId(bed),
        assignedDoctorId: toId(doctor),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(AdmissionStatus.ADMITTED);
    expect(res.body.data.admissionId).toBeDefined();
    expect(res.body.data.bedNumber).toBe('G-01');

    // Bed should now be occupied
    const updatedBed = await BedModel.findById(bed._id);
    expect(updatedBed?.isOccupied).toBe(true);
  });

  test('returns 409 with occupant admissionId when bed is already occupied', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant), true);
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));

    // Pre-existing ADMITTED admission for this bed
    await IPDAdmissionModel.create({
      admissionId:      'existing-adm-001',
      patientId:        patient.patientId,
      wardId:           toId(ward),
      wardName:         ward.name,
      bedId:            toId(bed),
      bedNumber:        bed.bedNumber,
      assignedDoctorId: toId(doctor),
      status:           AdmissionStatus.ADMITTED,
      admissionDate:    new Date(),
      dischargeDate:    null,
      progressNotes:    [],
      tenantId:         toId(tenant),
    });

    const token = makeToken('recept-001', toId(tenant), UserRole.RECEPTIONIST);
    const res = await request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId:        patient.patientId,
        wardId:           toId(ward),
        bedId:            toId(bed),
        assignedDoctorId: toId(doctor),
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('existing-adm-001');
  });

  test('returns 403 when non-RECEPTIONIST attempts to create admission', async () => {
    const tenant = await seedTenant();
    const token  = makeToken('doctor-001', toId(tenant), UserRole.DOCTOR);

    const res = await request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  test('returns 401 when no token provided', async () => {
    const res = await request(app).post('/api/ipd/admissions').send({});
    expect(res.status).toBe(401);
  });
});

const ADM_PROG_ID       = 'a1000000-0000-0000-0000-000000000001';
const ADM_DISCHARGED_ID = 'a1000000-0000-0000-0000-000000000002';

describe('POST /api/ipd/admissions/:admissionId/progress-notes', () => {
  async function createAdmission(tenantId: string, patientId: string, wardId: string, bedId: string, doctorId: string) {
    return IPDAdmissionModel.create({
      admissionId:       ADM_PROG_ID,
      patientId,
      wardId,
      wardName:          'General Ward',
      bedId,
      bedNumber:         'G-01',
      assignedDoctorIds: [doctorId],
      status:            AdmissionStatus.ADMITTED,
      admissionDate:     new Date(),
      dischargeDate:     null,
      progressNotes:     [],
      tenantId,
    });
  }

  test('adds progress note to ADMITTED admission', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant));
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));
    await createAdmission(toId(tenant), patient.patientId, toId(ward), toId(bed), toId(doctor));

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .post(`/api/ipd/admissions/${ADM_PROG_ID}/progress-notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Patient is stable, vitals normal.' });

    expect(res.status).toBe(201);
    expect(res.body.data.progressNotes).toHaveLength(1);
    expect(res.body.data.progressNotes[0].note).toBe('Patient is stable, vitals normal.');
    expect(res.body.data.progressNotes[0].doctorId).toBe(toId(doctor));
    expect(res.body.data.progressNotes[0].staffName).toBe(doctor.name);
  });

  test('a note added by a Nurse shows the nurse\'s name, not "Dr."', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant));
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));
    const nurse   = await seedUser(UserRole.NURSE, toId(tenant));
    await createAdmission(toId(tenant), patient.patientId, toId(ward), toId(bed), toId(doctor));

    const token = makeToken(toId(nurse), toId(tenant), UserRole.NURSE);
    const res   = await request(app)
      .post(`/api/ipd/admissions/${ADM_PROG_ID}/progress-notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Administered medication as prescribed.' });

    expect(res.status).toBe(201);
    expect(res.body.data.progressNotes[0].doctorId).toBe(toId(nurse));
    expect(res.body.data.progressNotes[0].staffName).toBe(nurse.name);
    expect(res.body.data.progressNotes[0].staffName).not.toMatch(/^Dr\./);
  });

  test('GET admission by ID resolves staff names for all progress notes, doctor and nurse alike', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant));
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));
    const nurse   = await seedUser(UserRole.NURSE, toId(tenant));
    await createAdmission(toId(tenant), patient.patientId, toId(ward), toId(bed), toId(doctor));

    const doctorToken = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const nurseToken  = makeToken(toId(nurse), toId(tenant), UserRole.NURSE);

    await request(app)
      .post(`/api/ipd/admissions/${ADM_PROG_ID}/progress-notes`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ note: 'Doctor note' });
    await request(app)
      .post(`/api/ipd/admissions/${ADM_PROG_ID}/progress-notes`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ note: 'Nurse note' });

    const res = await request(app)
      .get(`/api/ipd/admissions/${ADM_PROG_ID}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    const notes = res.body.data.progressNotes;
    expect(notes).toHaveLength(2);
    expect(notes.find((n: { note: string }) => n.note === 'Doctor note').staffName).toBe(doctor.name);
    expect(notes.find((n: { note: string }) => n.note === 'Nurse note').staffName).toBe(nurse.name);
  });

  test('returns 400 when adding note to DISCHARGED admission', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant));
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));

    await IPDAdmissionModel.create({
      admissionId:      ADM_DISCHARGED_ID,
      patientId:        patient.patientId,
      wardId:           toId(ward),
      wardName:         'General Ward',
      bedId:            toId(bed),
      bedNumber:        'G-01',
      assignedDoctorId: toId(doctor),
      status:           AdmissionStatus.DISCHARGED,
      admissionDate:    new Date(),
      dischargeDate:    new Date(),
      progressNotes:    [],
      tenantId:         toId(tenant),
    });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .post(`/api/ipd/admissions/${ADM_DISCHARGED_ID}/progress-notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Should fail' });

    expect(res.status).toBe(400);
  });
});

const ADM_TO_DISCHARGE_ID  = 'b2000000-0000-0000-0000-000000000001';
const ADM_ALREADY_DIS_ID   = 'b2000000-0000-0000-0000-000000000002';

describe('PATCH /api/ipd/admissions/:admissionId/discharge', () => {
  test('sets DISCHARGED status and releases bed', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant), true);
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));

    await IPDAdmissionModel.create({
      admissionId:      ADM_TO_DISCHARGE_ID,
      patientId:        patient.patientId,
      wardId:           toId(ward),
      wardName:         ward.name,
      bedId:            toId(bed),
      bedNumber:        bed.bedNumber,
      assignedDoctorId: toId(doctor),
      status:           AdmissionStatus.ADMITTED,
      admissionDate:    new Date(),
      dischargeDate:    null,
      progressNotes:    [],
      tenantId:         toId(tenant),
    });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .patch(`/api/ipd/admissions/${ADM_TO_DISCHARGE_ID}/discharge`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(AdmissionStatus.DISCHARGED);
    expect(res.body.data.dischargeDate).not.toBeNull();

    // Bed must be released
    const updatedBed = await BedModel.findById(bed._id);
    expect(updatedBed?.isOccupied).toBe(false);
  });

  test('returns 400 when discharging an already-discharged patient', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(UserRole.DOCTOR, toId(tenant));

    await IPDAdmissionModel.create({
      admissionId:      ADM_ALREADY_DIS_ID,
      patientId:        'PAT-INT00001',
      wardId:           'ward-placeholder',
      wardName:         'General Ward',
      bedId:            'bed-placeholder',
      bedNumber:        'G-01',
      assignedDoctorId: toId(doctor),
      status:           AdmissionStatus.DISCHARGED,
      admissionDate:    new Date(),
      dischargeDate:    new Date(),
      progressNotes:    [],
      tenantId:         toId(tenant),
    });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .patch(`/api/ipd/admissions/${ADM_ALREADY_DIS_ID}/discharge`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/ipd/bed-occupancy', () => {
  test('returns occupancy summary with total === occupied + available per ward', async () => {
    const tenant = await seedTenant();
    const ward   = await seedWard(toId(tenant));
    await BedModel.create([
      { wardId: toId(ward), bedNumber: 'G-01', isOccupied: true,  tenantId: toId(tenant) },
      { wardId: toId(ward), bedNumber: 'G-02', isOccupied: false, tenantId: toId(tenant) },
      { wardId: toId(ward), bedNumber: 'G-03', isOccupied: false, tenantId: toId(tenant) },
    ]);

    const token = makeToken('manager-001', toId(tenant), UserRole.MANAGER);
    const res   = await request(app)
      .get('/api/ipd/bed-occupancy')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const summary = res.body.data;
    expect(summary).toHaveLength(1);
    const ward1 = summary[0];
    expect(ward1.total).toBe(3);
    expect(ward1.occupied).toBe(1);
    expect(ward1.available).toBe(2);
    // Integration checkpoint invariant
    expect(ward1.occupied + ward1.available).toBe(ward1.total);
  });
});

describe('GET /api/ipd/admissions', () => {
  test('returns paginated ADMITTED admissions filtered by ward (Hospital Admin, unrestricted)', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(UserRole.DOCTOR, toId(tenant));

    await IPDAdmissionModel.create([
      {
        admissionId: 'a1', patientId: 'p1', wardId: 'ward-int-001', wardName: 'General Ward',
        bedId: 'b1', bedNumber: 'G-01', assignedDoctorId: toId(doctor),
        status: AdmissionStatus.ADMITTED, admissionDate: new Date(),
        dischargeDate: null, progressNotes: [], tenantId: toId(tenant),
      },
      {
        admissionId: 'a2', patientId: 'p2', wardId: 'ward-int-002', wardName: 'ICU',
        bedId: 'b2', bedNumber: 'I-01', assignedDoctorId: toId(doctor),
        status: AdmissionStatus.ADMITTED, admissionDate: new Date(),
        dischargeDate: null, progressNotes: [], tenantId: toId(tenant),
      },
    ]);

    const token = makeToken('admin-001', toId(tenant), UserRole.HOSPITAL_ADMIN);
    const res   = await request(app)
      .get('/api/ipd/admissions?wardId=ward-int-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].wardId).toBe('ward-int-001');
    expect(res.body.data.total).toBe(1);
  });
});

// ─── Nurse ward-scoped access (backend-enforced) ─────────────────────────────
describe('Nurse ward-scoped access restriction', () => {
  async function seedAdmission(opts: {
    admissionId: string; patientId: string; wardId: string; wardName: string;
    bedId: string; bedNumber: string; tenantId: string;
  }) {
    return IPDAdmissionModel.create({
      admissionId:       opts.admissionId,
      patientId:         opts.patientId,
      wardId:            opts.wardId,
      wardName:          opts.wardName,
      bedId:             opts.bedId,
      bedNumber:         opts.bedNumber,
      assignedDoctorIds: [],
      status:            AdmissionStatus.ADMITTED,
      admissionDate:     new Date(),
      dischargeDate:     null,
      progressNotes:     [],
      tenantId:          opts.tenantId,
    });
  }

  test('nurse sees only admissions in their assigned ward (GET /api/ipd/admissions)', async () => {
    const tenant = await seedTenant();
    const nurse  = await seedUser(UserRole.NURSE, toId(tenant));
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: toId(tenant), assignedNurseIds: [toId(nurse)] });
    const wardB  = await WardModel.create({ name: 'Ward B', tenantId: toId(tenant) });

    await seedAdmission({ admissionId: 'nw-a1', patientId: 'PAT-A', wardId: toId(wardA), wardName: 'Ward A', bedId: 'bed-a', bedNumber: 'A-01', tenantId: toId(tenant) });
    await seedAdmission({ admissionId: 'nw-b1', patientId: 'PAT-B', wardId: toId(wardB), wardName: 'Ward B', bedId: 'bed-b', bedNumber: 'B-01', tenantId: toId(tenant) });

    const token = makeToken(toId(nurse), toId(tenant), UserRole.NURSE);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].wardId).toBe(toId(wardA));
  });

  test('nurse cannot use the wardId query param to view another ward (returns empty, not 403)', async () => {
    const tenant = await seedTenant();
    const nurse  = await seedUser(UserRole.NURSE, toId(tenant));
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: toId(tenant), assignedNurseIds: [toId(nurse)] });
    const wardB  = await WardModel.create({ name: 'Ward B', tenantId: toId(tenant) });

    await seedAdmission({ admissionId: 'nw-a2', patientId: 'PAT-A2', wardId: toId(wardA), wardName: 'Ward A', bedId: 'bed-a2', bedNumber: 'A-02', tenantId: toId(tenant) });
    await seedAdmission({ admissionId: 'nw-b2', patientId: 'PAT-B2', wardId: toId(wardB), wardName: 'Ward B', bedId: 'bed-b2', bedNumber: 'B-02', tenantId: toId(tenant) });

    const token = makeToken(toId(nurse), toId(tenant), UserRole.NURSE);
    const res   = await request(app)
      .get(`/api/ipd/admissions?wardId=${toId(wardB)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
  });

  test('direct API access to another ward\'s admission by ID is blocked (404)', async () => {
    const tenant = await seedTenant();
    const nurse  = await seedUser(UserRole.NURSE, toId(tenant));
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: toId(tenant), assignedNurseIds: [toId(nurse)] });
    const wardB  = await WardModel.create({ name: 'Ward B', tenantId: toId(tenant) });

    const OWN_ID     = 'c3000000-0000-0000-0000-000000000001';
    const FOREIGN_ID = 'c3000000-0000-0000-0000-000000000002';
    await seedAdmission({ admissionId: OWN_ID, patientId: 'PAT-OWN', wardId: toId(wardA), wardName: 'Ward A', bedId: 'bed-own', bedNumber: 'A-03', tenantId: toId(tenant) });
    await seedAdmission({ admissionId: FOREIGN_ID, patientId: 'PAT-FOR', wardId: toId(wardB), wardName: 'Ward B', bedId: 'bed-for', bedNumber: 'B-03', tenantId: toId(tenant) });

    const token = makeToken(toId(nurse), toId(tenant), UserRole.NURSE);

    const ownRes = await request(app)
      .get(`/api/ipd/admissions/${OWN_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(ownRes.status).toBe(200);

    const foreignRes = await request(app)
      .get(`/api/ipd/admissions/${FOREIGN_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(foreignRes.status).toBe(404);
  });

  test('nurse with no ward assigned gets an empty admissions list, not an error', async () => {
    const tenant = await seedTenant();
    const nurse  = await seedUser(UserRole.NURSE, toId(tenant));
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: toId(tenant) }); // no assignedNurseIds

    await seedAdmission({ admissionId: 'nw-noward', patientId: 'PAT-NW', wardId: toId(wardA), wardName: 'Ward A', bedId: 'bed-nw', bedNumber: 'A-04', tenantId: toId(tenant) });

    const token = makeToken(toId(nurse), toId(tenant), UserRole.NURSE);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
  });

  test('other roles (Receptionist) are unaffected by the nurse ward restriction', async () => {
    const tenant       = await seedTenant();
    const receptionist = await seedUser(UserRole.RECEPTIONIST, toId(tenant));
    const wardA        = await WardModel.create({ name: 'Ward A', tenantId: toId(tenant) });
    const wardB        = await WardModel.create({ name: 'Ward B', tenantId: toId(tenant) });

    await seedAdmission({ admissionId: 'doc-a', patientId: 'PAT-DA', wardId: toId(wardA), wardName: 'Ward A', bedId: 'bed-da', bedNumber: 'A-05', tenantId: toId(tenant) });
    await seedAdmission({ admissionId: 'doc-b', patientId: 'PAT-DB', wardId: toId(wardB), wardName: 'Ward B', bedId: 'bed-db', bedNumber: 'B-05', tenantId: toId(tenant) });

    const token = makeToken(toId(receptionist), toId(tenant), UserRole.RECEPTIONIST);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
  });
});

describe('Doctor patient-assignment scoping', () => {
  // seedUser() uses a fixed email per role, so a second DOCTOR in the same
  // tenant needs its own distinct email to avoid a unique-index collision.
  async function seedOtherDoctor(tenantId: string) {
    return UserModel.create({
      name:         'Other Doctor',
      tenantId,
      email:        'other-doctor@inttest.com',
      passwordHash: '$2a$12$hashedpwd',
      role:         UserRole.DOCTOR,
      isActive:     true,
      isFirstLogin: false,
    });
  }

  async function seedAdmission(opts: {
    admissionId: string; patientId: string; assignedDoctorIds: string[]; tenantId: string;
  }) {
    return IPDAdmissionModel.create({
      admissionId:       opts.admissionId,
      patientId:         opts.patientId,
      wardId:            'ward-1',
      wardName:          'General Ward',
      bedId:             'bed-1',
      bedNumber:         'B-01',
      assignedDoctorIds: opts.assignedDoctorIds,
      status:            AdmissionStatus.ADMITTED,
      admissionDate:     new Date(),
      dischargeDate:     null,
      progressNotes:     [],
      tenantId:          opts.tenantId,
    });
  }

  test('200 — doctor can fetch an admission they are assigned to via direct admissionId', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(UserRole.DOCTOR, toId(tenant));
    const ADM_ID = 'd1000000-0000-0000-0000-000000000001';

    await seedAdmission({ admissionId: ADM_ID, patientId: 'PAT-DOC-001', assignedDoctorIds: [toId(doctor)], tenantId: toId(tenant) });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app).get(`/api/ipd/admissions/${ADM_ID}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.admissionId).toBe(ADM_ID);
  });

  test('404 — doctor cannot fetch another doctor\'s patient\'s admission via direct admissionId (Direct URL / manual ID)', async () => {
    const tenant = await seedTenant();
    const doctor      = await seedUser(UserRole.DOCTOR, toId(tenant));
    const otherDoctor = await seedOtherDoctor(toId(tenant));
    const ADM_ID = 'd1000000-0000-0000-0000-000000000002';

    await seedAdmission({ admissionId: ADM_ID, patientId: 'PAT-DOC-002', assignedDoctorIds: [toId(otherDoctor)], tenantId: toId(tenant) });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app).get(`/api/ipd/admissions/${ADM_ID}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('404 — doctor with no assigned patients cannot fetch any admission by direct ID', async () => {
    const tenant = await seedTenant();
    const doctor      = await seedUser(UserRole.DOCTOR, toId(tenant));
    const otherDoctor = await seedOtherDoctor(toId(tenant));
    const ADM_ID = 'd1000000-0000-0000-0000-000000000003';

    await seedAdmission({ admissionId: ADM_ID, patientId: 'PAT-DOC-003', assignedDoctorIds: [toId(otherDoctor)], tenantId: toId(tenant) });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app).get(`/api/ipd/admissions/${ADM_ID}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('200 — other roles (Receptionist) continue to fetch any admission by direct ID as before', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(UserRole.DOCTOR, toId(tenant));
    const receptionist = await seedUser(UserRole.RECEPTIONIST, toId(tenant));
    const ADM_ID = 'd1000000-0000-0000-0000-000000000004';

    await seedAdmission({ admissionId: ADM_ID, patientId: 'PAT-DOC-004', assignedDoctorIds: [toId(doctor)], tenantId: toId(tenant) });

    const token = makeToken(toId(receptionist), toId(tenant), UserRole.RECEPTIONIST);
    const res   = await request(app).get(`/api/ipd/admissions/${ADM_ID}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/ipd/patients/:patientId/history — doctor sees only their own assigned patient\'s IPD history; 404 for another doctor\'s patient', async () => {
    const tenant = await seedTenant();
    const doctor      = await seedUser(UserRole.DOCTOR, toId(tenant));
    const otherDoctor = await seedOtherDoctor(toId(tenant));

    await PatientModel.create({
      patientId: 'PAT-DOCH001', tenantId: toId(tenant), fullName: 'Own Patient',
      dateOfBirth: new Date('1985-01-01'), gender: 'MALE',
      mobileNumber: '9000000011', address: 'Addr',
    });
    await seedAdmission({ admissionId: 'd1000000-0000-0000-0000-000000000005', patientId: 'PAT-DOCH001', assignedDoctorIds: [toId(doctor)], tenantId: toId(tenant) });

    await PatientModel.create({
      patientId: 'PAT-DOCH002', tenantId: toId(tenant), fullName: 'Other Doctor Patient',
      dateOfBirth: new Date('1985-01-01'), gender: 'MALE',
      mobileNumber: '9000000012', address: 'Addr',
    });
    await seedAdmission({ admissionId: 'd1000000-0000-0000-0000-000000000006', patientId: 'PAT-DOCH002', assignedDoctorIds: [toId(otherDoctor)], tenantId: toId(tenant) });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);

    const ownHistory = await request(app)
      .get('/api/ipd/patients/PAT-DOCH001/history')
      .set('Authorization', `Bearer ${token}`);
    expect(ownHistory.status).toBe(200);
    expect(ownHistory.body.data.total).toBe(1);

    const otherHistory = await request(app)
      .get('/api/ipd/patients/PAT-DOCH002/history')
      .set('Authorization', `Bearer ${token}`);
    expect(otherHistory.status).toBe(404);
  });
});

// ─── GET /api/ipd/admissions — doctor OPD+IPD patient-scoping ────────────────
describe('GET /api/ipd/admissions — doctor patient-assignment scoping (OPD + IPD)', () => {
  async function seedAdmission(opts: {
    admissionId: string; patientId: string; assignedDoctorIds: string[]; tenantId: string;
  }) {
    return IPDAdmissionModel.create({
      admissionId:       opts.admissionId,
      patientId:         opts.patientId,
      wardId:            'ward-1',
      wardName:          'General Ward',
      bedId:             `bed-${opts.admissionId}`,
      bedNumber:         'B-01',
      assignedDoctorIds: opts.assignedDoctorIds,
      status:            AdmissionStatus.ADMITTED,
      admissionDate:     new Date(),
      dischargeDate:     null,
      progressNotes:     [],
      tenantId:          opts.tenantId,
    });
  }

  test('200 — a patient assigned to the doctor only through an OPD visit has their IPD admission listed', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(UserRole.DOCTOR, toId(tenant));
    const ADM_ID = 'e1000000-0000-0000-0000-000000000001';

    await OPDVisitModel.create({
      visitId:        'OPD-LIST0001',
      tenantId:       toId(tenant),
      patientId:      'PAT-LIST-OPD',
      doctorIds:      [toId(doctor)],
      departmentId:   null,
      visitDate:      new Date(),
      queueNumber:    1,
      status:         'OPEN',
      chiefComplaint: 'Routine checkup',
    });
    // Admission itself has no assignedDoctorIds — the doctor is only linked via OPD.
    await seedAdmission({ admissionId: ADM_ID, patientId: 'PAT-LIST-OPD', assignedDoctorIds: [], tenantId: toId(tenant) });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data.map((a: { admissionId: string }) => a.admissionId)).toContain(ADM_ID);
  });

  test('200 — a patient assigned to the doctor through IPD assignedDoctorIds remains listed', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(UserRole.DOCTOR, toId(tenant));
    const ADM_ID = 'e1000000-0000-0000-0000-000000000002';

    await seedAdmission({ admissionId: ADM_ID, patientId: 'PAT-LIST-IPD', assignedDoctorIds: [toId(doctor)], tenantId: toId(tenant) });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data.map((a: { admissionId: string }) => a.admissionId)).toContain(ADM_ID);
  });

  test('200 — a patient assigned through neither OPD nor IPD is not listed', async () => {
    const tenant      = await seedTenant();
    const doctor      = await seedUser(UserRole.DOCTOR, toId(tenant));
    const otherDoctor = await UserModel.create({
      name: 'Other Doctor', tenantId: toId(tenant), email: 'other-list-doctor@inttest.com',
      passwordHash: '$2a$12$hashedpwd', role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
    });
    const ADM_ID = 'e1000000-0000-0000-0000-000000000003';

    await seedAdmission({ admissionId: ADM_ID, patientId: 'PAT-LIST-NONE', assignedDoctorIds: [toId(otherDoctor)], tenantId: toId(tenant) });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data.map((a: { admissionId: string }) => a.admissionId)).not.toContain(ADM_ID);
  });

  test('200 — nurse ward scoping is unaffected by the doctor patient-scope change', async () => {
    const tenant = await seedTenant();
    const nurse  = await seedUser(UserRole.NURSE, toId(tenant));
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: toId(tenant), assignedNurseIds: [toId(nurse)] });
    const wardB  = await WardModel.create({ name: 'Ward B', tenantId: toId(tenant) });

    await IPDAdmissionModel.create({
      admissionId: 'e1000000-0000-0000-0000-000000000004', patientId: 'PAT-LIST-WA',
      wardId: toId(wardA), wardName: 'Ward A', bedId: 'bed-wa', bedNumber: 'A-01',
      assignedDoctorIds: [], status: AdmissionStatus.ADMITTED, admissionDate: new Date(),
      dischargeDate: null, progressNotes: [], tenantId: toId(tenant),
    });
    await IPDAdmissionModel.create({
      admissionId: 'e1000000-0000-0000-0000-000000000005', patientId: 'PAT-LIST-WB',
      wardId: toId(wardB), wardName: 'Ward B', bedId: 'bed-wb', bedNumber: 'B-01',
      assignedDoctorIds: [], status: AdmissionStatus.ADMITTED, admissionDate: new Date(),
      dischargeDate: null, progressNotes: [], tenantId: toId(tenant),
    });

    const token = makeToken(toId(nurse), toId(tenant), UserRole.NURSE);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].wardId).toBe(toId(wardA));
  });

  test('200 — other roles (Receptionist) continue to see all admissions as before', async () => {
    const tenant = await seedTenant();
    const receptionist = await seedUser(UserRole.RECEPTIONIST, toId(tenant));

    await seedAdmission({ admissionId: 'e1000000-0000-0000-0000-000000000006', patientId: 'PAT-LIST-RC1', assignedDoctorIds: [], tenantId: toId(tenant) });
    await seedAdmission({ admissionId: 'e1000000-0000-0000-0000-000000000007', patientId: 'PAT-LIST-RC2', assignedDoctorIds: [], tenantId: toId(tenant) });

    const token = makeToken(toId(receptionist), toId(tenant), UserRole.RECEPTIONIST);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
  });
});

describe('PATCH /api/ipd/wards/:wardId/nurses', () => {
  test('ADMIN can assign nurses to a ward', async () => {
    const tenant = await seedTenant();
    const nurse  = await seedUser(UserRole.NURSE, toId(tenant));
    const ward   = await seedWard(toId(tenant));
    const token  = makeToken('admin-role-001', toId(tenant), UserRole.ADMIN);

    const res = await request(app)
      .patch(`/api/ipd/wards/${toId(ward)}/nurses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nurseIds: [toId(nurse)] });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedNurseIds).toEqual([toId(nurse)]);
  });

  test('HOSPITAL_ADMIN can still assign nurses to a ward (unchanged)', async () => {
    const tenant = await seedTenant();
    const nurse  = await seedUser(UserRole.NURSE, toId(tenant));
    const ward   = await seedWard(toId(tenant));
    const token  = makeToken('hosp-admin-001', toId(tenant), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch(`/api/ipd/wards/${toId(ward)}/nurses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nurseIds: [toId(nurse)] });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedNurseIds).toEqual([toId(nurse)]);
  });

  test('DOCTOR can still assign nurses to a ward (unchanged)', async () => {
    const tenant = await seedTenant();
    const nurse  = await seedUser(UserRole.NURSE, toId(tenant));
    const ward   = await seedWard(toId(tenant));
    const token  = makeToken('doctor-001', toId(tenant), UserRole.DOCTOR);

    const res = await request(app)
      .patch(`/api/ipd/wards/${toId(ward)}/nurses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nurseIds: [toId(nurse)] });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedNurseIds).toEqual([toId(nurse)]);
  });

  test('returns 403 for RECEPTIONIST role (unauthorized role remains blocked)', async () => {
    const tenant = await seedTenant();
    const ward   = await seedWard(toId(tenant));
    const token  = makeToken('recept-002', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch(`/api/ipd/wards/${toId(ward)}/nurses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nurseIds: [] });

    expect(res.status).toBe(403);
  });
});

// ─── Middleware order: requireRole must run before requireFirstPasswordChange ─
describe('IPD route middleware order — requireRole before requireFirstPasswordChange', () => {
  function makeFirstLoginToken(userId: string, tenantId: string, role: UserRole) {
    return jwt.sign(
      { userId, tenantId, role, email: `${role}@test.com`, isFirstLogin: true },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
  }

  test('403 "Access denied" (not password-change) for a disallowed role even with isFirstLogin — requireRole runs first', async () => {
    const tenant = await seedTenant();
    const token  = makeFirstLoginToken('patho-001', toId(tenant), UserRole.PATHOLOGIST);

    const res = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/access denied/i);
    expect(res.body.message).not.toMatch(/password/i);
  });

  test('403 "Password change required" for an allowed role with isFirstLogin — requireFirstPasswordChange still active after requireRole', async () => {
    const tenant = await seedTenant();
    const token  = makeFirstLoginToken('recept-fpc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/password change required/i);
  });

  test('200 for an allowed role without isFirstLogin (unaffected baseline behavior)', async () => {
    const tenant = await seedTenant();
    const token  = makeToken('recept-fpc-002', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
