import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose              from 'mongoose';
import request               from 'supertest';
import jwt                   from 'jsonwebtoken';
import bcrypt                from 'bcryptjs';

jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: {
    sendInviteEmail:        jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail:       jest.fn().mockResolvedValue(undefined),
    sendAccountLockEmail:   jest.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendTemplatedEmail:     jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn().mockResolvedValue('https://s3.test/file'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.test/presigned'),
  },
}));
jest.mock('../../../src/shared/services/pdf.service', () => ({
  pdfService: {
    generateMedicalCard: jest.fn().mockReturnValue(Buffer.from('PDF-STUB-CONTENT')),
  },
}));

import app              from '../../../src/app';
import { UserModel }    from '../../../src/modules/auth/auth.model';
import { TenantModel }  from '../../../src/modules/tenant/tenant.model';
import { PatientModel } from '../../../src/modules/patient/patient.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { Gender, BloodGroup }     from '../../../src/modules/patient/patient.types';

const JWT_SECRET = process.env.JWT_SECRET!;

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
async function seedTenant(name = 'Test Hospital') {
  return TenantModel.create({
    name,
    adminEmail: `admin@${name.toLowerCase().replace(/\s+/g, '')}.com`,
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'k1',
      gstNumber:               'GST1',
      panCard:                 'k2',
      addressProof:            'k3',
    },
    branding: { displayName: name, primaryColor: '#1A73E8' },
  });
}

async function seedUser(tenantId: string, email: string, role: UserRole, isFirstLogin = false) {
  const passwordHash = await bcrypt.hash('TestPass123!', 1);
  return UserModel.create({
    tenantId,
    email,
    name: email.split('@')[0],
    passwordHash,
    role,
    isActive: true,
    isFirstLogin,
  });
}

function tokenFor(userId: string, tenantId: string, role: UserRole) {
  return jwt.sign(
    { userId, tenantId, role, email: 'actor@test.com', isFirstLogin: false },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function seedPatient(tenantId: string, overrides: Partial<{
  fullName: string;
  mobileNumber: string;
  patientId: string;
}> = {}) {
  return PatientModel.create({
    patientId:    overrides.patientId    ?? `PAT-TEST0001`,
    tenantId,
    fullName:     overrides.fullName     ?? 'Ravi Kumar',
    dateOfBirth:  new Date('1990-05-15'),
    gender:       Gender.MALE,
    mobileNumber: overrides.mobileNumber ?? '9876543210',
    address:      '12 MG Road, Bengaluru',
  });
}

const VALID_PATIENT_BODY = {
  fullName:     'Priya Sharma',
  dateOfBirth:  '1992-03-20',
  gender:       'FEMALE',
  mobileNumber: '9123456789',
  address:      '5 Park Street, Mumbai',
};

// ─── POST /api/patients ────────────────────────────────────────────────────────
describe('POST /api/patients', () => {
  test('201 — Receptionist creates a patient', async () => {
    const tenant = await seedTenant();
    const user   = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(user._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send(VALID_PATIENT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.fullName).toBe('Priya Sharma');
    expect(res.body.data.patientId).toMatch(/^PAT-[A-F0-9]{8}$/);
  });

  test('201 — Nurse can register a patient', async () => {
    const tenant = await seedTenant();
    const nurse  = await seedUser(tenant._id.toString(), 'nurse@h.com', UserRole.NURSE);
    const token  = tokenFor(nurse._id.toString(), tenant._id.toString(), UserRole.NURSE);

    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send(VALID_PATIENT_BODY);

    expect(res.status).toBe(201);
  });

  test('201 — Hospital Admin can register a patient', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send(VALID_PATIENT_BODY);

    expect(res.status).toBe(201);
  });

  test('201 — Admin can register a patient', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin-role@h.com', UserRole.ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.ADMIN);

    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send(VALID_PATIENT_BODY);

    expect(res.status).toBe(201);
  });

  test('201 — patient created with optional fields', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send({
        ...VALID_PATIENT_BODY,
        bloodGroup:           'O+',
        aadhaarNumber:        '123456789012',
        emergencyContactName: 'Raj Sharma',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.bloodGroup).toBe('O+');
    expect(res.body.data.aadhaarNumber).toBe('123456789012');
  });

  test('409 with isDuplicateWarning — same mobile in same tenant without forceCreate', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    // First registration
    await request(app).post('/api/patients').set(bearer(token)).send(VALID_PATIENT_BODY);

    // Duplicate — same mobile
    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send({ ...VALID_PATIENT_BODY, fullName: 'Priya Sharma Copy' });

    expect(res.status).toBe(409);
    expect(res.body.data.isDuplicateWarning).toBe(true);
    expect(res.body.data.existingPatientId).toMatch(/^PAT-/);
  });

  test('201 — forceCreate:true bypasses duplicate warning', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    await request(app).post('/api/patients').set(bearer(token)).send(VALID_PATIENT_BODY);

    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send({ ...VALID_PATIENT_BODY, fullName: 'Priya Sharma 2', forceCreate: true });

    expect(res.status).toBe(201);
  });

  test('duplicate mobile allowed across different tenants', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');

    const rcA   = await seedUser(tenantA._id.toString(), 'rc@a.com', UserRole.RECEPTIONIST);
    const rcB   = await seedUser(tenantB._id.toString(), 'rc@b.com', UserRole.RECEPTIONIST);
    const tokA  = tokenFor(rcA._id.toString(), tenantA._id.toString(), UserRole.RECEPTIONIST);
    const tokB  = tokenFor(rcB._id.toString(), tenantB._id.toString(), UserRole.RECEPTIONIST);

    const resA = await request(app).post('/api/patients').set(bearer(tokA)).send(VALID_PATIENT_BODY);
    const resB = await request(app).post('/api/patients').set(bearer(tokB)).send(VALID_PATIENT_BODY);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  test('400 — missing required fields', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send({ fullName: 'Only Name' }); // missing required fields

    expect(res.status).toBe(400);
  });

  test('400 — invalid gender value', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send({ ...VALID_PATIENT_BODY, gender: 'UNKNOWN' });

    expect(res.status).toBe(400);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).post('/api/patients').send(VALID_PATIENT_BODY);
    expect(res.status).toBe(401);
  });

  test('403 — Doctor role cannot create patients', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(tenant._id.toString(), 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tenant._id.toString(), UserRole.DOCTOR);

    const res = await request(app)
      .post('/api/patients')
      .set(bearer(token))
      .send(VALID_PATIENT_BODY);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/patients ─────────────────────────────────────────────────────────
describe('GET /api/patients', () => {
  test('200 — returns paginated list scoped to tenant', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');

    const rcA   = await seedUser(tenantA._id.toString(), 'rc@a.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rcA._id.toString(), tenantA._id.toString(), UserRole.RECEPTIONIST);

    await seedPatient(tenantA._id.toString(), { patientId: 'PAT-A0000001', mobileNumber: '1111111111' });
    await seedPatient(tenantA._id.toString(), { patientId: 'PAT-A0000002', mobileNumber: '2222222222' });
    await seedPatient(tenantB._id.toString(), { patientId: 'PAT-B0000001', mobileNumber: '3333333333' });

    const res = await request(app).get('/api/patients').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
  });

  test('200 — search by name returns matching patients', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-RAVI0001', fullName: 'Ravi Kumar', mobileNumber: '1111111111' });
    await seedPatient(tenant._id.toString(), { patientId: 'PAT-PRIY0001', fullName: 'Priya Singh', mobileNumber: '2222222222' });

    const res = await request(app)
      .get('/api/patients')
      .query({ q: 'Ravi' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.data[0].fullName).toBe('Ravi Kumar');
    expect(res.body.data.total).toBe(1);
  });

  test('400 — rejects NoSQL operator payloads in patient search query', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/patients')
      .query({ 'q[$ne]': 'Ravi' })
      .set(bearer(token));

    expect(res.status).toBe(400);
  });

  test('200 — SQL-style quote payload is treated as plain text in patient search', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-RAVI0001', fullName: 'Ravi Kumar', mobileNumber: '1111111111' });

    const res = await request(app)
      .get('/api/patients')
      .query({ q: "' OR '1'='1" })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });

  test('200 — regex metacharacters do not broaden patient search results', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-RAVI0001', fullName: 'Ravi Kumar', mobileNumber: '1111111111' });
    await seedPatient(tenant._id.toString(), { patientId: 'PAT-PRIY0001', fullName: 'Priya Singh', mobileNumber: '2222222222' });

    const res = await request(app)
      .get('/api/patients')
      .query({ q: '.*' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });

  test('200 — Doctor can search patients', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(tenant._id.toString(), 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tenant._id.toString(), UserRole.DOCTOR);

    const res = await request(app).get('/api/patients').set(bearer(token));
    expect(res.status).toBe(200);
  });

  test('200 — Receptionist can see patients created by Admin in the same tenant', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin-role@h.com', UserRole.ADMIN);
    const adminToken = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.ADMIN);
    const receptionist = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const receptionistToken = tokenFor(receptionist._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    const createRes = await request(app)
      .post('/api/patients')
      .set(bearer(adminToken))
      .send(VALID_PATIENT_BODY);

    expect(createRes.status).toBe(201);

    const listRes = await request(app)
      .get('/api/patients')
      .query({ q: createRes.body.data.patientId })
      .set(bearer(receptionistToken));

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.total).toBe(1);
    expect(listRes.body.data.data[0].patientId).toBe(createRes.body.data.patientId);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/patients');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/patients/:patientId ─────────────────────────────────────────────
describe('GET /api/patients/:patientId', () => {
  test('200 — returns patient by patientId', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-GET00001' });

    const res = await request(app)
      .get('/api/patients/PAT-GET00001')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.patientId).toBe('PAT-GET00001');
    expect(res.body.data.fullName).toBe('Ravi Kumar');
  });

  test('404 — patient from different tenant returns 404', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');

    await seedPatient(tenantB._id.toString(), { patientId: 'PAT-TENB0001' });

    const rcA   = await seedUser(tenantA._id.toString(), 'rc@a.com', UserRole.RECEPTIONIST);
    const tokA  = tokenFor(rcA._id.toString(), tenantA._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app).get('/api/patients/PAT-TENB0001').set(bearer(tokA));
    expect(res.status).toBe(404);
  });

  test('404 — unknown patientId', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app).get('/api/patients/PAT-NOTFOUND').set(bearer(token));
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/patients/:patientId ───────────────────────────────────────────
describe('PATCH /api/patients/:patientId', () => {
  test('200 — Receptionist updates patient demographics', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-UPD00001' });

    const res = await request(app)
      .patch('/api/patients/PAT-UPD00001')
      .set(bearer(token))
      .send({ fullName: 'Ravi Kumar Updated', address: 'New Address, Bengaluru' });

    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Ravi Kumar Updated');
  });

  test('200 — Hospital Admin can update patient', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-UPD00002' });

    const res = await request(app)
      .patch('/api/patients/PAT-UPD00002')
      .set(bearer(token))
      .send({ bloodGroup: BloodGroup.A_POS });

    expect(res.status).toBe(200);
    expect(res.body.data.bloodGroup).toBe('A+');
  });

  test('200 — Admin can update patient', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin-role@h.com', UserRole.ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.ADMIN);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-UPD00003' });

    const res = await request(app)
      .patch('/api/patients/PAT-UPD00003')
      .set(bearer(token))
      .send({ address: 'Admin Updated Address' });

    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe('Admin Updated Address');
  });

  test('404 — update on non-existent patientId', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch('/api/patients/PAT-NOTFOUND')
      .set(bearer(token))
      .send({ fullName: 'Ghost' });

    expect(res.status).toBe(404);
  });

  test('400 — invalid bloodGroup value', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-BADBL001' });

    const res = await request(app)
      .patch('/api/patients/PAT-BADBL001')
      .set(bearer(token))
      .send({ bloodGroup: 'Z+' });

    expect(res.status).toBe(400);
  });

  test('403 — Doctor cannot update patient demographics', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(tenant._id.toString(), 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tenant._id.toString(), UserRole.DOCTOR);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-403DOC01' });

    const res = await request(app)
      .patch('/api/patients/PAT-403DOC01')
      .set(bearer(token))
      .send({ fullName: 'Should Fail' });

    expect(res.status).toBe(403);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app)
      .patch('/api/patients/PAT-UNAUTH01')
      .send({ fullName: 'Should Fail' });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/patients/:patientId/medical-card ─────────────────────────────────
describe('GET /api/patients/:patientId/medical-card', () => {
  test('200 — returns PDF buffer with correct content-type', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-PDF00001' });

    const res = await request(app)
      .get('/api/patients/PAT-PDF00001/medical-card')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/PAT-PDF00001/);
  });

  test('200 — Doctor can download medical card', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(tenant._id.toString(), 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tenant._id.toString(), UserRole.DOCTOR);

    await seedPatient(tenant._id.toString(), { patientId: 'PAT-PDF00002' });

    const res = await request(app)
      .get('/api/patients/PAT-PDF00002/medical-card')
      .set(bearer(token));

    expect(res.status).toBe(200);
  });

  test('404 — unknown patientId for medical card', async () => {
    const tenant = await seedTenant();
    const rc     = await seedUser(tenant._id.toString(), 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tenant._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/patients/PAT-NOTFOUND/medical-card')
      .set(bearer(token));

    expect(res.status).toBe(404);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/patients/PAT-TEST0001/medical-card');
    expect(res.status).toBe(401);
  });
});
