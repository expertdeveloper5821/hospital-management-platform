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
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn().mockResolvedValue('mocked-s3-key'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.test/presigned-report.pdf'),
  },
}));

import app                   from '../../../src/app';
import { TenantModel }       from '../../../src/modules/tenant/tenant.model';
import { UserModel }         from '../../../src/modules/auth/auth.model';
import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
import { WardModel }         from '../../../src/modules/ipd/ward.model';
import { BedModel }          from '../../../src/modules/ipd/bed.model';
import { PatientModel }      from '../../../src/modules/patient/patient.model';
import { OPDVisitModel }     from '../../../src/modules/opd/opd.model';
import { DepartmentModel }   from '../../../src/modules/department/department.model';
import { PaymentModel }      from '../../../src/modules/payment/payment.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { AdmissionStatus }   from '../../../src/modules/ipd/ipd.types';

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
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

function toId(doc: mongoose.Document): string {
  return (doc._id as mongoose.Types.ObjectId).toString();
}

function makeToken(userId: string, tenantId: string, role: UserRole) {
  return jwt.sign({ userId, tenantId, role, email: `${role}@test.com`, isFirstLogin: false }, JWT_SECRET, { expiresIn: '1h' });
}

async function seedTenant() {
  return TenantModel.create({
    name: 'Discharge Test Hospital',
    status: TenantStatus.ACTIVE,
    adminEmail: 'admin@dischargetest.com',
    onboardingDocuments: {
      registrationCertificate: 's3-key-1', gstNumber: 'GST123', panCard: 's3-key-2',
      addressLine: '789 IPD Avenue', city: 'Mumbai', state: 'Maharashtra', pincode: '400001',
    },
    branding: { displayName: 'Discharge Test Hospital', primaryColor: '#1A73E8', logoUrl: null },
  });
}

async function seedUser(role: UserRole, tenantId: string) {
  return UserModel.create({
    name: `Test ${role}`, tenantId, email: `${role.toLowerCase()}@dischargetest.com`,
    passwordHash: '$2a$12$hashedpwd', role, isActive: true, isFirstLogin: false,
  });
}

async function seedPatient(tenantId: string) {
  return PatientModel.create({
    patientId: 'PAT-DIS00001', tenantId, fullName: 'Discharge Patient',
    dateOfBirth: new Date('1985-01-01'), gender: 'MALE', mobileNumber: '9000000001', address: 'Test Address, City',
  });
}

async function seedDischargedAdmission(tenantId: string, patientId: string, doctorId: string) {
  const ward = await WardModel.create({ name: 'General Ward', tenantId });
  const bed  = await BedModel.create({ wardId: toId(ward), bedNumber: 'G-01', isOccupied: false, tenantId });
  return IPDAdmissionModel.create({
    admissionId: '11111111-1111-4111-8111-111111111111',
    patientId, tenantId,
    wardId: toId(ward), bedId: toId(bed), bedNumber: 'G-01', wardName: 'General Ward',
    assignedDoctorIds: [doctorId],
    departmentId: null,
    status: AdmissionStatus.DISCHARGED,
    admissionDate: new Date('2026-01-06T08:00:00.000Z'),
    dischargeDate: new Date('2026-01-10T14:30:00.000Z'),
    progressNotes: [
      { noteId: 'n1', doctorId, note: '<p>Patient <strong>stable</strong> overnight.</p>', timestamp: new Date('2026-01-07T09:00:00.000Z') },
    ],
  });
}

describe('GET /api/ipd/admissions/:admissionId/discharge-summary', () => {
  test('200 — returns a PDF for a discharged admission (Hospital Admin)', async () => {
    const tenant  = await seedTenant();
    const tid     = toId(tenant);
    const patient = await seedPatient(tid);
    const doctor  = await seedUser(UserRole.DOCTOR, tid);
    await seedDischargedAdmission(tid, patient.patientId, toId(doctor));
    const token = makeToken('admin-user', tid, UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('discharge-summary-11111111-1111-4111-8111-111111111111.pdf');
    expect(res.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('200 — includes OPD visits, lab requests, and payments when present', async () => {
    const tenant  = await seedTenant();
    const tid     = toId(tenant);
    const patient = await seedPatient(tid);
    const doctor  = await seedUser(UserRole.DOCTOR, tid);
    const dept    = await DepartmentModel.create({ departmentId: 'dept-cardio', tenantId: tid, name: 'Cardiology' });

    await OPDVisitModel.create({
      visitId: 'OPD-DIS0001', tenantId: tid, patientId: patient.patientId,
      doctorIds: [toId(doctor)], departmentId: dept.departmentId,
      visitDate: new Date('2026-01-05T09:00:00.000Z'), queueNumber: 1, status: 'COMPLETED',
      diagnosis: 'Hypertension', prescription: 'Amlodipine', notes: '<p>Routine visit</p>',
    });
    await PaymentModel.create({
      paymentId: 'pay-001', tenantId: tid, patientId: patient.patientId, fullName: patient.fullName,
      amount: 500, paymentMethod: 'CASH', description: 'OPD Consultation', status: 'COMPLETED', createdBy: 'u',
    });
    await seedDischargedAdmission(tid, patient.patientId, toId(doctor));
    const token = makeToken('admin-user', tid, UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('409 — admission is still ADMITTED (discharge summary not yet available)', async () => {
    const tenant  = await seedTenant();
    const tid     = toId(tenant);
    const patient = await seedPatient(tid);
    const doctor  = await seedUser(UserRole.DOCTOR, tid);
    const ward    = await WardModel.create({ name: 'General Ward', tenantId: tid });
    const bed     = await BedModel.create({ wardId: toId(ward), bedNumber: 'G-01', isOccupied: true, tenantId: tid });
    await IPDAdmissionModel.create({
      admissionId: '22222222-2222-4222-8222-222222222222', patientId: patient.patientId, tenantId: tid,
      wardId: toId(ward), bedId: toId(bed), bedNumber: 'G-01', wardName: 'General Ward',
      assignedDoctorIds: [toId(doctor)], status: AdmissionStatus.ADMITTED,
      admissionDate: new Date(), dischargeDate: null, progressNotes: [],
    });
    const token = makeToken('admin-user', tid, UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get('/api/ipd/admissions/22222222-2222-4222-8222-222222222222/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
  });

  test('404 — unknown admissionId', async () => {
    const tenant = await seedTenant();
    const token = makeToken('admin-user', toId(tenant), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get('/api/ipd/admissions/00000000-0000-0000-0000-000000000000/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('400 — malformed admissionId (not a UUID)', async () => {
    const tenant = await seedTenant();
    const token = makeToken('admin-user', toId(tenant), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get('/api/ipd/admissions/not-a-uuid/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  test('404 — tenant isolation: another tenant cannot fetch this admission\'s discharge summary', async () => {
    const tenantA  = await seedTenant();
    const patientA = await seedPatient(toId(tenantA));
    const doctorA  = await seedUser(UserRole.DOCTOR, toId(tenantA));
    await seedDischargedAdmission(toId(tenantA), patientA.patientId, toId(doctorA));

    const tenantB = await TenantModel.create({
      name: 'Other Hospital', status: TenantStatus.ACTIVE, adminEmail: 'admin@other.com',
      onboardingDocuments: { registrationCertificate: 'c', gstNumber: 'g', panCard: 'p', addressLine: 'a', city: 'c', state: 's', pincode: '1' },
      branding: { displayName: 'Other Hospital', primaryColor: '#000', logoUrl: null },
    });
    const tokenB = makeToken('other-admin', toId(tenantB), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  test('403 — a role outside ADMISSION_READERS cannot access it (e.g. PATHOLOGIST)', async () => {
    const tenant  = await seedTenant();
    const tid     = toId(tenant);
    const patient = await seedPatient(tid);
    const doctor  = await seedUser(UserRole.DOCTOR, tid);
    await seedDischargedAdmission(tid, patient.patientId, toId(doctor));
    const token = makeToken('patho-user', tid, UserRole.PATHOLOGIST);

    const res = await request(app)
      .get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('200 — Manager and Receptionist (unscoped ADMISSION_READERS) can access it', async () => {
    const tenant  = await seedTenant();
    const tid     = toId(tenant);
    const patient = await seedPatient(tid);
    const doctor  = await seedUser(UserRole.DOCTOR, tid);
    await seedDischargedAdmission(tid, patient.patientId, toId(doctor));

    for (const role of [UserRole.MANAGER, UserRole.RECEPTIONIST]) {
      const token = makeToken('u-' + role, tid, role);
      const res = await request(app)
        .get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    }
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary');
    expect(res.status).toBe(401);
  });

  // ─── Assignment-scoped authorization (same as GET /admissions/:admissionId) ──
  test('200 — a doctor assigned to the admission can download the discharge summary', async () => {
    const tenant  = await seedTenant();
    const tid     = toId(tenant);
    const patient = await seedPatient(tid);
    const doctor  = await seedUser(UserRole.DOCTOR, tid);
    await seedDischargedAdmission(tid, patient.patientId, toId(doctor));

    const token = makeToken(toId(doctor), tid, UserRole.DOCTOR);
    const res = await request(app)
      .get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('404 — a doctor not assigned to the admission (nor its OPD/IPD history) is rejected', async () => {
    const tenant       = await seedTenant();
    const tid          = toId(tenant);
    const patient      = await seedPatient(tid);
    const doctor       = await seedUser(UserRole.DOCTOR, tid);
    const otherDoctor  = await UserModel.create({
      name: 'Other Doctor', tenantId: tid, email: 'other-doctor@dischargetest.com',
      passwordHash: '$2a$12$hashedpwd', role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
    });
    await seedDischargedAdmission(tid, patient.patientId, toId(doctor));

    const token = makeToken(toId(otherDoctor), tid, UserRole.DOCTOR);
    const res = await request(app)
      .get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('200 — a nurse assigned to the admission\'s ward can download the discharge summary', async () => {
    const tenant  = await seedTenant();
    const tid     = toId(tenant);
    const patient = await seedPatient(tid);
    const doctor  = await seedUser(UserRole.DOCTOR, tid);
    const nurse   = await seedUser(UserRole.NURSE, tid);

    const ward = await WardModel.create({ name: 'General Ward', tenantId: tid, assignedNurseIds: [toId(nurse)] });
    const bed  = await BedModel.create({ wardId: toId(ward), bedNumber: 'G-01', isOccupied: false, tenantId: tid });
    await IPDAdmissionModel.create({
      admissionId: '11111111-1111-4111-8111-111111111111',
      patientId: patient.patientId, tenantId: tid,
      wardId: toId(ward), bedId: toId(bed), bedNumber: 'G-01', wardName: 'General Ward',
      assignedDoctorIds: [toId(doctor)], departmentId: null,
      status: AdmissionStatus.DISCHARGED,
      admissionDate: new Date('2026-01-06T08:00:00.000Z'),
      dischargeDate: new Date('2026-01-10T14:30:00.000Z'),
      progressNotes: [],
    });

    const token = makeToken(toId(nurse), tid, UserRole.NURSE);
    const res = await request(app)
      .get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('404 — a nurse outside the admission\'s ward is rejected', async () => {
    const tenant  = await seedTenant();
    const tid     = toId(tenant);
    const patient = await seedPatient(tid);
    const doctor  = await seedUser(UserRole.DOCTOR, tid);
    const nurse   = await seedUser(UserRole.NURSE, tid);

    const otherWard = await WardModel.create({ name: 'Other Ward', tenantId: tid, assignedNurseIds: [toId(nurse)] });
    await seedDischargedAdmission(tid, patient.patientId, toId(doctor)); // admission is in 'General Ward', not otherWard
    void otherWard;

    const token = makeToken(toId(nurse), tid, UserRole.NURSE);
    const res = await request(app)
      .get('/api/ipd/admissions/11111111-1111-4111-8111-111111111111/discharge-summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
