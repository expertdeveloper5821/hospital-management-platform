/**
 * Integration tests — U3-B: IPD Admission Lifecycle
 *
 * Dependency note: These tests require U3-A (Ward + Bed models) to be merged.
 * Ward and Bed models are imported from their U3-A locations.
 * Run after `feature/u3-bed-registry` is merged into `unit/3-ipd`.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';

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
import { PaymentModel } from '../../../src/modules/payment/payment.model';
import { PaymentMethod, PaymentStatus, PaymentReferenceType } from '../../../src/modules/payment/payment.types';

const JWT_SECRET = process.env['JWT_SECRET']!;

let mongod: MongoMemoryReplSet;

// A single-node replica set (not a plain MongoMemoryServer) — createAdmission
// now uses a session/transaction (see ipd.repository.ts's
// createAdmissionWithBedOccupancy), which MongoDB only supports against a
// replica set or sharded cluster, never a standalone mongod.
beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
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

  test('DB-level race safety: two concurrent creates for the same bed — only one succeeds (201), the other gets 409', async () => {
    const tenant   = await seedTenant();
    const patientA = await seedPatient(toId(tenant));
    const patientB = await PatientModel.create({
      patientId: 'PAT-INT00002', tenantId: toId(tenant), fullName: 'Second Patient',
      dateOfBirth: new Date('1990-01-01'), gender: 'FEMALE', mobileNumber: '9000000002', address: 'Addr',
    });
    const ward   = await seedWard(toId(tenant));
    const bed    = await seedBed(toId(ward), toId(tenant));
    const doctor = await seedUser(UserRole.DOCTOR, toId(tenant));
    const token  = makeToken('recept-001', toId(tenant), UserRole.RECEPTIONIST);

    const makeRequest = (patientId: string) => request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId, wardId: toId(ward), bedId: toId(bed), assignedDoctorIds: [toId(doctor)] });

    // Both requests pass the service's own pre-check (findActiveAdmissionByBed
    // sees the bed as free for either, since neither has committed yet) —
    // the uniq_active_admission_per_bed index is what must break the tie.
    const [resA, resB] = await Promise.all([
      makeRequest(patientA.patientId),
      makeRequest(patientB.patientId),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const admitted = await IPDAdmissionModel.find({ tenantId: toId(tenant), bedId: toId(bed), status: AdmissionStatus.ADMITTED });
    expect(admitted).toHaveLength(1);
  });

  test('DB-level race safety: two concurrent creates for the same patient (different beds) — only one succeeds', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bedA    = await seedBed(toId(ward), toId(tenant));
    const bedB    = await BedModel.create({ wardId: toId(ward), bedNumber: 'G-02', isOccupied: false, tenantId: toId(tenant) });
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));
    const token   = makeToken('recept-001', toId(tenant), UserRole.RECEPTIONIST);

    const makeRequest = (bedId: string) => request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: patient.patientId, wardId: toId(ward), bedId, assignedDoctorIds: [toId(doctor)] });

    const [resA, resB] = await Promise.all([makeRequest(toId(bedA)), makeRequest(toId(bedB))]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const admitted = await IPDAdmissionModel.find({ tenantId: toId(tenant), patientId: patient.patientId, status: AdmissionStatus.ADMITTED });
    expect(admitted).toHaveLength(1);
  });

  test('Idempotency-Key replay: retrying the same create does not create a second admission', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant));
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));
    const token   = makeToken('recept-001', toId(tenant), UserRole.RECEPTIONIST);
    const idempotencyKey = 'temp-client-op-ipd-001';

    const body = { patientId: patient.patientId, wardId: toId(ward), bedId: toId(bed), assignedDoctorIds: [toId(doctor)] };

    const first = await request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    // Replayed, not re-executed — the exact same stored response comes back.
    expect(second.status).toBe(201);
    expect(second.body.data.admissionId).toBe(first.body.data.admissionId);

    const admitted = await IPDAdmissionModel.find({ tenantId: toId(tenant), patientId: patient.patientId });
    expect(admitted).toHaveLength(1);
  });
});

describe('POST /api/ipd/wards', () => {
  test('Idempotency-Key replay: retrying the same offline-queued create does not create a second ward', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(UserRole.HOSPITAL_ADMIN, toId(tenant));
    const token  = jwt.sign(
      { userId: toId(admin), tenantId: toId(tenant), role: UserRole.HOSPITAL_ADMIN, email: 'x@x.com', isFirstLogin: false },
      JWT_SECRET,
    );
    const idempotencyKey = 'temp-client-op-ward-001';
    const body = { name: 'General Ward', floor: '2' };

    const first = await request(app)
      .post('/api/ipd/wards')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/ipd/wards')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    expect(second.status).toBe(201);
    expect(second.body.data.wardId).toBe(first.body.data.wardId);

    const wards = await WardModel.find({ tenantId: toId(tenant), name: 'General Ward' });
    expect(wards).toHaveLength(1);
  });
});

describe('POST /api/ipd/wards/:wardId/beds', () => {
  test('Idempotency-Key replay: retrying the same offline-queued single-bed create does not create a second bed (offline Add Bed support)', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(UserRole.HOSPITAL_ADMIN, toId(tenant));
    const ward   = await seedWard(toId(tenant));
    const token  = jwt.sign(
      { userId: toId(admin), tenantId: toId(tenant), role: UserRole.HOSPITAL_ADMIN, email: 'x@x.com', isFirstLogin: false },
      JWT_SECRET,
    );
    const idempotencyKey = 'temp-client-op-bed-001';
    const body = { bedNumbers: ['101'] };

    const first = await request(app)
      .post(`/api/ipd/wards/${toId(ward)}/beds`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.data).toHaveLength(1);

    const second = await request(app)
      .post(`/api/ipd/wards/${toId(ward)}/beds`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    expect(second.status).toBe(201);
    expect(second.body.data[0].bedId).toBe(first.body.data[0].bedId);

    const beds = await BedModel.find({ tenantId: toId(tenant), wardId: toId(ward), bedNumber: '101' });
    expect(beds).toHaveLength(1);
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
      assignedDoctorIds: [toId(doctor)],
      status:           AdmissionStatus.ADMITTED,
      admissionDate:    new Date(),
      dischargeDate:    null,
      progressNotes:    [],
      tenantId:         toId(tenant),
    });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .patch(`/api/ipd/admissions/${ADM_TO_DISCHARGE_ID}/discharge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dischargeSummaryNotes: 'Recovered well. Review after 7 days.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(AdmissionStatus.DISCHARGED);
    expect(res.body.data.dischargeDate).not.toBeNull();
    expect(res.body.data.dischargeSummaryNotes).toBe('Recovered well. Review after 7 days.');

    // Notes are encrypted at rest
    const raw = await mongoose.connection.collection('ipd_admissions').findOne({ admissionId: ADM_TO_DISCHARGE_ID });
    expect(String(raw?.dischargeSummaryNotes)).toMatch(/^enc:v1:/);

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
      assignedDoctorIds: [toId(doctor)],
      status:           AdmissionStatus.DISCHARGED,
      admissionDate:    new Date(),
      dischargeDate:    new Date(),
      progressNotes:    [],
      tenantId:         toId(tenant),
    });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .patch(`/api/ipd/admissions/${ADM_ALREADY_DIS_ID}/discharge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dischargeSummaryNotes: 'Notes' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when discharge summary notes are missing', async () => {
    const tenant = await seedTenant();
    const token  = makeToken('admin-001', toId(tenant), UserRole.HOSPITAL_ADMIN);
    const res    = await request(app)
      .patch(`/api/ipd/admissions/${ADM_TO_DISCHARGE_ID}/discharge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dischargeSummaryNotes: '   ' });

    expect(res.status).toBe(400);
  });

  test('returns 403 for RECEPTIONIST', async () => {
    const tenant = await seedTenant();
    const token  = makeToken('rec-001', toId(tenant), UserRole.RECEPTIONIST);
    const res    = await request(app)
      .patch(`/api/ipd/admissions/${ADM_TO_DISCHARGE_ID}/discharge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dischargeSummaryNotes: 'Notes' });

    expect(res.status).toBe(403);
  });
});

const ADM_PRESCRIPTION_ID = 'b2000000-0000-0000-0000-000000000003';

describe('PATCH /api/ipd/admissions/:admissionId/prescription', () => {
  async function seedAdmittedAdmission() {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant), true);
    const doctor  = await seedUser(UserRole.DOCTOR, toId(tenant));
    await IPDAdmissionModel.create({
      admissionId:       ADM_PRESCRIPTION_ID,
      patientId:         patient.patientId,
      wardId:            toId(ward),
      wardName:          ward.name,
      bedId:             toId(bed),
      bedNumber:         bed.bedNumber,
      assignedDoctorIds: [toId(doctor)],
      status:            AdmissionStatus.ADMITTED,
      admissionDate:     new Date(),
      dischargeDate:     null,
      progressNotes:     [],
      tenantId:          toId(tenant),
    });
    return { tenant, doctor };
  }

  test('assigned Doctor saves the prescription (encrypted at rest)', async () => {
    const { tenant, doctor } = await seedAdmittedAdmission();
    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .patch(`/api/ipd/admissions/${ADM_PRESCRIPTION_ID}/prescription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ prescription: 'Inj. Ceftriaxone 1g IV BD x 5 days' });

    expect(res.status).toBe(200);
    expect(res.body.data.prescription).toBe('Inj. Ceftriaxone 1g IV BD x 5 days');
    const raw = await mongoose.connection.collection('ipd_admissions').findOne({ admissionId: ADM_PRESCRIPTION_ID });
    expect(String(raw?.prescription)).toMatch(/^enc:v1:/);
  });

  test('returns 403 for a Doctor not assigned to the admission', async () => {
    const { tenant } = await seedAdmittedAdmission();
    const token = makeToken('unassigned-doctor-001', toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .patch(`/api/ipd/admissions/${ADM_PRESCRIPTION_ID}/prescription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ prescription: 'x' });

    expect(res.status).toBe(403);
  });

  test('returns 403 for ADMIN', async () => {
    const { tenant } = await seedAdmittedAdmission();
    const token = makeToken('admin-001', toId(tenant), UserRole.ADMIN);
    const res   = await request(app)
      .patch(`/api/ipd/admissions/${ADM_PRESCRIPTION_ID}/prescription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ prescription: 'x' });

    expect(res.status).toBe(403);
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

describe('GET /api/ipd/admissions — pagination', () => {
  // Every admission shares one admissionDate so page boundaries depend on the
  // sort's _id tiebreaker — without it, rows could repeat or vanish across pages.
  const SAME_DATE = new Date('2026-01-01T00:00:00.000Z');

  // One active admission per patient (uniq_active_admission_per_patient), so
  // each ADMITTED row gets its own patient: 15 named "Ravi …", 10 "Sita …".
  const patientIdOf = (i: number) => `PAT-PG-${String(i).padStart(2, '0')}`;

  async function seedAdmissions(tenantId: string) {
    await PatientModel.create(Array.from({ length: 25 }, (_, i) => ({
      patientId: patientIdOf(i), tenantId,
      fullName:  i < 15 ? `Ravi Kumar ${i}` : `Sita Devi ${i}`,
      dateOfBirth: new Date('1985-01-01'), gender: 'MALE',
      mobileNumber: `90000001${String(i).padStart(2, '0')}`, address: 'A',
    })));
    const rows = Array.from({ length: 25 }, (_, i) => ({
      admissionId: `adm-pg-${String(i).padStart(2, '0')}`,
      patientId:   patientIdOf(i),
      wardId: 'ward-pg', wardName: 'General', bedId: `bed-${i}`, bedNumber: `G-${i}`,
      status: AdmissionStatus.ADMITTED, admissionDate: SAME_DATE,
      dischargeDate: null, progressNotes: [], tenantId,
    }));
    // Plus 3 discharged admissions that must never appear under status=ADMITTED.
    const discharged = Array.from({ length: 3 }, (_, i) => ({
      admissionId: `adm-pg-dis-${i}`, patientId: patientIdOf(i),
      wardId: 'ward-pg', wardName: 'General', bedId: `bed-d${i}`, bedNumber: `D-${i}`,
      status: AdmissionStatus.DISCHARGED, admissionDate: SAME_DATE,
      dischargeDate: SAME_DATE, progressNotes: [], tenantId,
    }));
    await IPDAdmissionModel.create([...rows, ...discharged]);
  }

  async function getPage(token: string, qs: string) {
    return request(app).get(`/api/ipd/admissions?${qs}`).set('Authorization', `Bearer ${token}`);
  }

  test('walks every page with accurate totals and no duplicate/missing rows', async () => {
    const tenant = await seedTenant();
    await seedAdmissions(toId(tenant));
    const token = makeToken('admin-001', toId(tenant), UserRole.HOSPITAL_ADMIN);

    const seen: string[] = [];
    const sizes: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await getPage(token, `page=${page}&limit=10`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ total: 25, page, limit: 10, totalPages: 3 });
      sizes.push(res.body.data.data.length);
      seen.push(...res.body.data.data.map((a: { admissionId: string }) => a.admissionId));
    }

    expect(sizes).toEqual([10, 10, 5]);
    expect(new Set(seen).size).toBe(25);
    expect(seen.every((id) => !id.startsWith('adm-pg-dis-'))).toBe(true);
  });

  test('a page past the end returns no rows but keeps the real total', async () => {
    const tenant = await seedTenant();
    await seedAdmissions(toId(tenant));
    const token = makeToken('admin-001', toId(tenant), UserRole.HOSPITAL_ADMIN);

    const res = await getPage(token, 'page=4&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
    expect(res.body.data).toMatchObject({ total: 25, totalPages: 3 });
  });

  test('search and status filters are applied before paginating', async () => {
    const tenant = await seedTenant();
    await seedAdmissions(toId(tenant));
    const token = makeToken('admin-001', toId(tenant), UserRole.HOSPITAL_ADMIN);

    const search = await getPage(token, 'search=ravi&page=2&limit=10');
    expect(search.body.data).toMatchObject({ total: 15, page: 2, totalPages: 2 });
    expect(search.body.data.data).toHaveLength(5);
    expect(search.body.data.data.every((a: { fullName: string }) => a.fullName.startsWith('Ravi'))).toBe(true);

    const discharged = await getPage(token, 'status=DISCHARGED&page=1&limit=10');
    expect(discharged.body.data).toMatchObject({ total: 3, totalPages: 1 });
    expect(discharged.body.data.data).toHaveLength(3);
  });

  test('rejects an out-of-range page or limit with 400', async () => {
    const tenant = await seedTenant();
    const token  = makeToken('admin-001', toId(tenant), UserRole.HOSPITAL_ADMIN);

    expect((await getPage(token, 'page=0')).status).toBe(400);
    expect((await getPage(token, 'limit=101')).status).toBe(400);
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
      // Unique per admission (not a fixed 'bed-1') — this test's own history
      // test seeds two ADMITTED admissions in the same tenant, which would
      // otherwise collide with the uniq_active_admission_per_bed index.
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

  test('200 — active IPD list strictly filters by assignedDoctorIds; patient linked only via OPD is not listed', async () => {
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
    });
    // Admission itself has no assignedDoctorIds — the doctor is only linked via OPD.
    await seedAdmission({ admissionId: ADM_ID, patientId: 'PAT-LIST-OPD', assignedDoctorIds: [], tenantId: toId(tenant) });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data.map((a: { admissionId: string }) => a.admissionId)).not.toContain(ADM_ID);
  });

  test('200 — previous doctor transferred away from active admission does not see patient in active list', async () => {
    const tenant      = await seedTenant();
    const doctor      = await seedUser(UserRole.DOCTOR, toId(tenant));
    const otherDoctor = await UserModel.create({
      name: 'New Doctor', tenantId: toId(tenant), email: 'new-doctor-transfer@inttest.com',
      passwordHash: '$2a$12$hashedpwd', role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
    });
    const ADM_ID = 'e1000000-0000-0000-0000-000000000099';

    // Patient originally had OPD with doctor, but IPD admission is assigned to otherDoctor
    await OPDVisitModel.create({
      visitId:        'OPD-TRANSFER01',
      tenantId:       toId(tenant),
      patientId:      'PAT-TRANSFER',
      doctorIds:      [toId(doctor)],
      departmentId:   null,
      visitDate:      new Date(),
      queueNumber:    1,
      status:         'COMPLETED',
    });
    await seedAdmission({ admissionId: ADM_ID, patientId: 'PAT-TRANSFER', assignedDoctorIds: [toId(otherDoctor)], tenantId: toId(tenant) });

    const token = makeToken(toId(doctor), toId(tenant), UserRole.DOCTOR);
    const res   = await request(app)
      .get('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data.map((a: { admissionId: string }) => a.admissionId)).not.toContain(ADM_ID);
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

// ─── Receptionist IPD edit scope, delete + payment cancellation, per-admission vitals ──

const ADM_RC_ID    = 'b3000000-0000-0000-0000-000000000001';
const ADM_RC_OLD   = 'b3000000-0000-0000-0000-000000000002';
const ADM_RC_OTHER = 'b3000000-0000-0000-0000-000000000003';

const RC_VITALS = {
  weight: 70, height: 170, bloodPressure: '120/80', sugar: 95, bodyTemperature: 98.6,
  spo2: 98, pulse: 72, respiratoryRate: null, headCircumference: null,
};
const EMPTY_VITALS = {
  weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null, spo2: null, pulse: null,
  respiratoryRate: null, headCircumference: null,
};

async function seedOtherTenant() {
  return TenantModel.create({
    name:       'Other Hospital',
    status:     TenantStatus.ACTIVE,
    adminEmail: 'admin@other-inttest.com',
    onboardingDocuments: {
      registrationCertificate: 's3-key-3',
      gstNumber:               'GST456',
      panCard:                 's3-key-4',
      addressLine:             '1 Other Street',
      city:                    'Pune',
      state:                   'Maharashtra',
      pincode:                 '411001',
    },
    branding: { displayName: 'Other Hospital', primaryColor: '#000', logoUrl: null },
  });
}

async function seedSecondPatient(tenantId: string, patientId = 'PAT-INT00002') {
  return PatientModel.create({
    patientId,
    tenantId,
    fullName:     'Second Patient',
    dateOfBirth:  new Date('1990-01-01'),
    gender:       'FEMALE',
    mobileNumber: '9000000002',
    address:      'Second Address, City',
  });
}

async function seedAdmission(tenantId: string, overrides: Partial<{
  admissionId: string; patientId: string; wardId: string; bedId: string; status: AdmissionStatus;
  vitals: typeof RC_VITALS;
}> = {}) {
  const status = overrides.status ?? AdmissionStatus.ADMITTED;
  return IPDAdmissionModel.create({
    admissionId:       overrides.admissionId ?? ADM_RC_ID,
    patientId:         overrides.patientId   ?? 'PAT-INT00001',
    wardId:            overrides.wardId      ?? 'ward-placeholder',
    wardName:          'General Ward',
    bedId:             overrides.bedId       ?? 'bed-placeholder',
    bedNumber:         'G-01',
    assignedDoctorIds: [],
    status,
    admissionDate:     new Date(),
    dischargeDate:     status === AdmissionStatus.DISCHARGED ? new Date() : null,
    progressNotes:     [],
    ...(overrides.vitals ? { vitals: overrides.vitals } : {}),
    tenantId,
  });
}

async function seedIpdPayment(
  tenantId:      string,
  paymentId:     string,
  admissionId:   string,
  referenceType: string = PaymentReferenceType.IPD_ADMISSION,
) {
  return PaymentModel.create({
    paymentId,
    tenantId,
    patientId:     'PAT-INT00001',
    amount:        5000,
    paymentMethod: PaymentMethod.CASH,
    description:   'IPD Admission',
    status:        PaymentStatus.COMPLETED,
    referenceType,
    referenceId:   admissionId,
    createdBy:     'rc-001',
  });
}

describe('PATCH /api/ipd/admissions/:admissionId — Receptionist edit scope', () => {
  test('200 — Receptionist can record vitals', async () => {
    const tenant = await seedTenant();
    await seedAdmission(toId(tenant));
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ vitals: RC_VITALS });

    expect(res.status).toBe(200);
    expect(res.body.data.vitals).toEqual(RC_VITALS);
  });

  test('200 — Receptionist can correct the patient of an admission', async () => {
    const tenant = await seedTenant();
    await seedPatient(toId(tenant));
    await seedSecondPatient(toId(tenant));
    await seedAdmission(toId(tenant));
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'PAT-INT00002' });

    expect(res.status).toBe(200);
    expect(res.body.data.patientId).toBe('PAT-INT00002');
    expect(res.body.data.fullName).toBe('Second Patient');
  });

  test('200 — Receptionist keeps doctor/ward/bed edit access, alongside patient + vitals in the same save', async () => {
    const tenant = await seedTenant();
    await seedPatient(toId(tenant));
    await seedSecondPatient(toId(tenant));
    const doctor = await seedUser(UserRole.DOCTOR, toId(tenant));
    const ward   = await seedWard(toId(tenant));
    const oldBed = await seedBed(toId(ward), toId(tenant), true);
    const newBed = await BedModel.create({ wardId: toId(ward), bedNumber: 'G-02', isOccupied: false, tenantId: toId(tenant) });
    await BedModel.updateOne({ _id: oldBed._id }, { currentAdmissionId: ADM_RC_ID });
    await seedAdmission(toId(tenant), { wardId: toId(ward), bedId: toId(oldBed) });
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        assignedDoctorIds: [toId(doctor)],
        wardId:            toId(ward),
        bedId:             toId(newBed),
        patientId:         'PAT-INT00002',
        vitals:            { weight: 70 },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedDoctorIds).toEqual([toId(doctor)]);
    expect(res.body.data.bedId).toBe(toId(newBed));
    expect(res.body.data.patientId).toBe('PAT-INT00002');
    expect(res.body.data.vitals.weight).toBe(70);
    expect((await BedModel.findById(oldBed._id))?.isOccupied).toBe(false);
    expect((await BedModel.findById(newBed._id))?.isOccupied).toBe(true);
  });

  test.each([UserRole.DOCTOR, UserRole.NURSE, UserRole.HOSPITAL_ADMIN, UserRole.ADMIN])(
    '403 — %s cannot change the patient of an admission',
    async (role) => {
      const tenant = await seedTenant();
      await seedSecondPatient(toId(tenant));
      await seedAdmission(toId(tenant));
      const token = makeToken('user-001', toId(tenant), role);

      const res = await request(app)
        .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ patientId: 'PAT-INT00002' });

      expect(res.status).toBe(403);
      expect((await IPDAdmissionModel.findOne({ admissionId: ADM_RC_ID }))?.patientId).toBe('PAT-INT00001');
    },
  );

  test('403 — Admin still cannot update vitals (unchanged)', async () => {
    const tenant = await seedTenant();
    await seedAdmission(toId(tenant));
    const token = makeToken('admin-001', toId(tenant), UserRole.ADMIN);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ vitals: { weight: 70 } });

    expect(res.status).toBe(403);
  });

  test('404 — patient correction to a patient that only exists in another tenant', async () => {
    const tenant = await seedTenant();
    const other  = await seedOtherTenant();
    await seedSecondPatient(toId(other));
    await seedAdmission(toId(tenant));
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'PAT-INT00002' });

    expect(res.status).toBe(404);
    expect((await IPDAdmissionModel.findOne({ admissionId: ADM_RC_ID }))?.patientId).toBe('PAT-INT00001');
  });

  test('409 — patient correction to a patient who is already admitted', async () => {
    const tenant = await seedTenant();
    await seedSecondPatient(toId(tenant));
    await seedAdmission(toId(tenant));
    await seedAdmission(toId(tenant), { admissionId: ADM_RC_OTHER, patientId: 'PAT-INT00002', bedId: 'bed-2' });
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: 'PAT-INT00002' });

    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/ipd/admissions/:admissionId', () => {
  test('200 — Receptionist deletes an ADMITTED admission, releases its bed and cancels only its payments', async () => {
    const tenant = await seedTenant();
    const ward   = await seedWard(toId(tenant));
    const bed    = await seedBed(toId(ward), toId(tenant), true);
    await BedModel.updateOne({ _id: bed._id }, { currentAdmissionId: ADM_RC_ID });
    await seedAdmission(toId(tenant), { wardId: toId(ward), bedId: toId(bed) });
    await seedIpdPayment(toId(tenant), 'PAY-IPD-1', ADM_RC_ID);
    await seedIpdPayment(toId(tenant), 'PAY-IPD-2', ADM_RC_OTHER);                              // other admission
    await seedIpdPayment(toId(tenant), 'PAY-OPD-1', ADM_RC_ID, PaymentReferenceType.OPD_VISIT); // other reference type
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .delete(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(await IPDAdmissionModel.findOne({ admissionId: ADM_RC_ID })).toBeNull();
    const releasedBed = await BedModel.findById(bed._id);
    expect(releasedBed?.isOccupied).toBe(false);
    expect(releasedBed?.currentAdmissionId ?? null).toBeNull();
    expect((await PaymentModel.findOne({ paymentId: 'PAY-IPD-1' }))?.status).toBe(PaymentStatus.CANCELLED);
    expect((await PaymentModel.findOne({ paymentId: 'PAY-IPD-2' }))?.status).toBe(PaymentStatus.COMPLETED);
    expect((await PaymentModel.findOne({ paymentId: 'PAY-OPD-1' }))?.status).toBe(PaymentStatus.COMPLETED);
  });

  test('409 — a DISCHARGED admission cannot be deleted and its payment is untouched', async () => {
    const tenant = await seedTenant();
    await seedAdmission(toId(tenant), { status: AdmissionStatus.DISCHARGED });
    await seedIpdPayment(toId(tenant), 'PAY-IPD-DIS', ADM_RC_ID);
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .delete(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(await IPDAdmissionModel.findOne({ admissionId: ADM_RC_ID })).not.toBeNull();
    expect((await PaymentModel.findOne({ paymentId: 'PAY-IPD-DIS' }))?.status).toBe(PaymentStatus.COMPLETED);
  });

  test.each([UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER])(
    '403 — %s cannot delete an admission',
    async (role) => {
      const tenant = await seedTenant();
      await seedAdmission(toId(tenant));
      const token = makeToken('user-001', toId(tenant), role);

      const res = await request(app)
        .delete(`/api/ipd/admissions/${ADM_RC_ID}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(await IPDAdmissionModel.findOne({ admissionId: ADM_RC_ID })).not.toBeNull();
    },
  );

  test("404 — a Receptionist cannot delete another tenant's admission (tenant isolation)", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedOtherTenant();
    await seedAdmission(toId(tenantA));
    await seedIpdPayment(toId(tenantA), 'PAY-IPD-A', ADM_RC_ID);
    const token = makeToken('rc-b', toId(tenantB), UserRole.RECEPTIONIST);

    const res = await request(app)
      .delete(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(await IPDAdmissionModel.findOne({ admissionId: ADM_RC_ID })).not.toBeNull();
    expect((await PaymentModel.findOne({ paymentId: 'PAY-IPD-A' }))?.status).toBe(PaymentStatus.COMPLETED);
  });

  test('400 — invalid admission ID format', async () => {
    const tenant = await seedTenant();
    const token  = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .delete('/api/ipd/admissions/not-a-uuid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

describe('IPD vitals are per admission', () => {
  test('allows a newborn weight below 0.5 kg when the age is recorded in days', async () => {
    const tenant = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    await PatientModel.updateOne(
      { tenantId: toId(tenant), patientId: patient.patientId },
      { $set: { age: 1, ageUnit: 'DAYS' } },
    );
    await seedAdmission(toId(tenant));
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ vitals: { weight: 0.2 } });

    expect(res.status).toBe(200);
    expect(res.body.data.vitals.weight).toBe(0.2);
  });

  test('a new admission starts with empty vitals even when an earlier admission recorded them', async () => {
    const tenant  = await seedTenant();
    const patient = await seedPatient(toId(tenant));
    const ward    = await seedWard(toId(tenant));
    const bed     = await seedBed(toId(ward), toId(tenant));
    await seedAdmission(toId(tenant), { admissionId: ADM_RC_OLD, status: AdmissionStatus.DISCHARGED, vitals: RC_VITALS });
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/ipd/admissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId: patient.patientId, wardId: toId(ward), bedId: toId(bed) });

    expect(res.status).toBe(201);
    expect(res.body.data.vitals).toEqual(EMPTY_VITALS);
  });

  test("updating the current admission's vitals never changes a discharged admission or an OPD visit of the same patient", async () => {
    const tenant = await seedTenant();
    await seedPatient(toId(tenant));
    await seedAdmission(toId(tenant), { admissionId: ADM_RC_OLD, status: AdmissionStatus.DISCHARGED, vitals: RC_VITALS });
    await seedAdmission(toId(tenant));
    await OPDVisitModel.create({
      visitId: 'OPD-IPDVIT01', tenantId: toId(tenant), patientId: 'PAT-INT00001', doctorIds: [],
      visitDate: new Date(), queueNumber: 1, status: 'COMPLETED', vitals: RC_VITALS,
    });
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ vitals: { weight: 82 } });

    expect(res.status).toBe(200);
    expect(res.body.data.vitals).toEqual({ ...EMPTY_VITALS, weight: 82 });
    const old = await IPDAdmissionModel.findOne({ admissionId: ADM_RC_OLD });
    expect(old?.vitals?.weight).toBe(RC_VITALS.weight);
    const visit = await OPDVisitModel.findOne({ visitId: 'OPD-IPDVIT01' });
    expect(visit?.vitals?.weight).toBe(RC_VITALS.weight);
  });

  test("400 — a discharged admission's vitals cannot be edited", async () => {
    const tenant = await seedTenant();
    await seedAdmission(toId(tenant), { status: AdmissionStatus.DISCHARGED, vitals: RC_VITALS });
    const token = makeToken('rc-001', toId(tenant), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch(`/api/ipd/admissions/${ADM_RC_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ vitals: { weight: 82 } });

    expect(res.status).toBe(400);
    expect((await IPDAdmissionModel.findOne({ admissionId: ADM_RC_ID }))?.vitals?.weight).toBe(RC_VITALS.weight);
  });
});

describe('GET /api/ipd/wards — pagination', () => {
  async function seedWards(tenantId: string, count: number) {
    await WardModel.insertMany(
      Array.from({ length: count }, (_, i) => ({
        tenantId,
        name:  `Ward ${String(i + 1).padStart(2, '0')}`,
        floor: i % 2 === 0 ? 'Ground' : 'First',
      })),
    );
  }

  test('without page/limit keeps the legacy bare-array response (all wards)', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(UserRole.HOSPITAL_ADMIN, toId(tenant));
    await seedWards(toId(tenant), 25);

    const res = await request(app)
      .get('/api/ipd/wards')
      .set('Authorization', `Bearer ${makeToken(toId(admin), toId(tenant), UserRole.HOSPITAL_ADMIN)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(25);
  });

  test('pages through every ward exactly once with accurate totals', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(UserRole.HOSPITAL_ADMIN, toId(tenant));
    await seedWards(toId(tenant), 25);
    const token = makeToken(toId(admin), toId(tenant), UserRole.HOSPITAL_ADMIN);

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await request(app)
        .get(`/api/ipd/wards?page=${page}&limit=10`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ total: 25, page, limit: 10, totalPages: 3 });
      expect(res.body.data.data).toHaveLength(page === 3 ? 5 : 10);
      seen.push(...res.body.data.data.map((w: { wardId: string }) => w.wardId));
    }
    expect(new Set(seen).size).toBe(25);

    const first = await request(app)
      .get('/api/ipd/wards?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);
    expect(first.body.data.data[0].name).toBe('Ward 01');
  });

  test('a page past the end returns an empty page with the real total', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(UserRole.HOSPITAL_ADMIN, toId(tenant));
    await seedWards(toId(tenant), 3);

    const res = await request(app)
      .get('/api/ipd/wards?page=5&limit=10')
      .set('Authorization', `Bearer ${makeToken(toId(admin), toId(tenant), UserRole.HOSPITAL_ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ data: [], total: 3, page: 5, totalPages: 1 });
  });

  test('search matches name or floor case-insensitively, treats regex characters literally, and counts only matches', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(UserRole.HOSPITAL_ADMIN, toId(tenant));
    await seedWards(toId(tenant), 5); // floors: Ground, First, Ground, First, Ground
    const token = makeToken(toId(admin), toId(tenant), UserRole.HOSPITAL_ADMIN);

    const byName = await request(app)
      .get('/api/ipd/wards?page=1&limit=10&search=ward 0')
      .set('Authorization', `Bearer ${token}`);
    expect(byName.body.data.total).toBe(5);

    const byFloor = await request(app)
      .get('/api/ipd/wards?page=1&limit=10&search=gROUND')
      .set('Authorization', `Bearer ${token}`);
    expect(byFloor.body.data.total).toBe(3);
    expect(byFloor.body.data.data).toHaveLength(3);

    const regex = await request(app)
      .get(`/api/ipd/wards?page=1&limit=10&search=${encodeURIComponent('.*')}`)
      .set('Authorization', `Bearer ${token}`);
    expect(regex.body.data).toMatchObject({ data: [], total: 0, totalPages: 0 });

    const blank = await request(app)
      .get('/api/ipd/wards?page=1&limit=10&search=%20%20')
      .set('Authorization', `Bearer ${token}`);
    expect(blank.body.data.total).toBe(5);
  });

  test('is tenant-scoped', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(UserRole.HOSPITAL_ADMIN, toId(tenant));
    await seedWards(toId(tenant), 2);
    await seedWards(new mongoose.Types.ObjectId().toString(), 4);

    const res = await request(app)
      .get('/api/ipd/wards?page=1&limit=10')
      .set('Authorization', `Bearer ${makeToken(toId(admin), toId(tenant), UserRole.HOSPITAL_ADMIN)}`);

    expect(res.body.data.total).toBe(2);
  });

  test('rejects an invalid page or limit with 400', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(UserRole.HOSPITAL_ADMIN, toId(tenant));
    const token  = makeToken(toId(admin), toId(tenant), UserRole.HOSPITAL_ADMIN);

    for (const qs of ['page=0', 'limit=0', 'limit=101', 'page=abc']) {
      const res = await request(app).get(`/api/ipd/wards?${qs}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    }
  });
});
