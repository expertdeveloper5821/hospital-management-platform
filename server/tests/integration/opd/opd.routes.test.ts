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
import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
import { WardModel }         from '../../../src/modules/ipd/ward.model';
import { PaymentModel }      from '../../../src/modules/payment/payment.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { OPDVisitStatus }         from '../../../src/modules/opd/opd.types';
import { Gender }                 from '../../../src/modules/patient/patient.types';
import { PaymentMethod, PaymentStatus, PaymentReferenceType } from '../../../src/modules/payment/payment.types';

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
      addressLine:            '654 OPD Road',
      city:                    'Bengaluru',
      state:                   'Karnataka',
      pincode:                 '400001',
    },
    branding: { displayName: name, primaryColor: '#1A73E8' },
  });
}

async function seedUser(tenantId: string, email: string, role: UserRole) {
  const passwordHash = await bcrypt.hash('TestPass123!', 1);
  return UserModel.create({ tenantId, email, name: email.split('@')[0], passwordHash, role, isActive: true, isFirstLogin: false });
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
  visitId:   string;
  patientId: string;
  status:    OPDVisitStatus;
  doctorIds: string[];
}> = {}) {
  return OPDVisitModel.create({
    visitId:        overrides.visitId   ?? 'OPD-TEST0001',
    tenantId,
    patientId:      overrides.patientId ?? 'PAT-TEST0001',
    doctorIds:      overrides.doctorIds ?? [],
    visitDate:      new Date('2026-05-15T00:00:00.000Z'),
    queueNumber:    1,
    status:         overrides.status    ?? OPDVisitStatus.OPEN,
    diagnosis:      null,
    prescription:   null,
    notes:          null,
  });
}

function todayDateStr(): string {
  return new Date().toISOString().substring(0, 10);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * MS_PER_DAY);
}

// Seeds a COMPLETED OPD payment with an explicit createdAt (bypassing
// mongoose's automatic timestamps so validity-boundary scenarios are
// deterministic regardless of when the suite runs).
async function seedOpdPayment(tenantId: string, overrides: Partial<{
  patientId: string;
  visitId:   string;
  createdAt: Date;
  status:    PaymentStatus;
}> = {}) {
  const paymentId = `pay-${Math.random().toString(36).slice(2, 10)}`;
  await PaymentModel.create({
    paymentId,
    tenantId,
    patientId:     overrides.patientId ?? 'PAT-TEST0001',
    fullName:      'Ravi Kumar',
    amount:        500,
    paymentMethod: PaymentMethod.CASH,
    description:   'OPD Consultation',
    status:        overrides.status ?? PaymentStatus.COMPLETED,
    referenceType: PaymentReferenceType.OPD_VISIT,
    referenceId:   overrides.visitId ?? 'OPD-TEST0001',
    createdBy:     'rc-1',
  });
  if (overrides.createdAt) {
    // Goes through the native driver, not Mongoose's updateOne — Mongoose's
    // query layer silently no-ops this particular $set (acknowledged:false)
    // for a timestamped schema, so the raw collection handle is used instead.
    await PaymentModel.collection.updateOne(
      { paymentId },
      { $set: { createdAt: overrides.createdAt } },
    );
  }
  return paymentId;
}

const VALID_VISIT_BODY = {
  patientId: 'PAT-TEST0001',
  visitDate: todayDateStr(),
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

  test('403 — Doctor cannot create a visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send(VALID_VISIT_BODY);

    expect(res.status).toBe(403);
    // No visit must have been created despite the attempt.
    const count = await OPDVisitModel.countDocuments({ tenantId: tid });
    expect(count).toBe(0);
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

  test('401 — unauthenticated', async () => {
    const res = await request(app).post('/api/opd/visits').send(VALID_VISIT_BODY);
    expect(res.status).toBe(401);
  });

  test('201 — notes with leading/trailing whitespace are trimmed', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, notes: '  routine visit  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.notes).toBe('routine visit');
  });

  test('201 — unsafe CSS in notes is stripped on the server, even bypassing the editor', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({
        ...VALID_VISIT_BODY,
        notes: '<p><span style="font-size: 14px; position: fixed; top: 0; z-index: 99999; '
          + 'background: url(https://evil.test/track.png);">Note text</span></p>',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.notes).toBe('<p><span style="font-size: 14px">Note text</span></p>');
  });

  test('201 — Manager can create a visit', async () => {
    const tenant  = await seedTenant();
    const tid     = tenant._id.toString();
    await seedPatient(tid);
    const manager = await seedUser(tid, 'mgr@h.com', UserRole.MANAGER);
    const token   = tokenFor(manager._id.toString(), tid, UserRole.MANAGER);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send(VALID_VISIT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(OPDVisitStatus.OPEN);
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

  test('409 — duplicate visit for same patient, doctor, and date is rejected', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const first = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, doctorIds: ['doc-1'] });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, doctorIds: ['doc-1'] });

    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already exists/i);
  });

  test('201 — same patient/doctor/date is allowed once the earlier visit is cancelled', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const first = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, doctorIds: ['doc-1'] });
    expect(first.status).toBe(201);

    await request(app)
      .patch(`/api/opd/visits/${first.body.data.visitId}/cancel`)
      .set(bearer(token));

    const second = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, doctorIds: ['doc-1'] });

    expect(second.status).toBe(201);
  });

  test('201 — same patient/date but a different doctor is allowed', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const first = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, doctorIds: ['doc-1'] });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, doctorIds: ['doc-2'] });

    expect(second.status).toBe(201);
  });

  test('201 — visits without a doctor assigned are not treated as duplicates', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const first  = await request(app).post('/api/opd/visits').set(bearer(token)).send(VALID_VISIT_BODY);
    const second = await request(app).post('/api/opd/visits').set(bearer(token)).send(VALID_VISIT_BODY);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  // ─── Past-date validation ───────────────────────────────────────────────────

  test('400 — Receptionist cannot create a visit for a past date', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, visitDate: '2020-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Past dates are not allowed for OPD visits\./);
  });

  test('403 — Nurse cannot create a visit at all (view-only access to Doctor Visits)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const nurse  = await seedUser(tid, 'nurse@h.com', UserRole.NURSE);

    const resNurse = await request(app)
      .post('/api/opd/visits')
      .set(bearer(tokenFor(nurse._id.toString(), tid, UserRole.NURSE)))
      .send({ ...VALID_VISIT_BODY, visitDate: '2020-01-01' });
    expect(resNurse.status).toBe(403);
  });

  test('201 — Hospital Admin can create a backdated visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const admin = await seedUser(tid, 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token = tokenFor(admin._id.toString(), tid, UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, visitDate: '2020-01-01' });

    expect(res.status).toBe(201);
    const expectedDate = new Date('2020-01-01');
    expectedDate.setHours(0, 0, 0, 0);
    expect(new Date(res.body.data.visitDate).getTime()).toBe(expectedDate.getTime());
  });

  test('201 — today\'s date is allowed for a normal role', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, visitDate: todayDateStr() });

    expect(res.status).toBe(201);
  });

  test('201 — a future date is allowed for a normal role', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);
    const future = new Date();
    future.setDate(future.getDate() + 14);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, visitDate: future.toISOString().substring(0, 10) });

    expect(res.status).toBe(201);
  });
});

// ─── GET /api/opd/visits ──────────────────────────────────────────────────────
describe('GET /api/opd/visits', () => {
  test('200 — returns all visits for the given date regardless of status', async () => {
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
    expect(visitIds).toContain('OPD-DONE0001');
    expect(visitIds).toContain('OPD-CANC0001');
  });

  test('200 — orders visits by newest-created first, regardless of queueNumber/insertion order', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();

    // Insert out of chronological order, with explicit createdAt timestamps,
    // so the assertion can only pass if the query sorts by createdAt desc
    // rather than relying on insertion/document order.
    await OPDVisitModel.create({
      visitId:        'OPD-MID00001',
      tenantId:       tid,
      patientId:      'PAT-TEST0001',
      doctorIds:      [],
      visitDate:      new Date('2026-05-15T00:00:00.000Z'),
      queueNumber:    2,
      status:         OPDVisitStatus.OPEN,
      diagnosis:      null,
      prescription:   null,
      notes:          null,
      createdAt:      new Date('2026-05-15T09:00:00.000Z'),
    });
    await OPDVisitModel.create({
      visitId:        'OPD-OLD00001',
      tenantId:       tid,
      patientId:      'PAT-TEST0001',
      doctorIds:      [],
      visitDate:      new Date('2026-05-15T00:00:00.000Z'),
      queueNumber:    1,
      status:         OPDVisitStatus.OPEN,
      diagnosis:      null,
      prescription:   null,
      notes:          null,
      createdAt:      new Date('2026-05-15T08:00:00.000Z'),
    });
    await OPDVisitModel.create({
      visitId:        'OPD-NEW00001',
      tenantId:       tid,
      patientId:      'PAT-TEST0001',
      doctorIds:      [],
      visitDate:      new Date('2026-05-15T00:00:00.000Z'),
      queueNumber:    3,
      status:         OPDVisitStatus.OPEN,
      diagnosis:      null,
      prescription:   null,
      notes:          null,
      createdAt:      new Date('2026-05-15T10:00:00.000Z'),
    });

    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    const visitIds = res.body.data.map((v: { visitId: string }) => v.visitId);
    expect(visitIds).toEqual(['OPD-NEW00001', 'OPD-MID00001', 'OPD-OLD00001']);
  });

  test('200 — filters queue by doctorId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-DOC10001', doctorIds: ['doc-1'] });
    await seedVisit(tid, { visitId: 'OPD-DOC20001', doctorIds: ['doc-2'] });

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

  test('200 — Doctor sees only their own assigned visits, even when a different doctorId is requested', async () => {
    const tenant   = await seedTenant();
    const tid      = tenant._id.toString();
    const doctor   = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const doctorId = doctor._id.toString();
    await seedVisit(tid, { visitId: 'OPD-MINE0001', doctorIds: [doctorId] });
    await seedVisit(tid, { visitId: 'OPD-OTHER001', doctorIds: ['other-doc-id'] });

    const token = tokenFor(doctorId, tid, UserRole.DOCTOR);

    // Attempting to request another doctor's visits via the doctorId query param
    // must be ignored — the backend always forces doctorId back to the caller's own.
    const res = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15', doctorId: 'other-doc-id' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].visitId).toBe('OPD-MINE0001');
  });

  test('200 — Doctor sees all of their own visits regardless of status (open, in-progress, completed, cancelled)', async () => {
    const tenant   = await seedTenant();
    const tid      = tenant._id.toString();
    const doctor   = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const doctorId = doctor._id.toString();
    await seedVisit(tid, { visitId: 'OPD-D-OPEN1', doctorIds: [doctorId], status: OPDVisitStatus.OPEN });
    await seedVisit(tid, { visitId: 'OPD-D-DONE1', doctorIds: [doctorId], status: OPDVisitStatus.COMPLETED });
    await seedVisit(tid, { visitId: 'OPD-D-CANC1', doctorIds: [doctorId], status: OPDVisitStatus.CANCELLED });
    await seedVisit(tid, { visitId: 'OPD-OTHRDOC', doctorIds: ['someone-else'], status: OPDVisitStatus.OPEN });

    const token = tokenFor(doctorId, tid, UserRole.DOCTOR);

    const res = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    const visitIds = res.body.data.map((v: { visitId: string }) => v.visitId);
    expect(visitIds).toEqual(expect.arrayContaining(['OPD-D-OPEN1', 'OPD-D-DONE1', 'OPD-D-CANC1']));
    expect(visitIds).not.toContain('OPD-OTHRDOC');
    expect(res.body.data).toHaveLength(3);
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

// ─── Nurse ward-scoped access restriction ──────────────────────────────────────
describe('Nurse ward-scoped access restriction', () => {
  async function admitPatientToWard(tenantId: string, patientId: string, wardId: string, admissionId: string) {
    return IPDAdmissionModel.create({
      admissionId,
      patientId,
      wardId,
      wardName:          'Ward',
      bedId:             `bed-${admissionId}`,
      bedNumber:         'B-01',
      assignedDoctorIds: [],
      status:            'ADMITTED',
      admissionDate:     new Date(),
      dischargeDate:     null,
      progressNotes:     [],
      tenantId,
    });
  }

  test('200 — nurse sees only OPD visits for patients currently admitted in their ward', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse@h.com', UserRole.NURSE);
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse._id.toString()] });
    const wardB  = await WardModel.create({ name: 'Ward B', tenantId: tid });

    await seedPatient(tid, 'PAT-WA000001');
    await seedPatient(tid, 'PAT-WB000001');
    await admitPatientToWard(tid, 'PAT-WA000001', wardA._id.toString(), 'ADM-OPD-WA1');
    await admitPatientToWard(tid, 'PAT-WB000001', wardB._id.toString(), 'ADM-OPD-WB1');
    await seedVisit(tid, { visitId: 'OPD-NWA0001', patientId: 'PAT-WA000001' });
    await seedVisit(tid, { visitId: 'OPD-NWB0001', patientId: 'PAT-WB000001' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].visitId).toBe('OPD-NWA0001');
  });

  test('200 — nurse can fetch an OPD visit for a patient in their own ward by direct visitId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse@h.com', UserRole.NURSE);
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse._id.toString()] });

    await seedPatient(tid, 'PAT-WA000002');
    await admitPatientToWard(tid, 'PAT-WA000002', wardA._id.toString(), 'ADM-OPD-WA2');
    await seedVisit(tid, { visitId: 'OPD-NWA0002', patientId: 'PAT-WA000002' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app).get('/api/opd/visits/OPD-NWA0002').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.visitId).toBe('OPD-NWA0002');
  });

  test('404 — nurse cannot fetch another ward\'s OPD visit via direct visitId (Direct URL / manual ID)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse@h.com', UserRole.NURSE);
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse._id.toString()] });
    const wardB  = await WardModel.create({ name: 'Ward B', tenantId: tid });

    await seedPatient(tid, 'PAT-WA000003');
    await seedPatient(tid, 'PAT-WB000003');
    await admitPatientToWard(tid, 'PAT-WA000003', wardA._id.toString(), 'ADM-OPD-WA3');
    await admitPatientToWard(tid, 'PAT-WB000003', wardB._id.toString(), 'ADM-OPD-WB3');
    await seedVisit(tid, { visitId: 'OPD-NWB0003', patientId: 'PAT-WB000003' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app).get('/api/opd/visits/OPD-NWB0003').set(bearer(token));

    expect(res.status).toBe(404);
  });

  test('200 — nurse with no ward assigned sees an empty OPD queue (not an error)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-NW00001' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('200 — other roles (Receptionist) continue to see all OPD visits as before', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: tid });
    const wardB  = await WardModel.create({ name: 'Ward B', tenantId: tid });

    await seedPatient(tid, 'PAT-RCA0001');
    await seedPatient(tid, 'PAT-RCB0001');
    await admitPatientToWard(tid, 'PAT-RCA0001', wardA._id.toString(), 'ADM-OPD-RCA');
    await admitPatientToWard(tid, 'PAT-RCB0001', wardB._id.toString(), 'ADM-OPD-RCB');
    await seedVisit(tid, { visitId: 'OPD-RCA0001', patientId: 'PAT-RCA0001' });
    await seedVisit(tid, { visitId: 'OPD-RCB0001', patientId: 'PAT-RCB0001' });

    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);
    const res   = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

// ─── Doctor patient-assignment scoping ─────────────────────────────────────────
describe('Doctor patient-assignment scoping', () => {
  test('200 — doctor can fetch a visit they are assigned to via direct visitId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-own@h.com', UserRole.DOCTOR);
    const doctorId = doctor._id.toString();

    await seedPatient(tid, 'PAT-DOC00001');
    await seedVisit(tid, { visitId: 'OPD-DOC00001', patientId: 'PAT-DOC00001', doctorIds: [doctorId] });

    const token = tokenFor(doctorId, tid, UserRole.DOCTOR);
    const res   = await request(app).get('/api/opd/visits/OPD-DOC00001').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.visitId).toBe('OPD-DOC00001');
  });

  test('404 — doctor cannot fetch another doctor\'s patient\'s visit via direct visitId (Direct URL / manual ID)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-a@h.com', UserRole.DOCTOR);
    const otherDoctor = await seedUser(tid, 'doc-b@h.com', UserRole.DOCTOR);

    await seedPatient(tid, 'PAT-DOC00002');
    await seedVisit(tid, { visitId: 'OPD-DOC00002', patientId: 'PAT-DOC00002', doctorIds: [otherDoctor._id.toString()] });

    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);
    const res   = await request(app).get('/api/opd/visits/OPD-DOC00002').set(bearer(token));

    expect(res.status).toBe(404);
  });

  test('200 — doctor can fetch a visit for a patient assigned to them via a separate IPD admission (continuity of care)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-ipd@h.com', UserRole.DOCTOR);
    const otherDoctor = await seedUser(tid, 'doc-other@h.com', UserRole.DOCTOR);
    const doctorId = doctor._id.toString();

    await seedPatient(tid, 'PAT-DOC00003');
    // This particular visit is assigned to a different doctor...
    await seedVisit(tid, { visitId: 'OPD-DOC00003', patientId: 'PAT-DOC00003', doctorIds: [otherDoctor._id.toString()] });
    // ...but the requesting doctor is separately treating this patient via IPD.
    await IPDAdmissionModel.create({
      admissionId:       'ADM-DOC-003',
      patientId:         'PAT-DOC00003',
      wardId:            'ward-1',
      bedId:             'bed-1',
      bedNumber:         'B-01',
      wardName:          'General Ward',
      assignedDoctorIds: [doctorId],
      status:            'ADMITTED',
      admissionDate:     new Date(),
      dischargeDate:     null,
      progressNotes:     [],
      tenantId:          tid,
    });

    const token = tokenFor(doctorId, tid, UserRole.DOCTOR);
    const res   = await request(app).get('/api/opd/visits/OPD-DOC00003').set(bearer(token));

    expect(res.status).toBe(200);
  });

  test('200 — doctor sees only their own assigned patient\'s history; 404 for another doctor\'s patient', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-hist@h.com', UserRole.DOCTOR);
    const otherDoctor = await seedUser(tid, 'doc-hist-other@h.com', UserRole.DOCTOR);
    const doctorId = doctor._id.toString();

    await seedPatient(tid, 'PAT-DOC00004');
    await seedVisit(tid, { visitId: 'OPD-DOC00004', patientId: 'PAT-DOC00004', doctorIds: [doctorId] });

    await seedPatient(tid, 'PAT-DOC00005');
    await seedVisit(tid, { visitId: 'OPD-DOC00005', patientId: 'PAT-DOC00005', doctorIds: [otherDoctor._id.toString()] });

    const token = tokenFor(doctorId, tid, UserRole.DOCTOR);

    const ownHistory = await request(app)
      .get('/api/opd/patients/PAT-DOC00004/history')
      .set(bearer(token));
    expect(ownHistory.status).toBe(200);
    expect(ownHistory.body.data.total).toBe(1);

    const otherHistory = await request(app)
      .get('/api/opd/patients/PAT-DOC00005/history')
      .set(bearer(token));
    expect(otherHistory.status).toBe(404);
  });

  test('404 — doctor with no assigned patients cannot fetch any visit by direct ID', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-none@h.com', UserRole.DOCTOR);

    await seedPatient(tid, 'PAT-DOC00006');
    await seedVisit(tid, { visitId: 'OPD-DOC00006', patientId: 'PAT-DOC00006' });

    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);
    const res   = await request(app).get('/api/opd/visits/OPD-DOC00006').set(bearer(token));

    expect(res.status).toBe(404);
  });

  test('200 — other roles (Receptionist) continue to fetch any visit by direct ID as before', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const rc     = await seedUser(tid, 'rc-doc@h.com', UserRole.RECEPTIONIST);
    const doctor = await seedUser(tid, 'doc-unrelated@h.com', UserRole.DOCTOR);

    await seedPatient(tid, 'PAT-DOC00007');
    await seedVisit(tid, { visitId: 'OPD-DOC00007', patientId: 'PAT-DOC00007', doctorIds: [doctor._id.toString()] });

    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);
    const res   = await request(app).get('/api/opd/visits/OPD-DOC00007').set(bearer(token));

    expect(res.status).toBe(200);
  });
});

// ─── Nurse/Doctor scoping — mutation guards (update/complete/cancel) ──────────
describe('Nurse/Doctor scoping — mutation guards', () => {
  async function admitToWard(tenantId: string, patientId: string, wardId: string, admissionId: string) {
    return IPDAdmissionModel.create({
      admissionId,
      patientId,
      wardId,
      wardName:          'Ward',
      bedId:             `bed-${admissionId}`,
      bedNumber:         'B-01',
      assignedDoctorIds: [],
      status:            'ADMITTED',
      admissionDate:     new Date(),
      dischargeDate:     null,
      progressNotes:     [],
      tenantId,
    });
  }

  // ─── Nurse (view-only — no create/edit/complete/cancel) ──────────────────

  test('403 — nurse cannot update a visit (view-only access to Doctor Visits)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse-upd@h.com', UserRole.NURSE);
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse._id.toString()] });

    await seedPatient(tid, 'PAT-NMUT0001');
    await admitToWard(tid, 'PAT-NMUT0001', wardA._id.toString(), 'ADM-NMUT-A1');
    await seedVisit(tid, { visitId: 'OPD-NMUT0001', patientId: 'PAT-NMUT0001' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-NMUT0001')
      .set(bearer(token))
      .send({ notes: 'Should be blocked' });

    expect(res.status).toBe(403);
  });

  test('403 — nurse cannot complete a visit (view-only access to Doctor Visits)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse-comp@h.com', UserRole.NURSE);
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse._id.toString()] });

    await seedPatient(tid, 'PAT-NMUT0003');
    await admitToWard(tid, 'PAT-NMUT0003', wardA._id.toString(), 'ADM-NMUT-A2');
    await seedVisit(tid, { visitId: 'OPD-NMUT0002', patientId: 'PAT-NMUT0003' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-NMUT0002/complete')
      .set(bearer(token))
      .send({ diagnosis: 'Should be blocked' });

    expect(res.status).toBe(403);
  });

  test('403 — nurse cannot cancel a visit (view-only access to Doctor Visits)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse-canc@h.com', UserRole.NURSE);
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse._id.toString()] });

    await seedPatient(tid, 'PAT-NMUT0005');
    await admitToWard(tid, 'PAT-NMUT0005', wardA._id.toString(), 'ADM-NMUT-A3');
    await seedVisit(tid, { visitId: 'OPD-NMUT0003', patientId: 'PAT-NMUT0005' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-NMUT0003/cancel')
      .set(bearer(token));

    expect(res.status).toBe(403);
  });

  test('403 — nurse cannot create a visit (view-only access to Doctor Visits)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse-create@h.com', UserRole.NURSE);
    await seedPatient(tid, 'PAT-NMUT0007');

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, patientId: 'PAT-NMUT0007' });

    expect(res.status).toBe(403);
  });

  // ─── Doctor ──────────────────────────────────────────────────────────────

  test('404 — doctor cannot update another doctor\'s patient\'s visit by direct visitId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-mut-a@h.com', UserRole.DOCTOR);
    const otherDoctor = await seedUser(tid, 'doc-mut-b@h.com', UserRole.DOCTOR);

    await seedPatient(tid, 'PAT-DMUT0001');
    await seedVisit(tid, { visitId: 'OPD-DMUT0001', patientId: 'PAT-DMUT0001', doctorIds: [otherDoctor._id.toString()] });

    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-DMUT0001')
      .set(bearer(token))
      .send({ notes: 'Should be blocked' });

    expect(res.status).toBe(404);
  });

  test('404 — doctor cannot complete another doctor\'s patient\'s visit by direct visitId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-mut-c@h.com', UserRole.DOCTOR);
    const otherDoctor = await seedUser(tid, 'doc-mut-d@h.com', UserRole.DOCTOR);

    await seedPatient(tid, 'PAT-DMUT0002');
    await seedVisit(tid, { visitId: 'OPD-DMUT0002', patientId: 'PAT-DMUT0002', doctorIds: [otherDoctor._id.toString()] });

    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-DMUT0002/complete')
      .set(bearer(token))
      .send({ diagnosis: 'Should be blocked' });

    expect(res.status).toBe(404);
  });

  test('404 — doctor cannot cancel another doctor\'s patient\'s visit by direct visitId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-mut-e@h.com', UserRole.DOCTOR);
    const otherDoctor = await seedUser(tid, 'doc-mut-f@h.com', UserRole.DOCTOR);

    await seedPatient(tid, 'PAT-DMUT0003');
    await seedVisit(tid, { visitId: 'OPD-DMUT0003', patientId: 'PAT-DMUT0003', doctorIds: [otherDoctor._id.toString()] });

    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-DMUT0003/cancel')
      .set(bearer(token));

    expect(res.status).toBe(404);
  });

  test('200 — doctor can still update/complete a visit assigned to them', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-mut-g@h.com', UserRole.DOCTOR);
    const doctorId = doctor._id.toString();

    await seedPatient(tid, 'PAT-DMUT0004');
    await seedVisit(tid, { visitId: 'OPD-DMUT0004', patientId: 'PAT-DMUT0004', doctorIds: [doctorId] });

    const token = tokenFor(doctorId, tid, UserRole.DOCTOR);

    const updateRes = await request(app)
      .patch('/api/opd/visits/OPD-DMUT0004')
      .set(bearer(token))
      .send({ notes: 'Doctor note' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.notes).toBe('Doctor note');

    const completeRes = await request(app)
      .patch('/api/opd/visits/OPD-DMUT0004/complete')
      .set(bearer(token))
      .send({ diagnosis: 'Resolved' });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe(OPDVisitStatus.COMPLETED);
  });

  test('200 — HOSPITAL_ADMIN can still cancel any visit regardless of doctor/nurse assignment (unaffected)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const admin  = await seedUser(tid, 'admin-mut@h.com', UserRole.HOSPITAL_ADMIN);
    const doctor = await seedUser(tid, 'doc-mut-h@h.com', UserRole.DOCTOR);

    await seedPatient(tid, 'PAT-DMUT0005');
    await seedVisit(tid, { visitId: 'OPD-DMUT0005', patientId: 'PAT-DMUT0005', doctorIds: [doctor._id.toString()] });

    const token = tokenFor(admin._id.toString(), tid, UserRole.HOSPITAL_ADMIN);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-DMUT0005/cancel')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(OPDVisitStatus.CANCELLED);
  });
});

// ─── PATCH /api/opd/visits/:visitId ───────────────────────────────────────────
describe('PATCH /api/opd/visits/:visitId', () => {
  test('200 — Doctor updates notes on OPEN visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-UPD00001', doctorIds: [doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-UPD00001')
      .set(bearer(token))
      .send({ notes: 'BP: 120/80, temp: 99F' });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('BP: 120/80, temp: 99F');
  });

  test('400 — notes exceed maximum length on update', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-UPD00002' });
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-UPD00002')
      .set(bearer(token))
      .send({ notes: 'A'.repeat(2001) });

    expect(res.status).toBe(400);
  });

  test('400 — prescription exceeds maximum length on update', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-UPD00003' });
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-UPD00003')
      .set(bearer(token))
      .send({ prescription: 'A'.repeat(5001) });

    expect(res.status).toBe(400);
  });

  test('409 — cannot update a COMPLETED visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-DONE0001', status: OPDVisitStatus.COMPLETED, doctorIds: [doctor._id.toString()] });
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
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-CANC0001', status: OPDVisitStatus.CANCELLED, doctorIds: [doctor._id.toString()] });
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

  test('409 — assigning a doctor already booked for this patient/date on another visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-DUP00001', doctorIds: ['doc-1'] });
    await seedVisit(tid, { visitId: 'OPD-DUP00002', doctorIds: ['doc-2', doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-DUP00002')
      .set(bearer(token))
      .send({ doctorIds: ['doc-1'] });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  test('200 — re-saving a visit with its own unchanged doctor does not trip the duplicate guard', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-SELF0001', doctorIds: ['doc-1', doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-SELF0001')
      .set(bearer(token))
      .send({ doctorIds: ['doc-1'], notes: 'Follow-up note' });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Follow-up note');
  });

  // ─── Past-date validation ───────────────────────────────────────────────────

  test('400 — Doctor cannot move visitDate to a past date', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-PASTUPD1', doctorIds: [doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-PASTUPD1')
      .set(bearer(token))
      .send({ visitDate: '2020-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Past dates are not allowed for OPD visits\./);
  });

  test('200 — Hospital Admin can move visitDate to a past date', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-PASTUPD2' });
    const admin = await seedUser(tid, 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token = tokenFor(admin._id.toString(), tid, UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-PASTUPD2')
      .set(bearer(token))
      .send({ visitDate: '2020-01-01' });

    expect(res.status).toBe(200);
    const expectedDate = new Date('2020-01-01');
    expectedDate.setHours(0, 0, 0, 0);
    expect(new Date(res.body.data.visitDate).getTime()).toBe(expectedDate.getTime());
  });
});

// ─── PATCH /api/opd/visits/:visitId/complete ──────────────────────────────────
describe('PATCH /api/opd/visits/:visitId/complete', () => {
  test('200 — Doctor completes a visit with diagnosis', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-COMP0001', doctorIds: [doctor._id.toString()] });
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
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-CDONE001', status: OPDVisitStatus.COMPLETED, doctorIds: [doctor._id.toString()] });
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
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-CSEQ0001', doctorIds: [doctor._id.toString()] });
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

  test('200 — status filter returns only COMPLETED visits', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedVisit(tid, { visitId: 'OPD-OPEN0001', status: OPDVisitStatus.OPEN });
    await OPDVisitModel.create({
      visitId:        'OPD-DONE0001',
      tenantId:       tid,
      patientId:      'PAT-TEST0001',
      doctorIds:      [],
      visitDate:      new Date('2026-03-01T00:00:00.000Z'),
      queueNumber:    2,
      status:         OPDVisitStatus.COMPLETED,
      diagnosis:      'Common cold',
      prescription:   null,
      notes:          null,
    });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/history')
      .query({ status: 'COMPLETED' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].status).toBe('COMPLETED');
  });

  test('200 — search filter matches diagnosis', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedVisit(tid, { visitId: 'OPD-SRCH0001' });
    await OPDVisitModel.create({
      visitId:        'OPD-SRCH0002',
      tenantId:       tid,
      patientId:      'PAT-TEST0001',
      doctorIds:      [],
      visitDate:      new Date('2026-04-01T00:00:00.000Z'),
      queueNumber:    2,
      status:         OPDVisitStatus.OPEN,
      diagnosis:      'Lumbar strain',
      prescription:   null,
      notes:          null,
    });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/history')
      .query({ search: 'lumbar' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].diagnosis).toBe('Lumbar strain');
  });

  test('400 — startDate after endDate returns 400', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/history')
      .query({ startDate: '2026-12-31', endDate: '2026-01-01' })
      .set(bearer(token));

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/opd/patients/:patientId/payment-validity ───────────────────────
describe('GET /api/opd/patients/:patientId/payment-validity', () => {
  test('200 — NO_PAYMENT when the patient has never paid for OPD', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/payment-validity')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      paymentRequired:   true,
      reason:            'NO_PAYMENT',
      latestPaymentId:   null,
      validUntil:        null,
      validityDays:      15,
    });
  });

  test('200 — VALID when the latest payment is within the default 15-day window', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedOpdPayment(tid, { createdAt: daysAgo(5) });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/payment-validity')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('VALID');
    expect(res.body.data.paymentRequired).toBe(false);
  });

  test('200 — EXPIRED when the latest payment is past the default 15-day window', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedOpdPayment(tid, { createdAt: daysAgo(20) });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/payment-validity')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('EXPIRED');
    expect(res.body.data.paymentRequired).toBe(true);
  });

  test('200 — respects a hospital-configured validity period instead of the hardcoded default', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await TenantModel.findByIdAndUpdate(tid, { $set: { 'opdSettings.validityDays': 3 } });
    await seedPatient(tid);
    await seedOpdPayment(tid, { createdAt: daysAgo(5) }); // valid under 15-day default, expired under 3-day config
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/payment-validity')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('EXPIRED');
    expect(res.body.data.validityDays).toBe(3);
  });

  test('200 — only the latest of multiple payments governs validity', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    // An old, already-expired payment plus a fresh one — the fresh one must win.
    await seedOpdPayment(tid, { createdAt: daysAgo(40) });
    const latestId = await seedOpdPayment(tid, { createdAt: daysAgo(2) });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/payment-validity')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('VALID');
    expect(res.body.data.latestPaymentId).toBe(latestId);
  });

  test('200 — a PENDING/FAILED payment does not count toward validity', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedOpdPayment(tid, { createdAt: daysAgo(1), status: PaymentStatus.FAILED });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/payment-validity')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('NO_PAYMENT');
  });

  test('404 — unknown patient', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-UNKNOWN/payment-validity')
      .set(bearer(token));

    expect(res.status).toBe(404);
  });

  test('tenant isolation — a patient (and their payment) belonging to another tenant is not visible', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');
    const tidA = tenantA._id.toString();
    const tidB = tenantB._id.toString();

    await seedPatient(tidB, 'PAT-TEST0002');
    await seedOpdPayment(tidB, { patientId: 'PAT-TEST0002', createdAt: daysAgo(1) });

    const rcA    = await seedUser(tidA, 'rc@a.com', UserRole.RECEPTIONIST);
    const tokenA = tokenFor(rcA._id.toString(), tidA, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0002/payment-validity')
      .set(bearer(tokenA));

    expect(res.status).toBe(404);
  });

  test('403 — Doctor cannot call the payment-validity check (not in the create-visit role set)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doc   = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token = tokenFor(doc._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/payment-validity')
      .set(bearer(token));

    expect(res.status).toBe(403);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/opd/patients/PAT-TEST0001/payment-validity');
    expect(res.status).toBe(401);
  });

  // ── doctor-specific validity ─────────────────────────────────────────────
  describe('doctorIds query param — doctor-specific validity', () => {
    test('200 — VALID when the payment is tied to a visit with the requested doctor, within the window', async () => {
      const tenant = await seedTenant();
      const tid    = tenant._id.toString();
      await seedPatient(tid);
      await seedVisit(tid, { visitId: 'OPD-DOC1', doctorIds: ['doc-1'] });
      await seedOpdPayment(tid, { visitId: 'OPD-DOC1', createdAt: daysAgo(5) });
      const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
      const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

      const res = await request(app)
        .get('/api/opd/patients/PAT-TEST0001/payment-validity?doctorIds=doc-1')
        .set(bearer(token));

      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe('VALID');
      expect(res.body.data.paymentRequired).toBe(false);
    });

    test('200 — DIFFERENT_DOCTOR when the patient has a valid payment, but for a different doctor', async () => {
      const tenant = await seedTenant();
      const tid    = tenant._id.toString();
      await seedPatient(tid);
      await seedVisit(tid, { visitId: 'OPD-DOC1', doctorIds: ['doc-1'] });
      await seedOpdPayment(tid, { visitId: 'OPD-DOC1', createdAt: daysAgo(1) }); // still within window, but for doc-1
      const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
      const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

      const res = await request(app)
        .get('/api/opd/patients/PAT-TEST0001/payment-validity?doctorIds=doc-2')
        .set(bearer(token));

      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe('DIFFERENT_DOCTOR');
      expect(res.body.data.paymentRequired).toBe(true);
      expect(res.body.data.latestPaymentId).toBeNull();
    });

    test('200 — EXPIRED when the same doctor is requested but the validity window has passed', async () => {
      const tenant = await seedTenant();
      const tid    = tenant._id.toString();
      await seedPatient(tid);
      await seedVisit(tid, { visitId: 'OPD-DOC1', doctorIds: ['doc-1'] });
      await seedOpdPayment(tid, { visitId: 'OPD-DOC1', createdAt: daysAgo(20) });
      const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
      const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

      const res = await request(app)
        .get('/api/opd/patients/PAT-TEST0001/payment-validity?doctorIds=doc-1')
        .set(bearer(token));

      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe('EXPIRED');
      expect(res.body.data.paymentRequired).toBe(true);
    });

    test('200 — NO_PAYMENT when doctorIds is given but the patient has never paid at all', async () => {
      const tenant = await seedTenant();
      const tid    = tenant._id.toString();
      await seedPatient(tid);
      const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
      const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

      const res = await request(app)
        .get('/api/opd/patients/PAT-TEST0001/payment-validity?doctorIds=doc-1')
        .set(bearer(token));

      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe('NO_PAYMENT');
    });

    test('200 — a visit covering an additional doctor beyond the ones requested still counts (superset match)', async () => {
      const tenant = await seedTenant();
      const tid    = tenant._id.toString();
      await seedPatient(tid);
      await seedVisit(tid, { visitId: 'OPD-DOC1', doctorIds: ['doc-1', 'doc-2'] });
      await seedOpdPayment(tid, { visitId: 'OPD-DOC1', createdAt: daysAgo(2) });
      const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
      const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

      const res = await request(app)
        .get('/api/opd/patients/PAT-TEST0001/payment-validity?doctorIds=doc-1')
        .set(bearer(token));

      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe('VALID');
    });

    test('200 — requesting multiple doctors requires the visit to include every one of them', async () => {
      const tenant = await seedTenant();
      const tid    = tenant._id.toString();
      await seedPatient(tid);
      await seedVisit(tid, { visitId: 'OPD-DOC1', doctorIds: ['doc-1'] }); // only doc-1, not doc-2
      await seedOpdPayment(tid, { visitId: 'OPD-DOC1', createdAt: daysAgo(2) });
      const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
      const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

      const res = await request(app)
        .get('/api/opd/patients/PAT-TEST0001/payment-validity?doctorIds=doc-1,doc-2')
        .set(bearer(token));

      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe('DIFFERENT_DOCTOR');
    });

    test('200 — no doctorIds param falls back to the patient-wide check (pre-doctor-selection UI state)', async () => {
      const tenant = await seedTenant();
      const tid    = tenant._id.toString();
      await seedPatient(tid);
      await seedVisit(tid, { visitId: 'OPD-DOC1', doctorIds: ['doc-1'] });
      await seedOpdPayment(tid, { visitId: 'OPD-DOC1', createdAt: daysAgo(2) });
      const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
      const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

      const res = await request(app)
        .get('/api/opd/patients/PAT-TEST0001/payment-validity')
        .set(bearer(token));

      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe('VALID');
    });
  });
});

// ─── PATCH /api/opd/visits/:visitId/start ─────────────────────────────────────
// OPEN → IN_PROGRESS. Before this existed, IN_PROGRESS was declared in the enum
// but never written by anything, so every visit sat at OPEN until completion.
describe('PATCH /api/opd/visits/:visitId/start', () => {
  // HOSPITAL_ADMIN is used for the state-machine cases: a DOCTOR's requests are
  // scoped to their own patients, so an unassigned doctor gets a masking 404
  // rather than the status conflict these tests are asserting on.
  test('200 — moves an OPEN visit to IN_PROGRESS', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-START001', status: OPDVisitStatus.OPEN });
    const ha    = await seedUser(tid, 'ha@h.com', UserRole.HOSPITAL_ADMIN);
    const token = tokenFor(ha._id.toString(), tid, UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-START001/start')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(OPDVisitStatus.IN_PROGRESS);

    const stored = await OPDVisitModel.findOne({ tenantId: tid, visitId: 'OPD-START001' });
    expect(stored!.status).toBe(OPDVisitStatus.IN_PROGRESS);
  });

  test('200 — the assigned Doctor can start their own visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doc    = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    await seedVisit(tid, {
      visitId:   'OPD-START005',
      status:    OPDVisitStatus.OPEN,
      doctorIds: [doc._id.toString()],
    });
    const token = tokenFor(doc._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-START005/start')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(OPDVisitStatus.IN_PROGRESS);
  });

  test('409 — starting an already IN_PROGRESS visit is rejected', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-START002', status: OPDVisitStatus.IN_PROGRESS });
    const ha    = await seedUser(tid, 'ha@h.com', UserRole.HOSPITAL_ADMIN);
    const token = tokenFor(ha._id.toString(), tid, UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-START002/start')
      .set(bearer(token));

    expect(res.status).toBe(409);
  });

  test('409 — cannot start a COMPLETED visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-START003', status: OPDVisitStatus.COMPLETED });
    const ha    = await seedUser(tid, 'ha@h.com', UserRole.HOSPITAL_ADMIN);
    const token = tokenFor(ha._id.toString(), tid, UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-START003/start')
      .set(bearer(token));

    expect(res.status).toBe(409);
  });

  test('403 — a Receptionist cannot start a consultation', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-START004', status: OPDVisitStatus.OPEN });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-START004/start')
      .set(bearer(token));

    expect(res.status).toBe(403);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).patch('/api/opd/visits/OPD-START001/start');
    expect(res.status).toBe(401);
  });
});

// ─── Stale-visit sweep ────────────────────────────────────────────────────────
// A visit left on the queue after its date has passed used to stay OPEN
// forever, so yesterday's queue rendered as if those patients were still
// waiting. Reading the queue now resolves them to NO_SHOW.
describe('stale OPD visits are swept to NO_SHOW', () => {
  async function seedVisitOn(tid: string, visitId: string, visitDate: Date, status: OPDVisitStatus) {
    return OPDVisitModel.create({
      visitId, tenantId: tid, patientId: 'PAT-TEST0001', doctorIds: [],
      visitDate, queueNumber: 1, status,
      diagnosis: null, prescription: null, notes: null,
    });
  }

  test("a previous day's OPEN visit becomes NO_SHOW when the queue is read", async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedVisitOn(tid, 'OPD-STALE001', daysAgo(3), OPDVisitStatus.OPEN);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    await request(app).get('/api/opd/visits').set(bearer(token)).expect(200);

    const stored = await OPDVisitModel.findOne({ tenantId: tid, visitId: 'OPD-STALE001' });
    expect(stored!.status).toBe(OPDVisitStatus.NO_SHOW);
  });

  test('an IN_PROGRESS visit from a previous day is also swept', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedVisitOn(tid, 'OPD-STALE002', daysAgo(1), OPDVisitStatus.IN_PROGRESS);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    await request(app).get('/api/opd/visits').set(bearer(token)).expect(200);

    const stored = await OPDVisitModel.findOne({ tenantId: tid, visitId: 'OPD-STALE002' });
    expect(stored!.status).toBe(OPDVisitStatus.NO_SHOW);
  });

  // The boundary case that matters: a server running in UTC must not expire the
  // current IST day's queue during the 18:30–24:00 UTC window.
  test("today's OPEN visit is left alone", async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedVisitOn(tid, 'OPD-FRESH001', new Date(), OPDVisitStatus.OPEN);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    await request(app).get('/api/opd/visits').set(bearer(token)).expect(200);

    const stored = await OPDVisitModel.findOne({ tenantId: tid, visitId: 'OPD-FRESH001' });
    expect(stored!.status).toBe(OPDVisitStatus.OPEN);
  });

  test('a past COMPLETED visit is not rewritten', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    await seedVisitOn(tid, 'OPD-DONE001', daysAgo(5), OPDVisitStatus.COMPLETED);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    await request(app).get('/api/opd/visits').set(bearer(token)).expect(200);

    const stored = await OPDVisitModel.findOne({ tenantId: tid, visitId: 'OPD-DONE001' });
    expect(stored!.status).toBe(OPDVisitStatus.COMPLETED);
  });

  test('the sweep does not cross tenants', async () => {
    const a = await seedTenant('Hospital A');
    const b = await seedTenant('Hospital B');
    const aid = a._id.toString();
    const bid = b._id.toString();
    await seedPatient(aid);
    await seedVisitOn(bid, 'OPD-OTHER001', daysAgo(3), OPDVisitStatus.OPEN);
    const rc    = await seedUser(aid, 'rc@a.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), aid, UserRole.RECEPTIONIST);

    await request(app).get('/api/opd/visits').set(bearer(token)).expect(200);

    const other = await OPDVisitModel.findOne({ tenantId: bid, visitId: 'OPD-OTHER001' });
    expect(other!.status).toBe(OPDVisitStatus.OPEN);
  });
});
