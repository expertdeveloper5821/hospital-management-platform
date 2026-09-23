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
import { OpdNurseAssignmentModel } from '../../../src/modules/opd/opd-nurse-assignment.model';
import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
import { WardModel }         from '../../../src/modules/ipd/ward.model';
import { PaymentModel }      from '../../../src/modules/payment/payment.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { OPDVisitStatus }         from '../../../src/modules/opd/opd.types';
import { Gender }                 from '../../../src/modules/patient/patient.types';
import { PaymentMethod, PaymentStatus, PaymentReferenceType } from '../../../src/modules/payment/payment.types';
import { toIstMidnight, toIstDateKey } from '../../../src/modules/attendance/attendance.timezone';

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
  nurseIds:  string[];
}> = {}) {
  return OPDVisitModel.create({
    visitId:        overrides.visitId   ?? 'OPD-TEST0001',
    tenantId,
    patientId:      overrides.patientId ?? 'PAT-TEST0001',
    doctorIds:      overrides.doctorIds ?? [],
    nurseIds:       overrides.nurseIds  ?? [],
    visitDate:      new Date('2026-05-15T00:00:00.000Z'),
    queueNumber:    1,
    status:         overrides.status    ?? OPDVisitStatus.OPEN,
    diagnosis:      null,
    prescription:   null,
    notes:          null,
  });
}

// IST calendar date — matches how the backend now resolves "today" for
// past-date validation (toIstMidnight), so this fixture can't drift a day
// behind/ahead depending on when in UTC the suite happens to run.
function todayDateStr(): string {
  return toIstDateKey(new Date());
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

  test('Idempotency-Key replay: retrying the same create does not create a second visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);
    const idempotencyKey = 'temp-client-op-opd-001';

    const first = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .set('Idempotency-Key', idempotencyKey)
      .send(VALID_VISIT_BODY);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .set('Idempotency-Key', idempotencyKey)
      .send(VALID_VISIT_BODY);

    // Replayed, not re-executed — same stored response, same visitId/queueNumber.
    expect(second.status).toBe(201);
    expect(second.body.data.visitId).toBe(first.body.data.visitId);
    expect(second.body.data.queueNumber).toBe(first.body.data.queueNumber);

    const count = await OPDVisitModel.countDocuments({ tenantId: tid });
    expect(count).toBe(1);
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
    const expectedDate = toIstMidnight(new Date('2020-01-01'));
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

  // ─── Department resolution (revenue mapping fix) ───────────────────────────
  test('201 — visit departmentId is resolved from the assigned doctor, not the patient', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);
    const doctor = await UserModel.create({
      tenantId: tid, email: 'cardio-doc@h.com', name: 'Dr. Cardio', passwordHash: 'x',
      role: UserRole.DOCTOR, isActive: true, isFirstLogin: false, departmentIds: ['dept-cardio'],
    });

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send({ ...VALID_VISIT_BODY, doctorIds: [doctor._id.toString()] });

    expect(res.status).toBe(201);
    expect(res.body.data.departmentId).toBe('dept-cardio');

    const stored = await OPDVisitModel.findOne({ visitId: res.body.data.visitId });
    expect(stored?.departmentId).toBe('dept-cardio');
  });

  test('201 — visit departmentId is null when no doctor is assigned, even if the patient has a legacy departmentId', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await PatientModel.create({
      patientId: 'PAT-TEST0001', tenantId: tid, fullName: 'Ravi Kumar',
      dateOfBirth: new Date('1990-05-15'), gender: Gender.MALE, mobileNumber: '9876543210',
      address: '12 MG Road, Bengaluru', departmentId: 'dept-stale', // legacy field — must not be used
    });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .post('/api/opd/visits')
      .set(bearer(token))
      .send(VALID_VISIT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.departmentId).toBeNull();
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

  // ─── Nurse (view-only, except notes-only edit on a visit she's assigned
  // to via nurseIds — see the dedicated "Nurse notes-only edit" describe
  // below for that carve-out) ──────────────────────────────────────────────

  test('404 — a nurse with only ward-based view access (not personally assigned via nurseIds) cannot update even notes', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse-upd@h.com', UserRole.NURSE);
    const wardA  = await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse._id.toString()] });

    await seedPatient(tid, 'PAT-NMUT0001');
    await admitToWard(tid, 'PAT-NMUT0001', wardA._id.toString(), 'ADM-NMUT-A1');
    // No nurseIds on this visit — the nurse can see it (ward-based), but is
    // not personally assigned to it, so edit access must still be refused.
    await seedVisit(tid, { visitId: 'OPD-NMUT0001', patientId: 'PAT-NMUT0001' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-NMUT0001')
      .set(bearer(token))
      .send({ notes: 'Should be blocked' });

    expect(res.status).toBe(404);
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

  // ─── Department re-resolution on doctor change (revenue mapping fix) ──────
  test('200 — reassigning to a doctor in a different department updates departmentId', async () => {
    const tenant  = await seedTenant();
    const tid     = tenant._id.toString();
    const cardioDoc = await UserModel.create({
      tenantId: tid, email: 'cardio@h.com', name: 'Dr. Cardio', passwordHash: 'x',
      role: UserRole.DOCTOR, isActive: true, isFirstLogin: false, departmentIds: ['dept-cardio'],
    });
    const orthoDoc = await UserModel.create({
      tenantId: tid, email: 'ortho@h.com', name: 'Dr. Ortho', passwordHash: 'x',
      role: UserRole.DOCTOR, isActive: true, isFirstLogin: false, departmentIds: ['dept-ortho'],
    });
    await OPDVisitModel.create({
      visitId: 'OPD-REDEPT01', tenantId: tid, patientId: 'PAT-TEST0001',
      doctorIds: [cardioDoc._id.toString()], departmentId: 'dept-cardio',
      visitDate: new Date('2026-05-15T00:00:00.000Z'), queueNumber: 1, status: OPDVisitStatus.OPEN,
    });
    const token = tokenFor(cardioDoc._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-REDEPT01')
      .set(bearer(token))
      .send({ doctorIds: [orthoDoc._id.toString()] });

    expect(res.status).toBe(200);
    expect(res.body.data.departmentId).toBe('dept-ortho');

    const stored = await OPDVisitModel.findOne({ visitId: 'OPD-REDEPT01' });
    expect(stored?.departmentId).toBe('dept-ortho');
  });

  test('200 — clearing all assigned doctors clears departmentId to null', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const cardioDoc = await UserModel.create({
      tenantId: tid, email: 'cardio2@h.com', name: 'Dr. Cardio', passwordHash: 'x',
      role: UserRole.DOCTOR, isActive: true, isFirstLogin: false, departmentIds: ['dept-cardio'],
    });
    await OPDVisitModel.create({
      visitId: 'OPD-REDEPT02', tenantId: tid, patientId: 'PAT-TEST0001',
      doctorIds: [cardioDoc._id.toString()], departmentId: 'dept-cardio',
      visitDate: new Date('2026-05-15T00:00:00.000Z'), queueNumber: 1, status: OPDVisitStatus.OPEN,
    });
    const token = tokenFor(cardioDoc._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-REDEPT02')
      .set(bearer(token))
      .send({ doctorIds: [] });

    expect(res.status).toBe(200);
    expect(res.body.data.departmentId).toBeNull();
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
    const expectedDate = toIstMidnight(new Date('2020-01-01'));
    expect(new Date(res.body.data.visitDate).getTime()).toBe(expectedDate.getTime());
  });
});

// ─── OPD Vitals (PATCH /api/opd/visits/:visitId) ──────────────────────────────
describe('OPD Vitals', () => {
  const VITALS = {
    weight: 68.5, height: 172, bloodPressure: '120/80', sugar: 95, bodyTemperature: 98.6,
  };

  test('200 — a fresh visit reports the default (all-null) vitals shape', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-vit1@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-VIT00001', doctorIds: [doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app).get('/api/opd/visits/OPD-VIT00001').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.vitals).toEqual({
      weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null,
    });
  });

  test('200 — Doctor records vitals, persisted and returned on a subsequent GET', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-vit2@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-VIT00002', doctorIds: [doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const patchRes = await request(app)
      .patch('/api/opd/visits/OPD-VIT00002')
      .set(bearer(token))
      .send({ vitals: VITALS });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.vitals).toEqual(VITALS);

    const getRes = await request(app).get('/api/opd/visits/OPD-VIT00002').set(bearer(token));
    expect(getRes.body.data.vitals).toEqual(VITALS);

    const stored = await OPDVisitModel.findOne({ visitId: 'OPD-VIT00002' });
    expect(stored?.vitals?.weight).toBe(68.5);
    expect(stored?.vitals?.bloodPressure).toBe('120/80');
  });

  test('200 — Hospital Admin can record vitals', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-VIT00003' });
    const admin = await seedUser(tid, 'admin-vit@h.com', UserRole.HOSPITAL_ADMIN);
    const token = tokenFor(admin._id.toString(), tid, UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-VIT00003')
      .set(bearer(token))
      .send({ vitals: { sugar: 110 } });

    expect(res.status).toBe(200);
    expect(res.body.data.vitals.sugar).toBe(110);
  });

  test('200 — an assigned Nurse can record vitals (not just notes)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse-vit@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-VIT00004', nurseIds: [nurse._id.toString()] });
    const token  = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-VIT00004')
      .set(bearer(token))
      .send({ vitals: { weight: 70, bodyTemperature: 99.1 } });

    expect(res.status).toBe(200);
    expect(res.body.data.vitals.weight).toBe(70);
    expect(res.body.data.vitals.bodyTemperature).toBe(99.1);
  });

  test("403 — a Nurse sending vitals alongside diagnosis is rejected (vitals doesn't open the door to other fields)", async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse-vit2@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-VIT00005', nurseIds: [nurse._id.toString()] });
    const token  = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-VIT00005')
      .set(bearer(token))
      .send({ vitals: { weight: 70 }, diagnosis: 'Viral fever' });

    expect(res.status).toBe(403);
  });

  test('403 — Receptionist cannot update vitals (route-level role gate)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-VIT00006' });
    const rc    = await seedUser(tid, 'rc-vit@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-VIT00006')
      .set(bearer(token))
      .send({ vitals: { weight: 70 } });

    expect(res.status).toBe(403);
  });

  test('403 — Manager cannot update vitals (route-level role gate)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedVisit(tid, { visitId: 'OPD-VIT00007' });
    const manager = await seedUser(tid, 'mgr-vit@h.com', UserRole.MANAGER);
    const token   = tokenFor(manager._id.toString(), tid, UserRole.MANAGER);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-VIT00007')
      .set(bearer(token))
      .send({ vitals: { weight: 70 } });

    expect(res.status).toBe(403);
  });

  test('200 — recording one vital field merges onto (never wipes) previously saved ones', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-vit3@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-VIT00008', doctorIds: [doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    await request(app)
      .patch('/api/opd/visits/OPD-VIT00008')
      .set(bearer(token))
      .send({ vitals: VITALS });

    const res = await request(app)
      .patch('/api/opd/visits/OPD-VIT00008')
      .set(bearer(token))
      .send({ vitals: { weight: 71.2 } });

    expect(res.status).toBe(200);
    expect(res.body.data.vitals).toEqual({ ...VITALS, weight: 71.2 });
  });

  test('200 — explicitly sending null for one vital clears only that field', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-vit4@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-VIT00009', doctorIds: [doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    await request(app)
      .patch('/api/opd/visits/OPD-VIT00009')
      .set(bearer(token))
      .send({ vitals: VITALS });

    const res = await request(app)
      .patch('/api/opd/visits/OPD-VIT00009')
      .set(bearer(token))
      .send({ vitals: { bloodPressure: null } });

    expect(res.status).toBe(200);
    expect(res.body.data.vitals).toEqual({ ...VITALS, bloodPressure: null });
  });

  test.each([
    ['weight too low', { weight: 0.1 }],
    ['weight too high', { weight: 5000 }],
    ['height too low', { height: 5 }],
    ['height too high', { height: 400 }],
    ['sugar too low', { sugar: 1 }],
    ['sugar too high', { sugar: 5000 }],
    ['body temperature too low', { bodyTemperature: 10 }],
    ['body temperature too high', { bodyTemperature: 200 }],
    ['blood pressure missing the slash', { bloodPressure: '12080' }],
    ['blood pressure non-numeric', { bloodPressure: 'high/low' }],
  ])('400 — rejects an out-of-range/malformed vital: %s', async (_label, badVitals) => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-vit5@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-VIT00010', doctorIds: [doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-VIT00010')
      .set(bearer(token))
      .send({ vitals: badVitals });

    expect(res.status).toBe(400);
  });

  test('200 — a valid blood pressure with 3-digit systolic is accepted', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc-vit6@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-VIT00011', doctorIds: [doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-VIT00011')
      .set(bearer(token))
      .send({ vitals: { bloodPressure: '180/110' } });

    expect(res.status).toBe(200);
    expect(res.body.data.vitals.bloodPressure).toBe('180/110');
  });

  test('200 — vitals are included in patient OPD history', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc-vit7@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-VIT00012', doctorIds: [doctor._id.toString()] });
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    await request(app)
      .patch('/api/opd/visits/OPD-VIT00012')
      .set(bearer(token))
      .send({ vitals: VITALS });

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/history')
      .set(bearer(token));

    expect(res.status).toBe(200);
    const visit = res.body.data.data.find((v: { visitId: string }) => v.visitId === 'OPD-VIT00012');
    expect(visit.vitals).toEqual(VITALS);
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

// ─── Assign Nurse (OPD New Visit) ──────────────────────────────────────────────
describe('Assign Nurse — GET /api/opd/nurses/available', () => {
  test('200 — lists active nurses, excluding anyone on an IPD ward roster', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurseFree = await seedUser(tid, 'nurse-free@h.com', UserRole.NURSE);
    const nurseWard = await seedUser(tid, 'nurse-ward@h.com', UserRole.NURSE);
    await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurseWard._id.toString()] });

    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app).get('/api/opd/nurses/available').set(bearer(token));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((n: { userId: string }) => n.userId);
    expect(ids).toContain(nurseFree._id.toString());
    expect(ids).not.toContain(nurseWard._id.toString());
  });

  test('200 — excludes inactive nurses', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const inactiveNurse = await UserModel.create({
      tenantId: tid, email: 'inactive-nurse@h.com', name: 'Inactive Nurse', passwordHash: 'x',
      role: UserRole.NURSE, isActive: false, isFirstLogin: false,
    });
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app).get('/api/opd/nurses/available').set(bearer(token));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((n: { userId: string }) => n.userId);
    expect(ids).not.toContain(inactiveNurse._id.toString());
  });

  test('tenant isolation — a nurse from another tenant never appears', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');
    await seedUser(tenantB._id.toString(), 'nurse-b@h.com', UserRole.NURSE);
    const rcA   = await seedUser(tenantA._id.toString(), 'rc@a.com', UserRole.RECEPTIONIST);
    const tokA  = tokenFor(rcA._id.toString(), tenantA._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app).get('/api/opd/nurses/available').set(bearer(tokA));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('403 — a role outside the visit-creation set (e.g. Doctor) cannot list available nurses', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app).get('/api/opd/nurses/available').set(bearer(token));

    expect(res.status).toBe(403);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/opd/nurses/available');
    expect(res.status).toBe(401);
  });
});

describe('Assign Nurse — GET /api/opd/doctors/:doctorId/nurse-assignment', () => {
  test('200 — an empty nurses list when the doctor has no existing OPD nurse mapping', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app)
      .get(`/api/opd/doctors/${doctor._id.toString()}/nurse-assignment`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ doctorId: doctor._id.toString(), nurses: [] });
  });

  test('200 — surfaces every nurse mapped from a prior visit, and flags unavailability once one moves to an IPD ward', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const nurse1 = await seedUser(tid, 'nurse1@h.com', UserRole.NURSE);
    const nurse2 = await seedUser(tid, 'nurse2@h.com', UserRole.NURSE);
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    await request(app).post('/api/opd/visits').set(bearer(token)).send({
      ...VALID_VISIT_BODY, doctorIds: [doctor._id.toString()], nurseIds: [nurse1._id.toString(), nurse2._id.toString()],
    }).expect(201);

    const before = await request(app)
      .get(`/api/opd/doctors/${doctor._id.toString()}/nurse-assignment`)
      .set(bearer(token));
    expect(before.status).toBe(200);
    expect(before.body.data.nurses).toHaveLength(2);
    expect(before.body.data.nurses.every((n: { isAvailable: boolean }) => n.isAvailable)).toBe(true);

    // nurse1 is picked up for IPD ward duty after the mapping was created.
    await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse1._id.toString()] });

    const after = await request(app)
      .get(`/api/opd/doctors/${doctor._id.toString()}/nurse-assignment`)
      .set(bearer(token));
    expect(after.status).toBe(200);
    const byId = new Map(after.body.data.nurses.map((n: { nurseId: string; isAvailable: boolean }) => [n.nurseId, n.isAvailable]));
    expect(byId.get(nurse1._id.toString())).toBe(false); // still surfaced, flagged unavailable
    expect(byId.get(nurse2._id.toString())).toBe(true);
  });

  test('403 — a role outside the visit-creation set cannot look up a doctor-nurse assignment', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .get(`/api/opd/doctors/${doctor._id.toString()}/nurse-assignment`)
      .set(bearer(token));

    expect(res.status).toBe(403);
  });
});

describe('Assign Nurse — POST /api/opd/visits with nurseIds', () => {
  test('201 — persists all nurseIds on the visit and adds each to the doctor→nurse mapping', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const nurse1 = await seedUser(tid, 'nurse1@h.com', UserRole.NURSE);
    const nurse2 = await seedUser(tid, 'nurse2@h.com', UserRole.NURSE);
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app).post('/api/opd/visits').set(bearer(token)).send({
      ...VALID_VISIT_BODY, doctorIds: [doctor._id.toString()], nurseIds: [nurse1._id.toString(), nurse2._id.toString()],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.nurseIds).toEqual(
      expect.arrayContaining([nurse1._id.toString(), nurse2._id.toString()]),
    );
    expect(res.body.data.nurseIds).toHaveLength(2);

    const mappings = await OpdNurseAssignmentModel.find({ tenantId: tid, doctorId: doctor._id.toString() });
    expect(mappings.map((m) => m.nurseId).sort()).toEqual(
      [nurse1._id.toString(), nurse2._id.toString()].sort(),
    );
  });

  test('201 — omitting nurseIds creates the visit successfully with no nurses assigned', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app).post('/api/opd/visits').set(bearer(token)).send(VALID_VISIT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.nurseIds).toEqual([]);
  });

  test('409 — a nurse currently assigned to an IPD ward cannot be assigned to a new OPD visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const nurse  = await seedUser(tid, 'nurse@h.com', UserRole.NURSE);
    await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse._id.toString()] });
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app).post('/api/opd/visits').set(bearer(token)).send({
      ...VALID_VISIT_BODY, doctorIds: [doctor._id.toString()], nurseIds: [nurse._id.toString()],
    });

    expect(res.status).toBe(409);
    const count = await OPDVisitModel.countDocuments({ tenantId: tid });
    expect(count).toBe(0);
  });

  test('409 — the whole request is rejected when one of several nurses is on an IPD ward', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor    = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const okNurse    = await seedUser(tid, 'nurse-ok@h.com', UserRole.NURSE);
    const wardNurse  = await seedUser(tid, 'nurse-ward@h.com', UserRole.NURSE);
    await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [wardNurse._id.toString()] });
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    const res = await request(app).post('/api/opd/visits').set(bearer(token)).send({
      ...VALID_VISIT_BODY, doctorIds: [doctor._id.toString()], nurseIds: [okNurse._id.toString(), wardNurse._id.toString()],
    });

    expect(res.status).toBe(409);
    const count = await OPDVisitModel.countDocuments({ tenantId: tid });
    expect(count).toBe(0);
  });

  test('400 — a nurseId that does not belong to this tenant is rejected', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');
    await seedPatient(tenantA._id.toString());
    const foreignNurse = await seedUser(tenantB._id.toString(), 'nurse-b@h.com', UserRole.NURSE);
    const rcA    = await seedUser(tenantA._id.toString(), 'rc@a.com', UserRole.RECEPTIONIST);
    const tokA   = tokenFor(rcA._id.toString(), tenantA._id.toString(), UserRole.RECEPTIONIST);

    const res = await request(app).post('/api/opd/visits').set(bearer(tokA)).send({
      ...VALID_VISIT_BODY, nurseIds: [foreignNurse._id.toString()],
    });

    expect(res.status).toBe(400);
  });

  test('a second visit assigning an additional nurse to the same doctor grows the mapping without a duplicate row', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-A000001');
    await seedPatient(tid, 'PAT-A000002');
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const nurse1 = await seedUser(tid, 'nurse1@h.com', UserRole.NURSE);
    const nurse2 = await seedUser(tid, 'nurse2@h.com', UserRole.NURSE);
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    await request(app).post('/api/opd/visits').set(bearer(token)).send({
      ...VALID_VISIT_BODY, patientId: 'PAT-A000001', doctorIds: [doctor._id.toString()], nurseIds: [nurse1._id.toString()],
    }).expect(201);

    await request(app).post('/api/opd/visits').set(bearer(token)).send({
      ...VALID_VISIT_BODY, patientId: 'PAT-A000002', doctorIds: [doctor._id.toString()], nurseIds: [nurse2._id.toString()],
    }).expect(201);

    const mappings = await OpdNurseAssignmentModel.find({ tenantId: tid, doctorId: doctor._id.toString() });
    expect(mappings.map((m) => m.nurseId).sort()).toEqual(
      [nurse1._id.toString(), nurse2._id.toString()].sort(),
    );
  });

  test('re-submitting the same nurse for the same doctor does not create a duplicate mapping row', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-B000001');
    await seedPatient(tid, 'PAT-B000002');
    const doctor = await seedUser(tid, 'doc@h.com', UserRole.DOCTOR);
    const nurse  = await seedUser(tid, 'nurse@h.com', UserRole.NURSE);
    const rc     = await seedUser(tid, 'rc@h.com', UserRole.RECEPTIONIST);
    const token  = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    await request(app).post('/api/opd/visits').set(bearer(token)).send({
      ...VALID_VISIT_BODY, patientId: 'PAT-B000001', doctorIds: [doctor._id.toString()], nurseIds: [nurse._id.toString()],
    }).expect(201);

    await request(app).post('/api/opd/visits').set(bearer(token)).send({
      ...VALID_VISIT_BODY, patientId: 'PAT-B000002', doctorIds: [doctor._id.toString()], nurseIds: [nurse._id.toString()],
    }).expect(201);

    const mappings = await OpdNurseAssignmentModel.find({ tenantId: tid, doctorId: doctor._id.toString(), nurseId: nurse._id.toString() });
    expect(mappings).toHaveLength(1);
  });
});

// ─── Nurse OPD visibility (RBAC — server-side, not just frontend filtering) ────
describe('Nurse OPD visibility — direct visit assignment (multi-nurse)', () => {
  test('200 — a nurse with no ward assignment still sees an OPD visit they are directly assigned to', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-DN00001');
    const nurse  = await seedUser(tid, 'nurse-direct@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-DN00001', patientId: 'PAT-DN00001' });
    await OPDVisitModel.updateOne({ visitId: 'OPD-DN00001' }, { $set: { nurseIds: [nurse._id.toString()] } });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);

    const queueRes = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));
    expect(queueRes.status).toBe(200);
    expect(queueRes.body.data.map((v: { visitId: string }) => v.visitId)).toContain('OPD-DN00001');

    const directRes = await request(app).get('/api/opd/visits/OPD-DN00001').set(bearer(token));
    expect(directRes.status).toBe(200);
  });

  test('404 — a nurse not assigned to a visit (and with no ward covering its patient) cannot fetch it directly', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-DN00002');
    const nurse  = await seedUser(tid, 'nurse-unrelated@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-DN00002', patientId: 'PAT-DN00002' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app).get('/api/opd/visits/OPD-DN00002').set(bearer(token));

    expect(res.status).toBe(404);
  });

  test('200 — a nurse sees visits from both their ward and a direct assignment outside it, unioned without duplicates', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    const nurse  = await seedUser(tid, 'nurse-both@h.com', UserRole.NURSE);
    const ward   = await WardModel.create({ name: 'Ward A', tenantId: tid, assignedNurseIds: [nurse._id.toString()] });

    await seedPatient(tid, 'PAT-DN00003'); // ward patient
    await IPDAdmissionModel.create({
      admissionId: 'ADM-DN-003', patientId: 'PAT-DN00003', wardId: ward._id.toString(), wardName: 'Ward A',
      bedId: 'bed-dn3', bedNumber: 'B-01', assignedDoctorIds: [], status: 'ADMITTED',
      admissionDate: new Date(), dischargeDate: null, progressNotes: [], tenantId: tid,
    });
    await seedVisit(tid, { visitId: 'OPD-DN00003', patientId: 'PAT-DN00003' });

    await seedPatient(tid, 'PAT-DN00004'); // not in the nurse's ward at all
    await seedVisit(tid, { visitId: 'OPD-DN00004', patientId: 'PAT-DN00004' });
    await OPDVisitModel.updateOne({ visitId: 'OPD-DN00004' }, { $set: { nurseIds: [nurse._id.toString()] } });

    await seedPatient(tid, 'PAT-DN00005'); // neither ward nor direct assignment
    await seedVisit(tid, { visitId: 'OPD-DN00005', patientId: 'PAT-DN00005' });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    const visitIds = res.body.data.map((v: { visitId: string }) => v.visitId);
    expect(visitIds).toEqual(expect.arrayContaining(['OPD-DN00003', 'OPD-DN00004']));
    expect(visitIds).not.toContain('OPD-DN00005');
    expect(res.body.data).toHaveLength(2);
  });

  // Patient history is a bulk, patient-level list (every OPD visit for that
  // patient), not a single OPD visit — unlike the queue/direct-fetch/mutation
  // endpoints above, it stays ward-scoped only for a Nurse. A direct
  // assignment to one visit deliberately does NOT unlock it: doing so would
  // let one assigned visit expose that patient's *other* visits too, the
  // same patientId-based leak the direct-assignment fix elsewhere closes.
  test('404 — patient history stays ward-scoped only; a direct visit assignment alone does not unlock it', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-DN00006');
    const nurse  = await seedUser(tid, 'nurse-hist@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-DN00006', patientId: 'PAT-DN00006' });
    await OPDVisitModel.updateOne({ visitId: 'OPD-DN00006' }, { $set: { nurseIds: [nurse._id.toString()] } });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app).get('/api/opd/patients/PAT-DN00006/history').set(bearer(token));

    expect(res.status).toBe(404);
  });

  // A nurse directly assigned via nurseIds may edit *only* the notes field —
  // see the dedicated "Nurse notes-only edit" describe block below for the
  // full behavior (success, field restriction, and the not-assigned case).
  test('200 — a nurse assigned via a visit can update its notes', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-DN00007');
    const nurse  = await seedUser(tid, 'nurse-mut@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-DN00007', patientId: 'PAT-DN00007' });
    await OPDVisitModel.updateOne({ visitId: 'OPD-DN00007' }, { $set: { nurseIds: [nurse._id.toString()] } });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-DN00007')
      .set(bearer(token))
      .send({ notes: 'Patient stable, vitals checked.' });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Patient stable, vitals checked.');
  });
});

// ─── Nurse OPD visibility — visit-level scoping fix ────────────────────────────
// A nurse's direct OPD assignment must be evaluated per-visit (this visit's
// own nurseIds), never derived from "patients this nurse has touched via any
// other OPD visit" — the patientId-based leak this suite guards against.
describe('Nurse OPD visibility — visit-level scoping (no patientId-based leak)', () => {
  test('200 — multiple assigned nurses (nurseIds = [A, B]) both see the same OPD visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-VS00001');
    const nurseA = await seedUser(tid, 'nurse-vs-a@h.com', UserRole.NURSE);
    const nurseB = await seedUser(tid, 'nurse-vs-b@h.com', UserRole.NURSE);
    await seedVisit(tid, {
      visitId: 'OPD-VS00001', patientId: 'PAT-VS00001',
      nurseIds: [nurseA._id.toString(), nurseB._id.toString()],
    });

    for (const nurse of [nurseA, nurseB]) {
      const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);

      const queueRes = await request(app)
        .get('/api/opd/visits').query({ date: '2026-05-15' }).set(bearer(token));
      expect(queueRes.body.data.map((v: { visitId: string }) => v.visitId)).toContain('OPD-VS00001');

      const directRes = await request(app).get('/api/opd/visits/OPD-VS00001').set(bearer(token));
      expect(directRes.status).toBe(200);
    }
  });

  test('a nurse assigned to another OPD visit of the SAME patient does not see this one, in the queue', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-VS00002');
    const nurseA = await seedUser(tid, 'nurse-vs2-a@h.com', UserRole.NURSE); // assigned to visit 1 only
    const nurseB = await seedUser(tid, 'nurse-vs2-b@h.com', UserRole.NURSE); // assigned to visit 2 only

    // Two visits for the SAME patient, each with a different nurse.
    await seedVisit(tid, { visitId: 'OPD-VS00002A', patientId: 'PAT-VS00002', nurseIds: [nurseA._id.toString()] });
    await seedVisit(tid, { visitId: 'OPD-VS00002B', patientId: 'PAT-VS00002', nurseIds: [nurseB._id.toString()] });

    const tokenA = tokenFor(nurseA._id.toString(), tid, UserRole.NURSE);
    const res    = await request(app)
      .get('/api/opd/visits').query({ date: '2026-05-15' }).set(bearer(tokenA));

    const visitIds = res.body.data.map((v: { visitId: string }) => v.visitId);
    expect(visitIds).toContain('OPD-VS00002A');
    expect(visitIds).not.toContain('OPD-VS00002B'); // nurseA is NOT on this one
  });

  test('404 — a nurse assigned to another OPD visit of the SAME patient cannot fetch this one directly', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-VS00003');
    const nurseA = await seedUser(tid, 'nurse-vs3-a@h.com', UserRole.NURSE);
    const nurseB = await seedUser(tid, 'nurse-vs3-b@h.com', UserRole.NURSE);

    await seedVisit(tid, { visitId: 'OPD-VS00003A', patientId: 'PAT-VS00003', nurseIds: [nurseA._id.toString()] });
    await seedVisit(tid, { visitId: 'OPD-VS00003B', patientId: 'PAT-VS00003', nurseIds: [nurseB._id.toString()] });

    const tokenA = tokenFor(nurseA._id.toString(), tid, UserRole.NURSE);
    const res    = await request(app).get('/api/opd/visits/OPD-VS00003B').set(bearer(tokenA));

    expect(res.status).toBe(404);
  });

  test('200/404 — an unassigned nurse (nurseIds = []) sees nothing directly, even for a patient she previously handled', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-VS00004');
    const nurse = await seedUser(tid, 'nurse-vs4@h.com', UserRole.NURSE);

    // Nurse previously handled this patient on a different (past) visit.
    await seedVisit(tid, { visitId: 'OPD-VS00004A', patientId: 'PAT-VS00004', nurseIds: [nurse._id.toString()] });
    // Today's visit for the same patient has NO nurses assigned.
    await seedVisit(tid, { visitId: 'OPD-VS00004B', patientId: 'PAT-VS00004', nurseIds: [] });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);

    const queueRes = await request(app)
      .get('/api/opd/visits').query({ date: '2026-05-15' }).set(bearer(token));
    const visitIds = queueRes.body.data.map((v: { visitId: string }) => v.visitId);
    expect(visitIds).toContain('OPD-VS00004A');     // still sees the one she IS on
    expect(visitIds).not.toContain('OPD-VS00004B'); // not the unassigned one, despite shared history

    const directRes = await request(app).get('/api/opd/visits/OPD-VS00004B').set(bearer(token));
    expect(directRes.status).toBe(404);
  });

  test('200 — a totally unassigned, ward-less nurse sees an empty queue for a visit with no nurses at all', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-VS00005');
    const nurse = await seedUser(tid, 'nurse-vs5@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-VS00005', patientId: 'PAT-VS00005', nurseIds: [] });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .get('/api/opd/visits').query({ date: '2026-05-15' }).set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('200 — a nurse directly assigned to the visit can start the consultation', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-VS00006');
    const nurse = await seedUser(tid, 'nurse-vs6@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-VS00006', patientId: 'PAT-VS00006', nurseIds: [nurse._id.toString()] });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app).patch('/api/opd/visits/OPD-VS00006/start').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(OPDVisitStatus.IN_PROGRESS);
  });

  test('404 — a nurse NOT assigned to the visit cannot start it, even for a patient she handled on another visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-VS00007');
    const nurseA = await seedUser(tid, 'nurse-vs7-a@h.com', UserRole.NURSE);
    const nurseB = await seedUser(tid, 'nurse-vs7-b@h.com', UserRole.NURSE);

    await seedVisit(tid, { visitId: 'OPD-VS00007A', patientId: 'PAT-VS00007', nurseIds: [nurseA._id.toString()] });
    await seedVisit(tid, { visitId: 'OPD-VS00007B', patientId: 'PAT-VS00007', nurseIds: [nurseB._id.toString()] });

    const tokenA = tokenFor(nurseA._id.toString(), tid, UserRole.NURSE);
    const res    = await request(app).patch('/api/opd/visits/OPD-VS00007B/start').set(bearer(tokenA));

    expect(res.status).toBe(404);
    const stored = await OPDVisitModel.findOne({ visitId: 'OPD-VS00007B' });
    expect(stored?.status).toBe(OPDVisitStatus.OPEN); // untouched
  });

  test('404 — a nurse NOT assigned to the visit cannot update its notes, even for a patient she handled on another visit', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-VS00008');
    const nurseA = await seedUser(tid, 'nurse-vs8-a@h.com', UserRole.NURSE);
    const nurseB = await seedUser(tid, 'nurse-vs8-b@h.com', UserRole.NURSE);

    await seedVisit(tid, { visitId: 'OPD-VS00008A', patientId: 'PAT-VS00008', nurseIds: [nurseA._id.toString()] });
    await seedVisit(tid, { visitId: 'OPD-VS00008B', patientId: 'PAT-VS00008', nurseIds: [nurseB._id.toString()] });

    const tokenA = tokenFor(nurseA._id.toString(), tid, UserRole.NURSE);
    const res    = await request(app)
      .patch('/api/opd/visits/OPD-VS00008B')
      .set(bearer(tokenA))
      .send({ notes: 'Should be blocked' });

    expect(res.status).toBe(404);
    const stored = await OPDVisitModel.findOne({ visitId: 'OPD-VS00008B' });
    expect(stored?.notes).toBeNull();
  });

  test('200 — other roles (Receptionist) still see every visit for the patient, unaffected by the nurse-scoping fix', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-VS00009');
    const rc     = await seedUser(tid, 'rc-vs9@h.com', UserRole.RECEPTIONIST);
    const nurseA = await seedUser(tid, 'nurse-vs9-a@h.com', UserRole.NURSE);

    await seedVisit(tid, { visitId: 'OPD-VS00009A', patientId: 'PAT-VS00009', nurseIds: [nurseA._id.toString()] });
    await seedVisit(tid, { visitId: 'OPD-VS00009B', patientId: 'PAT-VS00009', nurseIds: [] });

    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);
    const res   = await request(app)
      .get('/api/opd/visits').query({ date: '2026-05-15' }).set(bearer(token));

    const visitIds = res.body.data.map((v: { visitId: string }) => v.visitId);
    expect(visitIds).toEqual(expect.arrayContaining(['OPD-VS00009A', 'OPD-VS00009B']));
  });
});

// ─── Nurse notes-only edit (assigned nurse only) ───────────────────────────────
describe('Nurse notes-only edit', () => {
  test('200 — an assigned nurse can save notes, and only notes changes', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-NEDIT01');
    const doctor = await seedUser(tid, 'doc-nedit@h.com', UserRole.DOCTOR);
    const nurse  = await seedUser(tid, 'nurse-nedit@h.com', UserRole.NURSE);
    await seedVisit(tid, {
      visitId: 'OPD-NEDIT01', patientId: 'PAT-NEDIT01',
      doctorIds: [doctor._id.toString()], nurseIds: [nurse._id.toString()],
    });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-NEDIT01')
      .set(bearer(token))
      .send({ notes: 'Vitals stable at 10am round.' });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Vitals stable at 10am round.');
    // Nothing else moved — doctor/nurse assignment unaffected by her save.
    expect(res.body.data.doctorIds).toEqual([doctor._id.toString()]);
    expect(res.body.data.nurseIds).toEqual([nurse._id.toString()]);
  });

  test('403 — an assigned nurse cannot change doctorIds, even alongside a notes update', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-NEDIT02');
    const doctor      = await seedUser(tid, 'doc-nedit2@h.com', UserRole.DOCTOR);
    const otherDoctor = await seedUser(tid, 'doc-nedit3@h.com', UserRole.DOCTOR);
    const nurse       = await seedUser(tid, 'nurse-nedit2@h.com', UserRole.NURSE);
    await seedVisit(tid, {
      visitId: 'OPD-NEDIT02', patientId: 'PAT-NEDIT02',
      doctorIds: [doctor._id.toString()], nurseIds: [nurse._id.toString()],
    });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-NEDIT02')
      .set(bearer(token))
      .send({ notes: 'Trying to sneak in a doctor change', doctorIds: [otherDoctor._id.toString()] });

    expect(res.status).toBe(403);
    const stored = await OPDVisitModel.findOne({ visitId: 'OPD-NEDIT02' });
    expect(stored?.doctorIds).toEqual([doctor._id.toString()]);
    expect(stored?.notes).toBeNull(); // rejected outright — not even the notes half went through
  });

  test.each([
    ['diagnosis',    { diagnosis: 'Should be blocked' }],
    ['prescription', { prescription: 'Should be blocked' }],
    ['visitDate',    { visitDate: '2026-05-16' }],
  ])('403 — an assigned nurse cannot update %s', async (_field, payload) => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-NEDIT04');
    const nurse  = await seedUser(tid, 'nurse-nedit4@h.com', UserRole.NURSE);
    await seedVisit(tid, { visitId: 'OPD-NEDIT04', patientId: 'PAT-NEDIT04', nurseIds: [nurse._id.toString()] });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-NEDIT04')
      .set(bearer(token))
      .send(payload);

    expect(res.status).toBe(403);
  });

  test('404 — a nurse not assigned to this visit cannot edit it, even just notes', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-NEDIT03');
    const nurse       = await seedUser(tid, 'nurse-nedit5@h.com', UserRole.NURSE);
    const assignedNurse = await seedUser(tid, 'nurse-nedit6@h.com', UserRole.NURSE);
    await seedVisit(tid, {
      visitId: 'OPD-NEDIT03', patientId: 'PAT-NEDIT03', nurseIds: [assignedNurse._id.toString()],
    });

    const token = tokenFor(nurse._id.toString(), tid, UserRole.NURSE);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-NEDIT03')
      .set(bearer(token))
      .send({ notes: 'Should be blocked' });

    expect(res.status).toBe(404);
    const stored = await OPDVisitModel.findOne({ visitId: 'OPD-NEDIT03' });
    expect(stored?.notes).toBeNull();
  });

  test('existing roles unaffected — a Doctor can still update doctorIds/diagnosis/prescription/notes together', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid, 'PAT-NEDIT05');
    const doctor      = await seedUser(tid, 'doc-nedit5@h.com', UserRole.DOCTOR);
    const otherDoctor = await seedUser(tid, 'doc-nedit6@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-NEDIT05', patientId: 'PAT-NEDIT05', doctorIds: [doctor._id.toString()] });

    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);
    const res   = await request(app)
      .patch('/api/opd/visits/OPD-NEDIT05')
      .set(bearer(token))
      .send({ doctorIds: [otherDoctor._id.toString()], diagnosis: 'Flu', prescription: 'Rest', notes: 'Follow-up in a week' });

    expect(res.status).toBe(200);
    expect(res.body.data.doctorIds).toEqual([otherDoctor._id.toString()]);
    expect(res.body.data.diagnosis).toBe('Flu');
  });
});

// ─── Clinical data encryption at rest (diagnosis / prescription) ─────────────
// The security property under test is what lands in MongoDB, so every storage
// assertion reads the raw driver collection, bypassing the model's
// encrypt/decrypt middleware — a regression that stops encrypting can't hide
// behind the transparent read path.
describe('Clinical field encryption at rest — OPD diagnosis/prescription', () => {
  const ENVELOPE = /^enc:v1:/;

  // Raw document straight from the driver — no Mongoose middleware, so this is
  // exactly what is stored.
  async function rawVisit(visitId: string): Promise<Record<string, unknown>> {
    const doc = await mongoose.connection.collection('opd_visits').findOne({ visitId });
    expect(doc).not.toBeNull();
    return doc as Record<string, unknown>;
  }

  test('completing a visit stores ciphertext, never the plaintext', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc-enc1@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-ENC00001', doctorIds: [doctor._id.toString()] });
    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const res = await request(app)
      .patch('/api/opd/visits/OPD-ENC00001/complete')
      .set(bearer(token))
      .send({ diagnosis: 'Acute viral fever', prescription: 'Paracetamol 500mg TDS' });

    expect(res.status).toBe(200);
    // The API still answers in plaintext for the authorized caller.
    expect(res.body.data.diagnosis).toBe('Acute viral fever');
    expect(res.body.data.prescription).toBe('Paracetamol 500mg TDS');

    const stored = await rawVisit('OPD-ENC00001');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.prescription).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('Acute viral fever');
    expect(JSON.stringify(stored)).not.toContain('Paracetamol');
  });

  test('updating a visit stores ciphertext, and every read path returns plaintext', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc-enc2@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-ENC00002', doctorIds: [doctor._id.toString()] });
    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    const NOTE = '<p>Advise <strong>bed rest</strong>; review in 2 weeks.</p>';
    const patchRes = await request(app)
      .patch('/api/opd/visits/OPD-ENC00002')
      .set(bearer(token))
      .send({ diagnosis: 'Lumbar strain', prescription: 'Physiotherapy', notes: NOTE });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.diagnosis).toBe('Lumbar strain');
    expect(patchRes.body.data.notes).toBe(NOTE);

    const stored = await rawVisit('OPD-ENC00002');
    expect(stored.diagnosis).toMatch(ENVELOPE);
    expect(stored.prescription).toMatch(ENVELOPE);
    expect(stored.notes).toMatch(ENVELOPE);
    expect(JSON.stringify(stored)).not.toContain('bed rest');

    // findOne path
    const getRes = await request(app).get('/api/opd/visits/OPD-ENC00002').set(bearer(token));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.diagnosis).toBe('Lumbar strain');
    expect(getRes.body.data.prescription).toBe('Physiotherapy');
    expect(getRes.body.data.notes).toBe(NOTE);

    // find (list) path — the queue for this visit's own date
    const queueRes = await request(app)
      .get('/api/opd/visits')
      .query({ date: '2026-05-15' })
      .set(bearer(token));
    expect(queueRes.status).toBe(200);
    const queued = queueRes.body.data.find((v: { visitId: string }) => v.visitId === 'OPD-ENC00002');
    expect(queued.diagnosis).toBe('Lumbar strain');
    expect(queued.notes).toBe(NOTE);

    // lean() history path
    const historyRes = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/history')
      .set(bearer(token));
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.data[0].diagnosis).toBe('Lumbar strain');
    expect(historyRes.body.data.data[0].prescription).toBe('Physiotherapy');
    expect(historyRes.body.data.data[0].notes).toBe(NOTE);
  });

  test('legacy plaintext rows (written before encryption) still read back correctly', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const rc    = await seedUser(tid, 'rc-enc@h.com', UserRole.RECEPTIONIST);
    const token = tokenFor(rc._id.toString(), tid, UserRole.RECEPTIONIST);

    // Inserted through the raw driver, so it lands as plaintext exactly the way
    // a pre-encryption record would have.
    await mongoose.connection.collection('opd_visits').insertOne({
      visitId:      'OPD-LEGACY01',
      tenantId:     tid,
      patientId:    'PAT-TEST0001',
      doctorIds:    [],
      nurseIds:     [],
      departmentId: null,
      visitDate:    new Date('2026-05-15T00:00:00.000Z'),
      queueNumber:  1,
      status:       OPDVisitStatus.COMPLETED,
      diagnosis:    'Legacy hypertension',
      prescription: 'Legacy amlodipine',
      notes:        null,
      createdAt:    new Date('2026-05-15T00:00:00.000Z'),
      updatedAt:    new Date('2026-05-15T00:00:00.000Z'),
    });

    const res = await request(app).get('/api/opd/visits/OPD-LEGACY01').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.diagnosis).toBe('Legacy hypertension');
    expect(res.body.data.prescription).toBe('Legacy amlodipine');
  });

  test('a legacy row is encrypted on its next write, without corrupting the value', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc-enc3@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    await mongoose.connection.collection('opd_visits').insertOne({
      visitId:      'OPD-LEGACY02',
      tenantId:     tid,
      patientId:    'PAT-TEST0001',
      doctorIds:    [doctor._id.toString()],
      nurseIds:     [],
      departmentId: null,
      visitDate:    new Date('2026-05-15T00:00:00.000Z'),
      queueNumber:  1,
      status:       OPDVisitStatus.OPEN,
      diagnosis:    'Legacy diagnosis',
      prescription: null,
      notes:        null,
      createdAt:    new Date('2026-05-15T00:00:00.000Z'),
      updatedAt:    new Date('2026-05-15T00:00:00.000Z'),
    });

    const res = await request(app)
      .patch('/api/opd/visits/OPD-LEGACY02')
      .set(bearer(token))
      .send({ diagnosis: 'Revised diagnosis' });

    expect(res.status).toBe(200);
    expect(res.body.data.diagnosis).toBe('Revised diagnosis');
    expect((await rawVisit('OPD-LEGACY02')).diagnosis).toMatch(ENVELOPE);
  });

  test('history search still matches on diagnosis once it is encrypted', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc-enc4@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    await seedVisit(tid, { visitId: 'OPD-SRCHE001', doctorIds: [doctor._id.toString()] });
    await seedVisit(tid, { visitId: 'OPD-SRCHE002', doctorIds: [doctor._id.toString()] });
    await OPDVisitModel.findOneAndUpdate(
      { tenantId: tid, visitId: 'OPD-SRCHE001' },
      { $set: { diagnosis: 'Chronic migraine' } },
    );
    await OPDVisitModel.findOneAndUpdate(
      { tenantId: tid, visitId: 'OPD-SRCHE002' },
      { $set: { diagnosis: 'Seasonal allergy' } },
    );
    // Really is ciphertext at rest — so the search below cannot be a $regex hit.
    expect((await rawVisit('OPD-SRCHE001')).diagnosis).toMatch(ENVELOPE);

    const res = await request(app)
      .get('/api/opd/patients/PAT-TEST0001/history')
      .query({ search: 'migraine' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].visitId).toBe('OPD-SRCHE001');
    expect(res.body.data.data[0].diagnosis).toBe('Chronic migraine');
  });

  test('the same diagnosis text encrypts differently on two visits (random IV)', async () => {
    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc-enc5@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-IV000001', doctorIds: [doctor._id.toString()] });
    await seedVisit(tid, { visitId: 'OPD-IV000002', doctorIds: [doctor._id.toString()] });
    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    for (const visitId of ['OPD-IV000001', 'OPD-IV000002']) {
      const res = await request(app)
        .patch(`/api/opd/visits/${visitId}`)
        .set(bearer(token))
        .send({ diagnosis: 'Identical diagnosis text' });
      expect(res.status).toBe(200);
    }

    const a = await rawVisit('OPD-IV000001');
    const b = await rawVisit('OPD-IV000002');
    expect(a.diagnosis).not.toBe(b.diagnosis);
  });

  test('audit log records that diagnosis/prescription/notes changed, never their values', async () => {
    const { auditService } = jest.requireMock<{ auditService: { log: jest.Mock } }>(
      '../../../src/shared/services/audit.service',
    );
    const auditLog = auditService.log;
    auditLog.mockClear();

    const tenant = await seedTenant();
    const tid    = tenant._id.toString();
    await seedPatient(tid);
    const doctor = await seedUser(tid, 'doc-enc6@h.com', UserRole.DOCTOR);
    await seedVisit(tid, { visitId: 'OPD-AUDIT001', doctorIds: [doctor._id.toString()] });
    const token = tokenFor(doctor._id.toString(), tid, UserRole.DOCTOR);

    await request(app)
      .patch('/api/opd/visits/OPD-AUDIT001')
      .set(bearer(token))
      .send({
        diagnosis:    'Confidential update dx',
        prescription: 'Confidential update rx',
        notes:        '<p>Confidential update note</p>',
      });

    await request(app)
      .patch('/api/opd/visits/OPD-AUDIT001/complete')
      .set(bearer(token))
      .send({ diagnosis: 'Confidential complete dx' });

    const logged = JSON.stringify(auditLog.mock.calls);
    expect(logged).not.toContain('Confidential update dx');
    expect(logged).not.toContain('Confidential update rx');
    expect(logged).not.toContain('Confidential update note');
    expect(logged).not.toContain('Confidential complete dx');
    // The trail still shows which fields were touched.
    expect(logged).toContain('diagnosis');
    expect(logged).toContain('prescription');
    expect(logged).toContain('notes');
  });
});
