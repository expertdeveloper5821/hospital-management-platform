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

async function seedTenant() {
  return TenantModel.create({
    tenantId: 'tenant-int-001',
    name:     'Integration Hospital',
    status:   TenantStatus.ACTIVE,
    branding: { displayName: 'Integration Hospital', primaryColor: '#000', logoUrl: null },
    adminEmail: 'admin@inttest.com',
  });
}

async function seedUser(role: UserRole, tenantId: string) {
  return UserModel.create({
    userId:       `user-${role.toLowerCase()}-001`,
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
    patientId:    'PAT-INT001',
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
    wardId:   'ward-int-001',
    wardName: 'General Ward',
    tenantId,
  });
}

async function seedBed(wardId: string, tenantId: string, isOccupied = false) {
  return BedModel.create({
    bedId:      'bed-int-001',
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
    const patient = await seedPatient(tenant.tenantId);
    const ward    = await seedWard(tenant.tenantId);
    const bed     = await seedBed(ward.wardId, tenant.tenantId);
    const doctor  = await seedUser(UserRole.DOCTOR, tenant.tenantId);
    const token   = makeToken('recept-001', tenant.tenantId, UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId:        patient.patientId,
        wardId:           ward.wardId,
        bedId:            bed.bedId,
        assignedDoctorId: doctor.userId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(AdmissionStatus.ADMITTED);
    expect(res.body.data.admissionId).toBeDefined();
    expect(res.body.data.bedNumber).toBe('G-01');

    // Bed should now be occupied
    const updatedBed = await BedModel.findOne({ bedId: bed.bedId });
    expect(updatedBed?.isOccupied).toBe(true);
  });

  test('returns 409 with occupant admissionId when bed is already occupied', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(tenant.tenantId);
    const ward    = await seedWard(tenant.tenantId);
    const bed     = await seedBed(ward.wardId, tenant.tenantId, true);
    const doctor  = await seedUser(UserRole.DOCTOR, tenant.tenantId);

    // Pre-existing ADMITTED admission for this bed
    await IPDAdmissionModel.create({
      admissionId:      'existing-adm-001',
      patientId:        patient.patientId,
      wardId:           ward.wardId,
      wardName:         ward.wardName,
      bedId:            bed.bedId,
      bedNumber:        bed.bedNumber,
      assignedDoctorId: doctor.userId,
      status:           AdmissionStatus.ADMITTED,
      admissionDate:    new Date(),
      dischargeDate:    null,
      progressNotes:    [],
      tenantId:         tenant.tenantId,
    });

    const token = makeToken('recept-001', tenant.tenantId, UserRole.RECEPTIONIST);
    const res = await request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId:        patient.patientId,
        wardId:           ward.wardId,
        bedId:            bed.bedId,
        assignedDoctorId: doctor.userId,
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('existing-adm-001');
  });

  test('returns 403 when non-RECEPTIONIST attempts to create admission', async () => {
    const tenant = await seedTenant();
    const token  = makeToken('doctor-001', tenant.tenantId, UserRole.DOCTOR);

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

describe('POST /api/ipd/admissions/:admissionId/progress-notes', () => {
  async function createAdmission(tenantId: string, patientId: string, wardId: string, bedId: string, doctorId: string) {
    return IPDAdmissionModel.create({
      admissionId:      'adm-prog-001',
      patientId,
      wardId,
      wardName:         'General Ward',
      bedId,
      bedNumber:        'G-01',
      assignedDoctorId: doctorId,
      status:           AdmissionStatus.ADMITTED,
      admissionDate:    new Date(),
      dischargeDate:    null,
      progressNotes:    [],
      tenantId,
    });
  }

  test('adds progress note to ADMITTED admission', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(tenant.tenantId);
    const ward    = await seedWard(tenant.tenantId);
    const bed     = await seedBed(ward.wardId, tenant.tenantId);
    const doctor  = await seedUser(UserRole.DOCTOR, tenant.tenantId);
    await createAdmission(tenant.tenantId, patient.patientId, ward.wardId, bed.bedId, doctor.userId);

    const token = makeToken(doctor.userId, tenant.tenantId, UserRole.DOCTOR);
    const res   = await request(app)
      .post('/api/ipd/admissions/adm-prog-001/progress-notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Patient is stable, vitals normal.' });

    expect(res.status).toBe(201);
    expect(res.body.data.progressNotes).toHaveLength(1);
    expect(res.body.data.progressNotes[0].note).toBe('Patient is stable, vitals normal.');
    expect(res.body.data.progressNotes[0].doctorId).toBe(doctor.userId);
  });

  test('returns 400 when adding note to DISCHARGED admission', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(tenant.tenantId);
    const ward    = await seedWard(tenant.tenantId);
    const bed     = await seedBed(ward.wardId, tenant.tenantId);
    const doctor  = await seedUser(UserRole.DOCTOR, tenant.tenantId);

    await IPDAdmissionModel.create({
      admissionId:      'adm-discharged-001',
      patientId:        patient.patientId,
      wardId:           ward.wardId,
      wardName:         'General Ward',
      bedId:            bed.bedId,
      bedNumber:        'G-01',
      assignedDoctorId: doctor.userId,
      status:           AdmissionStatus.DISCHARGED,
      admissionDate:    new Date(),
      dischargeDate:    new Date(),
      progressNotes:    [],
      tenantId:         tenant.tenantId,
    });

    const token = makeToken(doctor.userId, tenant.tenantId, UserRole.DOCTOR);
    const res   = await request(app)
      .post('/api/ipd/admissions/adm-discharged-001/progress-notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Should fail' });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/ipd/admissions/:admissionId/discharge', () => {
  test('sets DISCHARGED status and releases bed', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(tenant.tenantId);
    const ward    = await seedWard(tenant.tenantId);
    const bed     = await seedBed(ward.wardId, tenant.tenantId, true);
    const doctor  = await seedUser(UserRole.DOCTOR, tenant.tenantId);

    await IPDAdmissionModel.create({
      admissionId:      'adm-to-discharge',
      patientId:        patient.patientId,
      wardId:           ward.wardId,
      wardName:         ward.wardName,
      bedId:            bed.bedId,
      bedNumber:        bed.bedNumber,
      assignedDoctorId: doctor.userId,
      status:           AdmissionStatus.ADMITTED,
      admissionDate:    new Date(),
      dischargeDate:    null,
      progressNotes:    [],
      tenantId:         tenant.tenantId,
    });

    const token = makeToken(doctor.userId, tenant.tenantId, UserRole.DOCTOR);
    const res   = await request(app)
      .patch('/api/ipd/admissions/adm-to-discharge/discharge')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(AdmissionStatus.DISCHARGED);
    expect(res.body.data.dischargeDate).not.toBeNull();

    // Bed must be released
    const updatedBed = await BedModel.findOne({ bedId: bed.bedId });
    expect(updatedBed?.isOccupied).toBe(false);
  });

  test('returns 400 when discharging an already-discharged patient', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(UserRole.DOCTOR, tenant.tenantId);

    await IPDAdmissionModel.create({
      admissionId:      'adm-already-dis',
      patientId:        'PAT-INT001',
      wardId:           'ward-int-001',
      wardName:         'General Ward',
      bedId:            'bed-int-001',
      bedNumber:        'G-01',
      assignedDoctorId: doctor.userId,
      status:           AdmissionStatus.DISCHARGED,
      admissionDate:    new Date(),
      dischargeDate:    new Date(),
      progressNotes:    [],
      tenantId:         tenant.tenantId,
    });

    const token = makeToken(doctor.userId, tenant.tenantId, UserRole.DOCTOR);
    const res   = await request(app)
      .patch('/api/ipd/admissions/adm-already-dis/discharge')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/ipd/bed-occupancy', () => {
  test('returns occupancy summary with total === occupied + available per ward', async () => {
    const tenant = await seedTenant();
    const ward   = await seedWard(tenant.tenantId);
    await BedModel.create([
      { bedId: 'b1', wardId: ward.wardId, bedNumber: 'G-01', isOccupied: true,  tenantId: tenant.tenantId },
      { bedId: 'b2', wardId: ward.wardId, bedNumber: 'G-02', isOccupied: false, tenantId: tenant.tenantId },
      { bedId: 'b3', wardId: ward.wardId, bedNumber: 'G-03', isOccupied: false, tenantId: tenant.tenantId },
    ]);

    const token = makeToken('manager-001', tenant.tenantId, UserRole.MANAGER);
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
  test('returns paginated ADMITTED admissions filtered by ward', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(UserRole.DOCTOR, tenant.tenantId);

    await IPDAdmissionModel.create([
      {
        admissionId: 'a1', patientId: 'p1', wardId: 'ward-int-001', wardName: 'General Ward',
        bedId: 'b1', bedNumber: 'G-01', assignedDoctorId: doctor.userId,
        status: AdmissionStatus.ADMITTED, admissionDate: new Date(),
        dischargeDate: null, progressNotes: [], tenantId: tenant.tenantId,
      },
      {
        admissionId: 'a2', patientId: 'p2', wardId: 'ward-int-002', wardName: 'ICU',
        bedId: 'b2', bedNumber: 'I-01', assignedDoctorId: doctor.userId,
        status: AdmissionStatus.ADMITTED, admissionDate: new Date(),
        dischargeDate: null, progressNotes: [], tenantId: tenant.tenantId,
      },
    ]);

    const token = makeToken('nurse-001', tenant.tenantId, UserRole.NURSE);
    const res   = await request(app)
      .get('/api/ipd/admissions?wardId=ward-int-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].wardId).toBe('ward-int-001');
    expect(res.body.data.total).toBe(1);
  });
});
