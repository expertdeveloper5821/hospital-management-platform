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

import app                from '../../../src/app';
import { UserModel }      from '../../../src/modules/auth/auth.model';
import { TenantModel }    from '../../../src/modules/tenant/tenant.model';
import { PatientModel }   from '../../../src/modules/patient/patient.model';
import { OPDVisitModel }  from '../../../src/modules/opd/opd.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { OPDVisitStatus }         from '../../../src/modules/opd/opd.types';
import { Gender }                 from '../../../src/modules/patient/patient.types';

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

async function seedUser(tenantId: string, email: string, role: UserRole) {
  const passwordHash = await bcrypt.hash('TestPass123!', 1);
  return UserModel.create({ tenantId, email, passwordHash, role, isActive: true, isFirstLogin: false });
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

async function seedPatient(tenantId: string, patientId = 'PAT-TEST0001') {
  return PatientModel.create({
    patientId,
    tenantId,
    fullName:    'Ravi Kumar',
    dateOfBirth: new Date('1990-05-15'),
    gender:      Gender.MALE,
    mobileNumber: '9876543210',
    address:     '12 MG Road, Bengaluru',
  });
}

async function seedVisit(tenantId: string, overrides: Partial<{
  visitId:  string;
  patientId: string;
  status:   OPDVisitStatus;
  doctorId: string;
}> = {}) {
  return OPDVisitModel.create({
    visitId:        overrides.visitId   ?? 'OPD-TEST0001',
    tenantId,
    patientId:      overrides.patientId ?? 'PAT-TEST0001',
    doctorId:       overrides.doctorId  ?? null,
    visitDate:      new Date('2026-05-15T00:00:00.000Z'),
    queueNumber:    1,
    status:         overrides.status    ?? OPDVisitStatus.OPEN,
    chiefComplaint: 'Fever and headache',
    diagnosis:      null,
    prescription:   null,
    notes:          null,
  });
}

const VALID_VISIT_BODY = {
  patientId:      'PAT-TEST0001',
  chiefComplaint: 'Fever and headache',
  visitDate:      '2026-05-15',
};

// ─── POST /api/opd/visits ─────────────────────────────────────────────────────
describe('POST /api/opd/visits', () => {
  test('201 — Receptionist creates a visit with OPEN status', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send(VALID_VISIT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(OPDVisitStatus.OPEN);
    expect(res.body.data.visitId).toMatch(/^OPD-[A-F0-9]{8}$/);
    expect(res.body.data.queueNumber).toBe(1);
    expect(res.body.data.diagnosis).toBeNull();
  });

  test('201 — Doctor can create a visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send(VALID_VISIT_BODY);

    expect(res.status).toBe(201);
  });

  test('201 — queue numbers increment per day', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-A000001');
    await seedPatient(tid, 'PAT-A000002');
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res1 = await request(app).post('/api/opd/visits').set(bearer(token))
      .send({ ...VALID_VISIT_BODY, patientId: 'PAT-A000001' });
    const res2 = await request(app).post('/api/opd/visits').set(bearer(token))
      .send({ ...VALID_VISIT_BODY, patientId: 'PAT-A000002' });

    expect(res1.body.data.queueNumber).toBe(1);
    expect(res2.body.data.queueNumber).toBe(2);
  });

  test('404 — unknown patientId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, patientId: 'PAT-UNKNOWN1' });

    expect(res.status).toBe(404);
  });

  test('400 — missing chiefComplaint', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ patientId: 'PAT-TEST0001' });

    expect(res.status).toBe(400);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).post('/api/opd/visits').send(VALID_VISIT_BODY);
    expect(res.status).toBe(401);
  });

  test('403 — Manager role cannot create visits', async () => {
    const tenant  = await seedTenant();
    const tid     = tenant._id.toString();
    await seedPatient(tid);
    const manager = await seedUser(tid, 'mgr@h.com', UserRole.MANAGER);
    const token   = tokenFor(manager._id.toString(), tid, UserRole.MANAGER);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send(VALID_VISIT_BODY);

    expect(res.status).toBe(403);
  });

  test('tenant isolation — patient from another tenant returns 404', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');
    await seedPatient(tenantB._id.toString(), 'PAT-TENB0001');

    const rcA   = await seedUser(tenantA._id.toString(), 'rc@a.com', UserRole.RECEPTIONIST);
    const tokA  = tokenFor(rcA._id.toString(), tenantA._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(tokA))
      .send({ ...VALID_VISIT_BODY, patientId: 'PAT-TENB0001' });

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/opd/visits ──────────────────────────────────────────────────────
describe('GET /api/opd/visits', () => {
  test('200 — returns OPEN and IN_PROGRESS visits for the given date', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-OPEN0001', status: OPDVisitStatus.OPEN });
    await seedVisit(tid, { visitId: 'OPD-INPR0001', status: OPDVisitStatus.IN_PROGRESS });
    await seedVisit(tid, { visitId: 'OPD-DONE0001', status: OPDVisitStatus.COMPLETED });
    await seedVisit(tid, { visitId: 'OPD-CANC0001', status: OPDVisitStatus.CANCELLED });

    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    const visitIds = res.body.data.map((v: { visitId: string }) => v.visitId);
    expect(visitIds).toContain('OPD-OPEN0001');
    expect(visitIds).toContain('OPD-INPR0001');
    expect(visitIds).not.toContain('OPD-DONE0001');
    expect(visitIds).not.toContain('OPD-CANC0001');
  });

  test('200 — filters queue by doctorId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-DOC10001', doctorId: 'doc-1' });
    await seedVisit(tid, { visitId: 'OPD-DOC20001', doctorId: 'doc-2' });

    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15', doctorId: 'doc-1' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].visitId).toBe('OPD-DOC10001');
  });

  test('200 — returns empty array when no active visits', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('200 — tenant isolation: only own visits returned', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');
    await seedVisit(tenantA._id.toString(), { visitId: 'OPD-TENA0001' });
    await seedVisit(tenantB._id.toString(), { visitId: 'OPD-TENB0001' });

    const rcA   = await seedUser(tenantA._id.toString(), 'rc@a.com', UserRole.RECEPTIONIST);
    const tokA  = tokenFor(rcA._id.toString(), tenantA._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(tokA));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].visitId).toBe('OPD-TENA0001');
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/opd/visits');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/opd/visits/:visitId ─────────────────────────────────────────────
describe('GET /api/opd/visits/:visitId', () => {
  test('200 — returns visit by visitId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-GET00001' });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/visits/OPD-GET00001')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.visitId).toBe('OPD-GET00001');
    expect(res.body.data.chiefComplaint).toBe('Fever and headache');
  });

  test('404 — visit from different tenant returns 404', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');
    await seedVisit(tenantB._id.toString(), { visitId: 'OPD-TENB0002' });

    const rcA   = await seedUser(tenantA._id.toString(), 'rc@a.com', UserRole.RECEPTIONIST);
    const tokA  = tokenFor(rcA._id.toString(), tenantA._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app).get('/api/opd/visits/OPD-TENB0002').set(bearer(tokA));
    expect(res.status).toBe(404);
  });

  test('404 — unknown visitId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app).get('/api/opd/visits/OPD-MISSING').set(bearer(token));
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/opd/visits/:visitId ───────────────────────────────────────────
describe('PATCH /api/opd/visits/:visitId', () => {
  test('200 — Doctor updates notes on OPEN visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-UPD00001' });
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-UPD00001')
      .set(bearer(token))
      .send({ notes: 'BP: 120/80, temp: 99F' });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('BP: 120/80, temp: 99F');
  });

  test('409 — cannot update a COMPLETED visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-DONE0001', status: OPDVisitStatus.COMPLETED });
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-DONE0001')
      .set(bearer(token))
      .send({ diagnosis: 'Updated after complete' });

    expect(res.status).toBe(409);
  });

  test('409 — cannot update a CANCELLED visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-CANC0001', status: OPDVisitStatus.CANCELLED });
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-CANC0001')
      .set(bearer(token))
      .send({ notes: 'Should fail' });

    expect(res.status).toBe(409);
  });

  test('403 — Receptionist cannot update visit content', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-RBAC0001' });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-RBAC0001')
      .set(bearer(token))
      .send({ notes: 'Should fail' });

    expect(res.status).toBe(403);
  });

  test('404 — unknown visitId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-MISSING')
      .set(bearer(token))
      .send({ notes: 'Test' });

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/opd/visits/:visitId/complete ──────────────────────────────────
describe('PATCH /api/opd/visits/:visitId/complete', () => {
  test('200 — Doctor completes a visit with diagnosis', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-COMP0001' });
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-COMP0001/complete')
      .set(bearer(token))
      .send({ diagnosis: 'Viral fever, resolved. Rest advised.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(OPDVisitStatus.COMPLETED);
    expect(res.body.data.diagnosis).toBe('Viral fever, resolved. Rest advised.');
  });

  test('409 — completing an already-COMPLETED visit returns 409', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-CDONE001', status: OPDVisitStatus.COMPLETED });
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-CDONE001/complete')
      .set(bearer(token))
      .send({ diagnosis: 'Re-complete attempt' });

    expect(res.status).toBe(409);
  });

  test('409 — COMPLETED visit rejects further PATCH updates', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-CSEQ0001' });
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    // First complete the visit
    await request(app)
      .patch('/api/opd/visits/OPD-CSEQ0001/complete')
      .set(bearer(token))
      .send({ diagnosis: 'Completed' });

    // Attempt to update afterwards
    const patchRes = await request(app)
      .patch('/api/opd/visits/OPD-CSEQ0001')
      .set(bearer(token))
      .send({ notes: 'Should be rejected' });

    expect(patchRes.status).toBe(409);
  });

  test('400 — missing diagnosis', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-CNODIAG1' });
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-CNODIAG1/complete')
      .set(bearer(token))
      .send({});

    expect(res.status).toBe(400);
  });

  test('403 — Receptionist cannot complete a visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-CRBAC001' });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-CRBAC001/complete')
      .set(bearer(token))
      .send({ diagnosis: 'Fever' });

    expect(res.status).toBe(403);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app)
      .patch('/api/opd/visits/OPD-TEST0001/complete')
      .send({ diagnosis: 'X' });
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/opd/visits/:visitId/cancel ────────────────────────────────────
describe('PATCH /api/opd/visits/:visitId/cancel', () => {
  test('200 — Receptionist cancels an OPEN visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-CANC0010' });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-CANC0010/cancel')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(OPDVisitStatus.CANCELLED);
  });

  test('409 — cannot cancel a COMPLETED visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-CCANC001', status: OPDVisitStatus.COMPLETED });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-CCANC001/cancel')
      .set(bearer(token));

    expect(res.status).toBe(409);
  });
});

// ─── GET /api/opd/patients/:patientId/history ─────────────────────────────────
describe('GET /api/opd/patients/:patientId/history', () => {
  test('200 — returns paginated visit history for a patient', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedVisit(tid, { visitId: 'OPD-HIST0001' });
    await seedVisit(tid, { visitId: 'OPD-HIST0002' });

    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/history')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.data).toHaveLength(2);
  });

  test('200 — respects pagination params', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    for (let i = 1; i <= 5; i++) {
      await seedVisit(tid, { visitId: `OPD-PGTEST${String(i).padStart(2, '0')}` });
    }

    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/history')
      .query({ page: 1, limit: 2 })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.totalPages).toBe(3);
  });

  test('404 — unknown patient returns 404', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-MISSING/history')
      .set(bearer(token));

    expect(res.status).toBe(404);
  });

  test('200 — tenant isolation: patient from other tenant returns 404', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');
    await seedPatient(tenantB._id.toString(), 'PAT-TENB9999');

    const rcA   = await seedUser(tenantA._id.toString(), 'rc@a.com', UserRole.RECEPTIONIST);
    const tokA  = tokenFor(rcA._id.toString(), tenantA._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TENB9999/history')
      .set(bearer(tokA));

    expect(res.status).toBe(404);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/opd/patients/PAT-TEST0001/history');
    expect(res.status).toBe(401);
  });
});
