import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';
import { v4 as uuidv4 }      from 'uuid';

jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: { sendInviteEmail: jest.fn(), sendWelcomeEmail: jest.fn() },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn().mockResolvedValue('mocked-s3-key'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.test/presigned-url'),
  },
}));
jest.mock('../../../src/modules/notification/notification.service', () => ({
  notificationService: {
    sendNotification: jest.fn().mockResolvedValue(undefined),
    sendToRole:       jest.fn().mockResolvedValue(undefined),
  },
}));

import app                  from '../../../src/app';
import { UserModel }        from '../../../src/modules/user/user.model';
import { TenantModel }      from '../../../src/modules/tenant/tenant.model';
import { PatientModel }     from '../../../src/modules/patient/patient.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../../../src/modules/lab/lab.model';
import { OPDVisitModel } from '../../../src/modules/opd/opd.model';
import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
import { PaymentModel } from '../../../src/modules/payment/payment.model';
import { TenantStatus, UserRole }     from '../../../src/shared/types/common.types';
import { PATHOLOGY_REPORT_MAX_BYTES, RADIOLOGY_REPORT_MAX_BYTES } from '../../../src/modules/lab/lab.types';
import { toIstDateKey } from '../../../src/modules/attendance/attendance.timezone';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:   MongoMemoryServer;
let tenantId: string;
let doctorId: string;
let doctorToken:      string;
let pathologistToken: string;
let radiologistToken: string;
let adminToken:       string;
let receptionistToken: string;

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

  const tenant = await TenantModel.create({
    name:        'Lab Test Hospital',
    adminEmail:  'admin@labtest.com',
    status:      TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg-cert-001',
      gstNumber:               'GST001',
      panCard:                 'PAN001',
      addressLine:            '321 Lab Street',
      city:                    'Mumbai',
      state:                   'Maharashtra',
      pincode:                 '400001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const doctor = await UserModel.create({
    tenantId, email: 'doctor@test.com', name: 'Lab Doctor', passwordHash: 'x',
    role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
  });
  doctorId = (doctor._id as mongoose.Types.ObjectId).toString();

  const pathologist = await UserModel.create({
    tenantId, email: 'pathologist@test.com', name: 'Lab Pathologist', passwordHash: 'x',
    role: UserRole.PATHOLOGIST, isActive: true, isFirstLogin: false,
  });
  const pathologistId = (pathologist._id as mongoose.Types.ObjectId).toString();

  const radiologist = await UserModel.create({
    tenantId, email: 'radiologist@test.com', name: 'Lab Radiologist', passwordHash: 'x',
    role: UserRole.RADIOLOGIST, isActive: true, isFirstLogin: false,
  });
  const radiologistId = (radiologist._id as mongoose.Types.ObjectId).toString();

  await PatientModel.create({
    patientId: 'PAT-001', tenantId, fullName: 'John Doe',
    dateOfBirth: new Date('1980-01-01'), gender: 'MALE',
    mobileNumber: '1234567890', address: '123 Test Street',
  });

  // Doctor-patient assignment: Lab Doctor is assigned to PAT-001 via an OPD
  // visit, so all existing "doctor acts on PAT-001" tests below continue to
  // hold now that Doctor Lab access is scoped to assigned patients.
  await OPDVisitModel.create({
    visitId:        'OPD-LABTEST01',
    tenantId,
    patientId:      'PAT-001',
    doctorIds:      [doctorId],
    departmentId:   null,
    visitDate:      new Date(),
    queueNumber:    1,
    status:         'OPEN',
  });

  const admin = await UserModel.create({
    tenantId, email: 'admin@test.com', name: 'Lab Admin', passwordHash: 'x',
    role: UserRole.HOSPITAL_ADMIN, isActive: true, isFirstLogin: false,
  });
  const adminId = (admin._id as mongoose.Types.ObjectId).toString();

  const receptionist = await UserModel.create({
    tenantId, email: 'reception@test.com', name: 'Receptionist', passwordHash: 'x',
    role: UserRole.RECEPTIONIST, isActive: true, isFirstLogin: false,
  });
  const receptionistId = (receptionist._id as mongoose.Types.ObjectId).toString();

  const sign = (id: string, role: UserRole) =>
    jwt.sign({ userId: id, tenantId, role, email: 'x@x.com', isFirstLogin: false }, JWT_SECRET);

  doctorToken       = sign(doctorId, UserRole.DOCTOR);
  pathologistToken  = sign(pathologistId, UserRole.PATHOLOGIST);
  radiologistToken  = sign(radiologistId, UserRole.RADIOLOGIST);
  adminToken        = sign(adminId, UserRole.HOSPITAL_ADMIN);
  receptionistToken = sign(receptionistId, UserRole.RECEPTIONIST);
});

// Report upload requires the request's payment to have been collected.
async function markPaid(kind: 'pathology' | 'radiology', requestId: string): Promise<void> {
  await PaymentModel.create({
    paymentId: `PAY-${uuidv4()}`, tenantId, patientId: 'PAT-001',
    amount: 100, paymentMethod: 'CASH', description: 'Lab payment', status: 'COMPLETED',
    referenceType: kind === 'pathology' ? 'PATHOLOGY_REQUEST' : 'RADIOLOGY_REQUEST',
    referenceId: requestId, createdBy: 'test',
  });
}

// ─── Pathology ────────────────────────────────────────────────────────────────

describe('POST /api/lab/pathology', () => {
  test('creates a pathology request (201)', async () => {
    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', testType: 'Blood CBC' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.testType).toBe('Blood CBC');
    expect(res.body.data.reportUrl).toBeNull();
  });

  test('Idempotency-Key replay: retrying the same offline-queued create does not create a second pathology request', async () => {
    const idempotencyKey = 'temp-client-op-path-001';
    const payload = { patientId: 'PAT-001', testType: 'Offline CBC', referredBy: 'SELF', notes: 'queued offline' };

    const first = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect(first.status).toBe(201);

    // A sync retry of uncertain outcome replays the stored response instead
    // of running the handler (and creating a duplicate) a second time.
    const second = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect(second.status).toBe(201);
    expect(second.body.data.requestId).toBe(first.body.data.requestId);

    const docs = await PathologyRequestModel.find({ tenantId, testType: 'Offline CBC' });
    expect(docs).toHaveLength(1);
    expect(docs[0].patientId).toBe('PAT-001');
    expect(docs[0].notes).toBe('queued offline');
  });

  test('returns 404 when patient does not exist', async () => {
    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-UNKNOWN', testType: 'CBC' });

    expect(res.status).toBe(404);
  });

  test('returns 400 for missing testType', async () => {
    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001' });

    expect(res.status).toBe(400);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app).post('/api/lab/pathology').send({ patientId: 'PAT-001', testType: 'CBC' });
    expect(res.status).toBe(401);
  });

  test('returns 400 for notes exceeding maximum length', async () => {
    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', testType: 'CBC', notes: 'A'.repeat(2001) });

    expect(res.status).toBe(400);
  });

  test('trims leading/trailing whitespace from notes', async () => {
    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', testType: 'CBC', notes: '  fasting sample  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.notes).toBe('fasting sample');
  });

  test('201 — pathologist can create a pathology request', async () => {
    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${pathologistToken}`)
      .send({ patientId: 'PAT-001', testType: 'Blood CBC' });

    expect(res.status).toBe(201);
    expect(res.body.data.testType).toBe('Blood CBC');
  });

  test('201 — receptionist can create a pathology request', async () => {
    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: 'PAT-001', testType: 'Blood CBC' });

    expect(res.status).toBe(201);
    expect(res.body.data.testType).toBe('Blood CBC');
  });

  test('403 — radiologist cannot create a pathology request (own-type only)', async () => {
    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${radiologistToken}`)
      .send({ patientId: 'PAT-001', testType: 'Blood CBC' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/lab/pathology', () => {
  test('lists pathology requests (200)', async () => {
    await PathologyRequestModel.create({
      requestId: uuidv4(), patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, testType: 'Blood CBC',
      status: 'PENDING', requestedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
  });
});

describe('GET /api/lab/{pathology,radiology} — pagination', () => {
  // Every request shares one requestedAt so page boundaries depend on the
  // sort's _id tiebreaker — without it, rows could repeat or vanish across pages.
  const SAME_DATE = new Date('2026-01-01T00:00:00.000Z');

  async function seedRequests(kind: 'pathology' | 'radiology') {
    await PatientModel.create({
      patientId: 'PAT-PG-SITA', tenantId, fullName: 'Sita Devi',
      dateOfBirth: new Date('1990-01-01'), gender: 'FEMALE',
      mobileNumber: '1234567891', address: '1 Test Street',
    });
    // 15 for John Doe (PAT-001), 10 for Sita; 4 of John's COMPLETED; plus one
    // soft-deleted row that must never be counted.
    const rows = Array.from({ length: 26 }, (_, i) => ({
      requestId: uuidv4(), tenantId, requestedBy: doctorId, requestedAt: SAME_DATE,
      patientId: i < 15 ? 'PAT-001' : 'PAT-PG-SITA',
      status:    i < 4 ? 'COMPLETED' : 'PENDING',
      isDeleted: i === 25,
      ...(kind === 'pathology' ? { testType: 'Blood CBC' } : { imagingType: 'X-Ray' }),
    }));
    if (kind === 'pathology') await PathologyRequestModel.create(rows);
    else await RadiologyRequestModel.create(rows);
  }

  describe.each(['pathology', 'radiology'] as const)('%s', (kind) => {
    const getPage = (qs: string) =>
      request(app).get(`/api/lab/${kind}?${qs}`).set('Authorization', `Bearer ${adminToken}`);

    test('walks every page with accurate totals and no duplicate/missing rows', async () => {
      await seedRequests(kind);

      const seen: string[] = [];
      const sizes: number[] = [];
      for (let page = 1; page <= 3; page++) {
        const res = await getPage(`page=${page}&limit=10`);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ total: 25, page, limit: 10, totalPages: 3 });
        sizes.push(res.body.data.data.length);
        seen.push(...res.body.data.data.map((r: { requestId: string }) => r.requestId));
      }

      expect(sizes).toEqual([10, 10, 5]);
      expect(new Set(seen).size).toBe(25);
    });

    test('a page past the end returns no rows but keeps the real total', async () => {
      await seedRequests(kind);

      const res = await getPage('page=4&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.data.data).toHaveLength(0);
      expect(res.body.data).toMatchObject({ total: 25, totalPages: 3 });
    });

    test('search and status filters are applied before paginating', async () => {
      await seedRequests(kind);

      const search = await getPage('search=sita&page=1&limit=10');
      expect(search.body.data).toMatchObject({ total: 10, totalPages: 1 });
      expect(search.body.data.data.every((r: { patientId: string }) => r.patientId === 'PAT-PG-SITA')).toBe(true);

      const completed = await getPage('status=COMPLETED&page=1&limit=3');
      expect(completed.body.data).toMatchObject({ total: 4, totalPages: 2 });
      expect(completed.body.data.data).toHaveLength(3);

      const pending = await getPage('search=john&status=PENDING&page=2&limit=10');
      expect(pending.body.data).toMatchObject({ total: 11, page: 2, totalPages: 2 });
      expect(pending.body.data.data).toHaveLength(1);
    });

    test('rejects an out-of-range page or limit with 400', async () => {
      expect((await getPage('page=0')).status).toBe(400);
      expect((await getPage('limit=101')).status).toBe(400);
    });
  });
});

describe('PATCH /api/lab/pathology/:requestId/report', () => {
  let requestId: string;

  beforeEach(async () => {
    requestId = uuidv4();
    await PathologyRequestModel.create({
      requestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, testType: 'Blood CBC',
      status: 'PENDING', requestedAt: new Date(),
    });
    await markPaid('pathology', requestId);
  });

  test('a Pathologist cannot upload a report file — structured reports only (403)', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}/report`)
      .set('Authorization', `Bearer ${pathologistToken}`)
      .attach('report', Buffer.from('PDF content'), { filename: 'r.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
    const doc = await PathologyRequestModel.findOne({ requestId, tenantId }).lean();
    expect(doc?.status).toBe('PENDING');
    expect(doc?.reportS3Key ?? null).toBeNull();
  });

  test('uploads a pathology report and sets status to COMPLETED (200)', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}/report`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('report', Buffer.from('PDF content for blood test results'), {
        filename:    'blood_test.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.reportUrl).toBeTruthy();
  });

  test('rejects pathology report > 10 MB with 413 (multer limit)', async () => {
    const oversized = Buffer.alloc(PATHOLOGY_REPORT_MAX_BYTES + 1, 'x');

    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}/report`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('report', oversized, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(413);
  });

  test('returns 400 when no file is attached', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}/report`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('note', 'missing file');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no file/i);
  });

  test('returns 404 for unknown request ID', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${uuidv4()}/report`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('report', Buffer.from('content'), {
        filename: 'report.pdf', contentType: 'application/pdf',
      });

    expect(res.status).toBe(404);
  });

  test('returns 409 when report already uploaded', async () => {
    await PathologyRequestModel.findOneAndUpdate(
      { requestId, tenantId },
      { status: 'COMPLETED', reportS3Key: 'existing-key' },
    );

    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}/report`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('report', Buffer.from('new content'), {
        filename: 'report.pdf', contentType: 'application/pdf',
      });

    expect(res.status).toBe(409);
  });
});


// ─── Doctor patient-assignment scoping ────────────────────────────────────────

describe('Doctor Lab access is scoped to assigned patients', () => {
  async function seedUnassignedPatient() {
    await PatientModel.create({
      patientId: 'PAT-002', tenantId, fullName: 'Jane Roe',
      dateOfBirth: new Date('1985-01-01'), gender: 'FEMALE',
      mobileNumber: '9998887777', address: '456 Other Street',
    });
  }

  test('404 — doctor cannot create a pathology request for a patient not assigned to them', async () => {
    await seedUnassignedPatient();

    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-002', testType: 'Blood CBC' });

    expect(res.status).toBe(404);
  });

  test('404 — doctor cannot create a radiology request for a patient not assigned to them', async () => {
    await seedUnassignedPatient();

    const res = await request(app)
      .post('/api/lab/radiology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-002', imagingType: 'X-Ray Chest' });

    expect(res.status).toBe(404);
  });

  test('201 — doctor can create a pathology request for a patient assigned only via an IPD admission', async () => {
    await seedUnassignedPatient();
    await IPDAdmissionModel.create({
      admissionId:       'adm-lab-001',
      patientId:         'PAT-002',
      wardId:            'ward-1',
      bedId:             'bed-1',
      bedNumber:         'B-01',
      wardName:          'General Ward',
      assignedDoctorIds: [doctorId],
      status:            'ADMITTED',
      admissionDate:     new Date(),
      dischargeDate:     null,
      progressNotes:     [],
      tenantId,
    });

    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-002', testType: 'Blood CBC' });

    expect(res.status).toBe(201);
  });

  test('GET /api/lab/pathology — doctor sees only requests for their own assigned patients', async () => {
    await seedUnassignedPatient();
    await PathologyRequestModel.create([
      {
        requestId: uuidv4(), patientId: 'PAT-001', tenantId,
        requestedBy: doctorId, testType: 'Blood CBC',
        status: 'PENDING', requestedAt: new Date(),
      },
      {
        requestId: uuidv4(), patientId: 'PAT-002', tenantId,
        requestedBy: '507f1f77bcf86cd799439011', testType: 'Lipid Profile',
        status: 'PENDING', requestedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].patientId).toBe('PAT-001');
  });

  test('GET /api/lab/pathology/:requestId — doctor can fetch a request for their own patient (200)', async () => {
    const requestId = uuidv4();
    await PathologyRequestModel.create({
      requestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, testType: 'Blood CBC',
      status: 'PENDING', requestedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/lab/pathology/:requestId — doctor cannot fetch another doctor\'s patient\'s request, even by direct ID (404)', async () => {
    await seedUnassignedPatient();
    const requestId = uuidv4();
    await PathologyRequestModel.create({
      requestId, patientId: 'PAT-002', tenantId,
      requestedBy: '507f1f77bcf86cd799439011', testType: 'Lipid Profile',
      status: 'PENDING', requestedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(404);
  });

  test('GET /api/lab/radiology/:requestId — doctor cannot fetch another doctor\'s patient\'s request, even by direct ID (404)', async () => {
    await seedUnassignedPatient();
    const requestId = uuidv4();
    await RadiologyRequestModel.create({
      requestId, patientId: 'PAT-002', tenantId,
      requestedBy: '507f1f77bcf86cd799439011', imagingType: 'CT Scan',
      status: 'PENDING', requestedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(404);
  });

  test('HOSPITAL_ADMIN continues to see lab requests for all patients (unaffected)', async () => {
    await seedUnassignedPatient();
    await PathologyRequestModel.create([
      {
        requestId: uuidv4(), patientId: 'PAT-001', tenantId,
        requestedBy: doctorId, testType: 'Blood CBC',
        status: 'PENDING', requestedAt: new Date(),
      },
      {
        requestId: uuidv4(), patientId: 'PAT-002', tenantId,
        requestedBy: '507f1f77bcf86cd799439011', testType: 'Lipid Profile',
        status: 'PENDING', requestedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get('/api/lab/pathology')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
  });

  // ─── patientId filter combined with doctor scoping ──────────────────────────

  test('GET /api/lab/pathology?patientId=<allowed> — doctor filtering by an allowed patientId receives only that patient\'s records', async () => {
    await seedUnassignedPatient();
    await OPDVisitModel.create({
      visitId: 'OPD-LABTEST02', tenantId, patientId: 'PAT-002',
      doctorIds: [doctorId], departmentId: null, visitDate: new Date(),
      queueNumber: 2, status: 'OPEN',
    });
    await PathologyRequestModel.create([
      {
        requestId: uuidv4(), patientId: 'PAT-001', tenantId,
        requestedBy: doctorId, testType: 'Blood CBC',
        status: 'PENDING', requestedAt: new Date(),
      },
      {
        requestId: uuidv4(), patientId: 'PAT-002', tenantId,
        requestedBy: doctorId, testType: 'Lipid Profile',
        status: 'PENDING', requestedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get('/api/lab/pathology')
      .query({ patientId: 'PAT-001' })
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].patientId).toBe('PAT-001');
  });

  test('GET /api/lab/pathology?patientId=<out-of-scope> — doctor filtering by an out-of-scope patientId receives zero records', async () => {
    await seedUnassignedPatient();
    await PathologyRequestModel.create([
      {
        requestId: uuidv4(), patientId: 'PAT-001', tenantId,
        requestedBy: doctorId, testType: 'Blood CBC',
        status: 'PENDING', requestedAt: new Date(),
      },
      {
        requestId: uuidv4(), patientId: 'PAT-002', tenantId,
        requestedBy: '507f1f77bcf86cd799439011', testType: 'Lipid Profile',
        status: 'PENDING', requestedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get('/api/lab/pathology')
      .query({ patientId: 'PAT-002' })
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  test('GET /api/lab/pathology (no patientId filter) — doctor without a patientId filter receives records for all allowed patients', async () => {
    await seedUnassignedPatient();
    await OPDVisitModel.create({
      visitId: 'OPD-LABTEST03', tenantId, patientId: 'PAT-002',
      doctorIds: [doctorId], departmentId: null, visitDate: new Date(),
      queueNumber: 3, status: 'OPEN',
    });
    await PathologyRequestModel.create([
      {
        requestId: uuidv4(), patientId: 'PAT-001', tenantId,
        requestedBy: doctorId, testType: 'Blood CBC',
        status: 'PENDING', requestedAt: new Date(),
      },
      {
        requestId: uuidv4(), patientId: 'PAT-002', tenantId,
        requestedBy: doctorId, testType: 'Lipid Profile',
        status: 'PENDING', requestedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
    const patientIds = res.body.data.data.map((r: { patientId: string }) => r.patientId).sort();
    expect(patientIds).toEqual(['PAT-001', 'PAT-002']);
  });

  test('GET /api/lab/radiology?patientId=<allowed> — doctor filtering by an allowed patientId receives only that patient\'s records', async () => {
    await seedUnassignedPatient();
    await OPDVisitModel.create({
      visitId: 'OPD-LABTEST04', tenantId, patientId: 'PAT-002',
      doctorIds: [doctorId], departmentId: null, visitDate: new Date(),
      queueNumber: 4, status: 'OPEN',
    });
    await RadiologyRequestModel.create([
      {
        requestId: uuidv4(), patientId: 'PAT-001', tenantId,
        requestedBy: doctorId, imagingType: 'X-Ray Chest',
        status: 'PENDING', requestedAt: new Date(),
      },
      {
        requestId: uuidv4(), patientId: 'PAT-002', tenantId,
        requestedBy: doctorId, imagingType: 'CT Scan',
        status: 'PENDING', requestedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get('/api/lab/radiology')
      .query({ patientId: 'PAT-001' })
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].patientId).toBe('PAT-001');
  });

  test('GET /api/lab/radiology?patientId=<out-of-scope> — doctor filtering by an out-of-scope patientId receives zero records', async () => {
    await seedUnassignedPatient();
    await RadiologyRequestModel.create([
      {
        requestId: uuidv4(), patientId: 'PAT-001', tenantId,
        requestedBy: doctorId, imagingType: 'X-Ray Chest',
        status: 'PENDING', requestedAt: new Date(),
      },
      {
        requestId: uuidv4(), patientId: 'PAT-002', tenantId,
        requestedBy: '507f1f77bcf86cd799439011', imagingType: 'CT Scan',
        status: 'PENDING', requestedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get('/api/lab/radiology')
      .query({ patientId: 'PAT-002' })
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  test('GET /api/lab/pathology?patientId=<any> — HOSPITAL_ADMIN filtering by patientId is unaffected by doctor scoping', async () => {
    await seedUnassignedPatient();
    await PathologyRequestModel.create([
      {
        requestId: uuidv4(), patientId: 'PAT-001', tenantId,
        requestedBy: doctorId, testType: 'Blood CBC',
        status: 'PENDING', requestedAt: new Date(),
      },
      {
        requestId: uuidv4(), patientId: 'PAT-002', tenantId,
        requestedBy: '507f1f77bcf86cd799439011', testType: 'Lipid Profile',
        status: 'PENDING', requestedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get('/api/lab/pathology')
      .query({ patientId: 'PAT-002' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].patientId).toBe('PAT-002');
  });
});

// ─── Radiology ────────────────────────────────────────────────────────────────

describe('POST /api/lab/radiology', () => {
  test('creates a radiology request (201)', async () => {
    const res = await request(app)
      .post('/api/lab/radiology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', imagingType: 'X-Ray Chest' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.imagingType).toBe('X-Ray Chest');
  });

  test('Idempotency-Key replay: retrying the same offline-queued create does not create a second radiology request', async () => {
    const idempotencyKey = 'temp-client-op-rad-001';
    const payload = { patientId: 'PAT-001', imagingType: 'Offline MRI', referredBy: 'SELF' };

    const first = await request(app)
      .post('/api/lab/radiology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/lab/radiology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect(second.status).toBe(201);
    expect(second.body.data.requestId).toBe(first.body.data.requestId);

    const docs = await RadiologyRequestModel.find({ tenantId, imagingType: 'Offline MRI' });
    expect(docs).toHaveLength(1);
    expect(docs[0].patientId).toBe('PAT-001');
  });

  test('201 — radiologist can create a radiology request', async () => {
    const res = await request(app)
      .post('/api/lab/radiology')
      .set('Authorization', `Bearer ${radiologistToken}`)
      .send({ patientId: 'PAT-001', imagingType: 'X-Ray Chest' });

    expect(res.status).toBe(201);
    expect(res.body.data.imagingType).toBe('X-Ray Chest');
  });

  test('201 — receptionist can create a radiology request', async () => {
    const res = await request(app)
      .post('/api/lab/radiology')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: 'PAT-001', imagingType: 'X-Ray Chest' });

    expect(res.status).toBe(201);
    expect(res.body.data.imagingType).toBe('X-Ray Chest');
  });

  test('403 — pathologist cannot create a radiology request (own-type only)', async () => {
    const res = await request(app)
      .post('/api/lab/radiology')
      .set('Authorization', `Bearer ${pathologistToken}`)
      .send({ patientId: 'PAT-001', imagingType: 'X-Ray Chest' });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/lab/radiology/:requestId/report', () => {
  let requestId: string;

  beforeEach(async () => {
    requestId = uuidv4();
    await RadiologyRequestModel.create({
      requestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, imagingType: 'X-Ray Chest',
      status: 'PENDING', requestedAt: new Date(),
    });
    await markPaid('radiology', requestId);
  });

  test('uploads a radiology report and sets status to COMPLETED (200)', async () => {
    const res = await request(app)
      .patch(`/api/lab/radiology/${requestId}/report`)
      .set('Authorization', `Bearer ${radiologistToken}`)
      .attach('report', Buffer.from('DICOM image data placeholder'), {
        filename:    'chest_xray.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.reportUrl).toBeTruthy();
  });

  test('rejects radiology report > 20 MB with 413 (multer limit)', async () => {
    const oversized = Buffer.alloc(RADIOLOGY_REPORT_MAX_BYTES + 1, 'x');

    const res = await request(app)
      .patch(`/api/lab/radiology/${requestId}/report`)
      .set('Authorization', `Bearer ${radiologistToken}`)
      .attach('report', oversized, { filename: 'big.dcm', contentType: 'application/dicom' });

    expect(res.status).toBe(413);
  });
});

// ─── Edit Pathology ───────────────────────────────────────────────────────────

describe('PATCH /api/lab/pathology/:requestId', () => {
  let requestId: string;

  beforeEach(async () => {
    requestId = uuidv4();
    await PathologyRequestModel.create({
      requestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, testType: 'Blood CBC',
      status: 'PENDING', priority: 'NORMAL', requestedAt: new Date(),
    });
  });

  test('200 — pathologist can edit testType and notes', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${pathologistToken}`)
      .send({ testType: 'Urine Analysis', notes: 'Updated notes' });

    expect(res.status).toBe(200);
    expect(res.body.data.testType).toBe('Urine Analysis');
  });

  test('403 — doctor cannot change status', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(403);
    const doc = await PathologyRequestModel.findOne({ requestId, tenantId }).lean();
    expect(doc?.status).toBe('PENDING');
  });

  test('200 — pathologist can change status to IN_PROGRESS', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${pathologistToken}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
  });

  test('200 — hospital admin can change status to IN_PROGRESS', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
  });

  test('400 — body with status COMPLETED rejected by Zod', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(400);
  });

  test('409 — cannot edit an already COMPLETED request', async () => {
    await PathologyRequestModel.findOneAndUpdate({ requestId, tenantId }, { status: 'COMPLETED' });

    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${pathologistToken}`)
      .send({ testType: 'New Test' });

    expect(res.status).toBe(409);
  });

  test('403 — receptionist role gets 403', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ testType: 'New Test' });

    expect(res.status).toBe(403);
  });

  test('401 — no auth token', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}`)
      .send({ testType: 'New Test' });

    expect(res.status).toBe(401);
  });

  test('404 — unknown requestId returns 404', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${uuidv4()}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ testType: 'New Test' });

    expect(res.status).toBe(404);
  });
});

// ─── Delete Pathology ─────────────────────────────────────────────────────────

describe('DELETE /api/lab/pathology/:requestId', () => {
  let requestId: string;

  beforeEach(async () => {
    requestId = uuidv4();
    await PathologyRequestModel.create({
      requestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, testType: 'Blood CBC',
      status: 'PENDING', priority: 'NORMAL', requestedAt: new Date(),
    });
  });

  test('200 — doctor can delete a PENDING request', async () => {
    const res = await request(app)
      .delete(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });

  test('200 — HOSPITAL_ADMIN can delete a COMPLETED request and subsequent GET returns 404', async () => {
    await PathologyRequestModel.findOneAndUpdate({ requestId, tenantId }, { status: 'COMPLETED', reportS3Key: 'key' });

    const delRes = await request(app)
      .delete(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });

  test('403 — doctor cannot delete a COMPLETED request', async () => {
    await PathologyRequestModel.findOneAndUpdate({ requestId, tenantId }, { status: 'COMPLETED', reportS3Key: 'key' });

    const res = await request(app)
      .delete(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
  });

  test('403 — pathologist cannot delete a COMPLETED request', async () => {
    await PathologyRequestModel.findOneAndUpdate({ requestId, tenantId }, { status: 'COMPLETED', reportS3Key: 'key' });

    const res = await request(app)
      .delete(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${pathologistToken}`);

    expect(res.status).toBe(403);
  });

  test('404 — double-delete returns 404', async () => {
    await request(app)
      .delete(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    const res = await request(app)
      .delete(`/api/lab/pathology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(404);
  });

  test('401 — no auth token', async () => {
    const res = await request(app).delete(`/api/lab/pathology/${requestId}`);
    expect(res.status).toBe(401);
  });
});

// ─── Edit Radiology ───────────────────────────────────────────────────────────

describe('PATCH /api/lab/radiology/:requestId', () => {
  let requestId: string;

  beforeEach(async () => {
    requestId = uuidv4();
    await RadiologyRequestModel.create({
      requestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, imagingType: 'X-Ray Chest',
      status: 'PENDING', priority: 'NORMAL', requestedAt: new Date(),
    });
  });

  test('200 — radiologist can edit imagingType and priority', async () => {
    const res = await request(app)
      .patch(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${radiologistToken}`)
      .send({ imagingType: 'CT Scan Brain', priority: 'URGENT' });

    expect(res.status).toBe(200);
    expect(res.body.data.imagingType).toBe('CT Scan Brain');
    expect(res.body.data.priority).toBe('URGENT');
  });

  test('200 — radiologist can change status to IN_PROGRESS', async () => {
    const res = await request(app)
      .patch(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${radiologistToken}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
  });

  test('403 — doctor cannot change status', async () => {
    const res = await request(app)
      .patch(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(403);
  });

  test('409 — cannot edit a COMPLETED request', async () => {
    await RadiologyRequestModel.findOneAndUpdate({ requestId, tenantId }, { status: 'COMPLETED' });

    const res = await request(app)
      .patch(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${radiologistToken}`)
      .send({ imagingType: 'MRI Brain' });

    expect(res.status).toBe(409);
  });

  test('403 — receptionist role gets 403', async () => {
    const res = await request(app)
      .patch(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ imagingType: 'MRI Brain' });

    expect(res.status).toBe(403);
  });

  test('401 — no auth token', async () => {
    const res = await request(app)
      .patch(`/api/lab/radiology/${requestId}`)
      .send({ imagingType: 'MRI Brain' });

    expect(res.status).toBe(401);
  });
});

// ─── Delete Radiology ─────────────────────────────────────────────────────────

describe('DELETE /api/lab/radiology/:requestId', () => {
  let requestId: string;

  beforeEach(async () => {
    requestId = uuidv4();
    await RadiologyRequestModel.create({
      requestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, imagingType: 'X-Ray Chest',
      status: 'PENDING', priority: 'NORMAL', requestedAt: new Date(),
    });
  });

  test('200 — doctor can delete a PENDING request', async () => {
    const res = await request(app)
      .delete(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
  });

  test('200 — HOSPITAL_ADMIN can delete a COMPLETED request and subsequent GET returns 404', async () => {
    await RadiologyRequestModel.findOneAndUpdate({ requestId, tenantId }, { status: 'COMPLETED', reportS3Key: 'key' });

    const delRes = await request(app)
      .delete(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });

  test('403 — doctor cannot delete a COMPLETED request', async () => {
    await RadiologyRequestModel.findOneAndUpdate({ requestId, tenantId }, { status: 'COMPLETED', reportS3Key: 'key' });

    const res = await request(app)
      .delete(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
  });

  test('403 — radiologist cannot delete a COMPLETED request', async () => {
    await RadiologyRequestModel.findOneAndUpdate({ requestId, tenantId }, { status: 'COMPLETED', reportS3Key: 'key' });

    const res = await request(app)
      .delete(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${radiologistToken}`);

    expect(res.status).toBe(403);
  });

  test('404 — double-delete returns 404', async () => {
    await request(app)
      .delete(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    const res = await request(app)
      .delete(`/api/lab/radiology/${requestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(404);
  });

  test('401 — no auth token', async () => {
    const res = await request(app).delete(`/api/lab/radiology/${requestId}`);
    expect(res.status).toBe(401);
  });
});

// ─── Doctor scoping — edit/delete ─────────────────────────────────────────────

describe('Doctor scoping — edit/delete lab requests', () => {
  let secondDoctorId: string;
  let secondDoctorToken: string;
  let pathologyRequestId: string;
  let radiologyRequestId: string;

  beforeEach(async () => {
    await PatientModel.create({
      patientId: 'PAT-003', tenantId, fullName: 'Other Patient',
      dateOfBirth: new Date('1990-01-01'), gender: 'FEMALE',
      mobileNumber: '5551234567', address: '789 Another Street',
    });

    const secondDoctor = await UserModel.create({
      tenantId, email: 'doctor2@test.com', name: 'Second Doctor', passwordHash: 'x',
      role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
    });
    secondDoctorId = (secondDoctor._id as mongoose.Types.ObjectId).toString();

    await OPDVisitModel.create({
      visitId:        'OPD-LABTEST02',
      tenantId,
      patientId:      'PAT-003',
      doctorIds:      [secondDoctorId],
      departmentId:   null,
      visitDate:      new Date(),
      queueNumber:    1,
      status:         'OPEN',
    });

    secondDoctorToken = jwt.sign(
      { userId: secondDoctorId, tenantId, role: UserRole.DOCTOR, email: 'x@x.com', isFirstLogin: false },
      JWT_SECRET,
    );

    pathologyRequestId = uuidv4();
    await PathologyRequestModel.create({
      requestId: pathologyRequestId, patientId: 'PAT-003', tenantId,
      requestedBy: secondDoctorId, testType: 'Blood CBC',
      status: 'PENDING', priority: 'NORMAL', requestedAt: new Date(),
    });

    radiologyRequestId = uuidv4();
    await RadiologyRequestModel.create({
      requestId: radiologyRequestId, patientId: 'PAT-003', tenantId,
      requestedBy: secondDoctorId, imagingType: 'X-Ray Chest',
      status: 'PENDING', priority: 'NORMAL', requestedAt: new Date(),
    });
  });

  test('404 — doctor cannot edit another doctor\'s patient\'s pathology request by direct requestId', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${pathologyRequestId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ testType: 'Hacked Test' });

    expect(res.status).toBe(404);
  });

  test('404 — doctor cannot delete another doctor\'s patient\'s pathology request by direct requestId', async () => {
    const res = await request(app)
      .delete(`/api/lab/pathology/${pathologyRequestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(404);
  });

  test('404 — doctor cannot edit another doctor\'s patient\'s radiology request by direct requestId', async () => {
    const res = await request(app)
      .patch(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ imagingType: 'Hacked Imaging' });

    expect(res.status).toBe(404);
  });

  test('404 — doctor cannot delete another doctor\'s patient\'s radiology request by direct requestId', async () => {
    const res = await request(app)
      .delete(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(404);
  });

  test('200 — the assigned doctor can still edit their own patient\'s pathology request', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${pathologyRequestId}`)
      .set('Authorization', `Bearer ${secondDoctorToken}`)
      .send({ testType: 'Urine Analysis' });

    expect(res.status).toBe(200);
    expect(res.body.data.testType).toBe('Urine Analysis');
  });

  test('200 — the assigned doctor can still delete their own patient\'s radiology request', async () => {
    const res = await request(app)
      .delete(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${secondDoctorToken}`);

    expect(res.status).toBe(200);
  });

  test('200 — HOSPITAL_ADMIN can still edit a pathology request for any patient (unaffected)', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${pathologyRequestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ testType: 'Admin Edited' });

    expect(res.status).toBe(200);
  });

  test('200 — HOSPITAL_ADMIN can still delete a radiology request for any patient (unaffected)', async () => {
    const res = await request(app)
      .delete(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });
});

// ─── Receptionist Lab access ────────────────────────────────────────────────

describe('Lab role isolation — Pathologist/Radiologist see only their own type', () => {
  let pathologyRequestId: string;
  let radiologyRequestId: string;

  beforeEach(async () => {
    pathologyRequestId = uuidv4();
    radiologyRequestId = uuidv4();
    await PathologyRequestModel.create({
      requestId: pathologyRequestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, testType: 'Blood CBC',
      status: 'PENDING', requestedAt: new Date(),
    });
    await RadiologyRequestModel.create({
      requestId: radiologyRequestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, imagingType: 'X-Ray Chest',
      status: 'PENDING', requestedAt: new Date(),
    });
  });

  test('200 — pathologist can list and view pathology requests', async () => {
    const list = await request(app)
      .get('/api/lab/pathology')
      .set('Authorization', `Bearer ${pathologistToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.data).toHaveLength(1);

    const one = await request(app)
      .get(`/api/lab/pathology/${pathologyRequestId}`)
      .set('Authorization', `Bearer ${pathologistToken}`);
    expect(one.status).toBe(200);
  });

  test('403 — pathologist cannot list or view radiology requests', async () => {
    const list = await request(app)
      .get('/api/lab/radiology')
      .set('Authorization', `Bearer ${pathologistToken}`);
    expect(list.status).toBe(403);

    const one = await request(app)
      .get(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${pathologistToken}`);
    expect(one.status).toBe(403);
  });

  test('200 — radiologist can list and view radiology requests', async () => {
    const list = await request(app)
      .get('/api/lab/radiology')
      .set('Authorization', `Bearer ${radiologistToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.data).toHaveLength(1);

    const one = await request(app)
      .get(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${radiologistToken}`);
    expect(one.status).toBe(200);
  });

  test('403 — radiologist cannot list or view pathology requests', async () => {
    const list = await request(app)
      .get('/api/lab/pathology')
      .set('Authorization', `Bearer ${radiologistToken}`);
    expect(list.status).toBe(403);

    const one = await request(app)
      .get(`/api/lab/pathology/${pathologyRequestId}`)
      .set('Authorization', `Bearer ${radiologistToken}`);
    expect(one.status).toBe(403);
  });
});

describe('Receptionist Lab access', () => {
  let pathologyRequestId: string;
  let radiologyRequestId: string;

  beforeEach(async () => {
    pathologyRequestId = uuidv4();
    radiologyRequestId = uuidv4();
    await PathologyRequestModel.create({
      requestId: pathologyRequestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, testType: 'Blood CBC',
      status: 'PENDING', requestedAt: new Date(),
    });
    await RadiologyRequestModel.create({
      requestId: radiologyRequestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, imagingType: 'X-Ray Chest',
      status: 'PENDING', requestedAt: new Date(),
    });
  });

  test('200 — receptionist can list pathology requests', async () => {
    const res = await request(app)
      .get('/api/lab/pathology')
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
  });

  test('200 — receptionist can view a pathology request', async () => {
    const res = await request(app)
      .get(`/api/lab/pathology/${pathologyRequestId}`)
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requestId).toBe(pathologyRequestId);
  });

  test('200 — receptionist can list radiology requests', async () => {
    const res = await request(app)
      .get('/api/lab/radiology')
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
  });

  test('200 — receptionist can view a radiology request', async () => {
    const res = await request(app)
      .get(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requestId).toBe(radiologyRequestId);
  });

  test('403 — receptionist cannot upload a pathology report', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${pathologyRequestId}/report`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .attach('report', Buffer.from('%PDF-1.4 test'), { filename: 'r.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
  });

  test('403 — receptionist cannot upload a radiology report', async () => {
    const res = await request(app)
      .patch(`/api/lab/radiology/${radiologyRequestId}/report`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .attach('report', Buffer.from('image'), { filename: 'r.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
  });

  test('403 — receptionist cannot delete a pathology request', async () => {
    const res = await request(app)
      .delete(`/api/lab/pathology/${pathologyRequestId}`)
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(403);
  });

  test('403 — receptionist cannot delete a radiology request', async () => {
    const res = await request(app)
      .delete(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── Test types ─────────────────────────────────────────────────────────────

describe('GET /api/lab/test-types', () => {
  test('200 — returns distinct Pathology and Radiology test types with id/name/category', async () => {
    await PathologyRequestModel.create([
      { requestId: uuidv4(), patientId: 'PAT-001', tenantId, requestedBy: doctorId, testType: 'Complete Blood Count', status: 'PENDING', priority: 'NORMAL', requestedAt: new Date() },
      { requestId: uuidv4(), patientId: 'PAT-001', tenantId, requestedBy: doctorId, testType: 'Complete Blood Count', status: 'PENDING', priority: 'NORMAL', requestedAt: new Date() },
      { requestId: uuidv4(), patientId: 'PAT-001', tenantId, requestedBy: doctorId, testType: 'Lipid Profile', status: 'PENDING', priority: 'NORMAL', requestedAt: new Date() },
    ]);
    await RadiologyRequestModel.create([
      { requestId: uuidv4(), patientId: 'PAT-001', tenantId, requestedBy: doctorId, imagingType: 'X-Ray Chest', status: 'PENDING', priority: 'NORMAL', requestedAt: new Date() },
    ]);

    const res = await request(app)
      .get('/api/lab/test-types')
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    const names = res.body.data.map((t: { name: string }) => t.name);
    expect(names).toEqual(['Complete Blood Count', 'Lipid Profile', 'X-Ray Chest']);
    const cbc = res.body.data.find((t: { name: string }) => t.name === 'Complete Blood Count');
    expect(cbc.category).toBe('PATHOLOGY');
    expect(cbc.id).toBe('PATHOLOGY:Complete Blood Count');
    const xray = res.body.data.find((t: { name: string }) => t.name === 'X-Ray Chest');
    expect(xray.category).toBe('RADIOLOGY');
    expect(xray.id).toBe('RADIOLOGY:X-Ray Chest');
  });

  test('200 — excludes soft-deleted requests and scopes by tenant', async () => {
    await PathologyRequestModel.create({
      requestId: uuidv4(), patientId: 'PAT-001', tenantId, requestedBy: doctorId,
      testType: 'Deleted Test', status: 'PENDING', priority: 'NORMAL', requestedAt: new Date(),
      isDeleted: true, deletedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/lab/test-types')
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('401 — no auth token', async () => {
    const res = await request(app).get('/api/lab/test-types');
    expect(res.status).toBe(401);
  });
});

// ─── Linked OPD/IPD encounter (View panel) ────────────────────────────────────

describe('GET /api/lab/{pathology,radiology}/:requestId — linked encounter', () => {
  const admit = (overrides: Record<string, unknown> = {}) => IPDAdmissionModel.create({
    admissionId: 'adm-enc-001', patientId: 'PAT-001', wardId: 'ward-1', bedId: 'bed-1',
    bedNumber: 'B-07', wardName: 'ICU', assignedDoctorIds: [doctorId], status: 'ADMITTED',
    admissionDate: new Date(Date.now() - 60_000), dischargeDate: null, progressNotes: [], tenantId,
    ...overrides,
  });

  test("links and returns the patient's same-day OPD visit", async () => {
    const created = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', testType: 'Blood CBC' });
    expect(created.status).toBe(201);

    const stored = await PathologyRequestModel.findOne({ requestId: created.body.data.requestId }).lean();
    expect(stored).toMatchObject({ opdVisitId: 'OPD-LABTEST01', ipdAdmissionId: null });

    const res = await request(app)
      .get(`/api/lab/pathology/${created.body.data.requestId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.encounter).toMatchObject({
      type: 'OPD', encounterId: 'OPD-LABTEST01', doctorNames: ['Lab Doctor'], wardName: null, bedNumber: null,
    });
  });

  test('links and returns the active IPD admission (with ward and bed) over a same-day OPD visit', async () => {
    await admit();
    const created = await request(app)
      .post('/api/lab/radiology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', imagingType: 'X-Ray Chest' });
    expect(created.status).toBe(201);

    const res = await request(app)
      .get(`/api/lab/radiology/${created.body.data.requestId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.encounter).toMatchObject({
      type: 'IPD', encounterId: 'adm-enc-001', wardName: 'ICU', bedNumber: 'B-07', doctorNames: ['Lab Doctor'],
    });
  });

  test('an OPD request and a later IPD request for the same patient each keep their own encounter', async () => {
    const opdReq = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', testType: 'CBC (Complete Blood Count), Thyroid Profile (T3, T4, TSH)' });
    expect(opdReq.status).toBe(201);

    await admit();
    const ipdReq = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', testType: 'Lipid Profile' });
    expect(ipdReq.status).toBe(201);

    const [opdView, ipdView] = await Promise.all([
      request(app).get(`/api/lab/pathology/${opdReq.body.data.requestId}`).set('Authorization', `Bearer ${adminToken}`),
      request(app).get(`/api/lab/pathology/${ipdReq.body.data.requestId}`).set('Authorization', `Bearer ${adminToken}`),
    ]);

    expect(opdView.body.data.testType).toBe('CBC (Complete Blood Count), Thyroid Profile (T3, T4, TSH)');
    expect(opdView.body.data.encounter).toMatchObject({
      type: 'OPD', encounterId: 'OPD-LABTEST01', wardName: null, bedNumber: null,
    });
    expect(ipdView.body.data.encounter).toMatchObject({
      type: 'IPD', encounterId: 'adm-enc-001', wardName: 'ICU', bedNumber: 'B-07',
    });
  });

  test('keeps showing the linked admission after the patient is discharged', async () => {
    await admit();
    const created = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', testType: 'Blood CBC' });
    await IPDAdmissionModel.updateOne({ admissionId: 'adm-enc-001' }, { status: 'DISCHARGED', dischargeDate: new Date() });

    const res = await request(app)
      .get(`/api/lab/pathology/${created.body.data.requestId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data.encounter).toMatchObject({ type: 'IPD', encounterId: 'adm-enc-001' });
  });

  test('legacy request (no stored link) resolves the admission in effect at requestedAt, not a later one', async () => {
    const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await admit({
      admissionId: 'adm-old', status: 'DISCHARGED',
      admissionDate: new Date(requestedAt.getTime() - 60 * 60 * 1000),
      dischargeDate: new Date(requestedAt.getTime() + 60 * 60 * 1000),
    });
    await admit({ admissionId: 'adm-current', bedId: 'bed-2' });
    const legacyId = uuidv4();
    await mongoose.connection.collection('pathology_requests').insertOne({
      requestId: legacyId, patientId: 'PAT-001', tenantId, requestedBy: doctorId,
      testType: 'Lipid Profile', referredBy: 'SELF', status: 'PENDING', priority: 'NORMAL',
      notes: null, reportS3Key: null, chargeId: null, isDeleted: false, deletedAt: null,
      requestedAt, createdAt: requestedAt, updatedAt: requestedAt,
    });

    const res = await request(app)
      .get(`/api/lab/pathology/${legacyId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.encounter).toMatchObject({ type: 'IPD', encounterId: 'adm-old' });
  });

  test('list responses are unchanged (no encounter lookup per row)', async () => {
    await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId: 'PAT-001', testType: 'Blood CBC' });

    const res = await request(app)
      .get('/api/lab/pathology')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0]).not.toHaveProperty('encounter');
  });
});

// ─── Linked-encounter list filters ────────────────────────────────────────────

describe('GET /api/lab/{pathology,radiology} — Visit Date / Admission Date / Ward / Bed filters', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const oldDate = new Date(Date.now() - 10 * DAY);

  const admit = (overrides: Record<string, unknown> = {}) => IPDAdmissionModel.create({
    admissionId: 'adm-f-1', patientId: 'PAT-001', wardId: 'ward-1', bedId: 'bed-1',
    bedNumber: 'B-07', wardName: 'ICU North', assignedDoctorIds: [doctorId], status: 'ADMITTED',
    admissionDate: new Date(), dischargeDate: null, progressNotes: [], tenantId,
    ...overrides,
  });
  const pathology = (requestId: string, link: Record<string, unknown>, requestedAt = new Date()) =>
    PathologyRequestModel.create({
      requestId, patientId: 'PAT-001', tenantId, requestedBy: doctorId,
      testType: 'Blood CBC', status: 'PENDING', requestedAt, ...link,
    });
  const list = (type: 'pathology' | 'radiology', query: Record<string, string>) =>
    request(app).get(`/api/lab/${type}`).query(query).set('Authorization', `Bearer ${adminToken}`);
  const ids = (res: request.Response) => res.body.data.data.map((r: { requestId: string }) => r.requestId).sort();

  beforeEach(async () => {
    // A second, older OPD visit and a discharged admission for the same
    // patient, so filters must use each request's own link, not the latest.
    await OPDVisitModel.create({
      visitId: 'OPD-F-OLD', tenantId, patientId: 'PAT-001', doctorIds: [doctorId],
      departmentId: null, visitDate: oldDate, queueNumber: 1, status: 'COMPLETED',
    });
    // Legacy resolution only links visits that already existed at requestedAt.
    await mongoose.connection.collection('opd_visits').updateOne(
      { visitId: 'OPD-F-OLD' }, { $set: { createdAt: new Date(oldDate.getTime() - DAY) } },
    );
    await admit({
      admissionId: 'adm-f-old', bedId: 'bed-9', bedNumber: 'B-01', wardName: 'General',
      status: 'DISCHARGED', admissionDate: new Date(oldDate.getTime() - DAY), dischargeDate: new Date(oldDate.getTime() - 60_000),
    });
    await admit();
    await pathology('opd-today', { opdVisitId: 'OPD-LABTEST01', ipdAdmissionId: null });
    await pathology('opd-old',   { opdVisitId: 'OPD-F-OLD',     ipdAdmissionId: null }, oldDate);
    await pathology('ipd-now',   { opdVisitId: null, ipdAdmissionId: 'adm-f-1' });
    await pathology('ipd-old',   { opdVisitId: null, ipdAdmissionId: 'adm-f-old' }, new Date(oldDate.getTime() - 2 * 60_000));
    await pathology('no-enc',    { opdVisitId: null, ipdAdmissionId: null });
  });

  test('visitDate matches only requests linked to an OPD visit on that IST day', async () => {
    const today = await list('pathology', { visitDate: toIstDateKey(new Date()) });
    expect(today.status).toBe(200);
    expect(ids(today)).toEqual(['opd-today']);
    expect(today.body.data.total).toBe(1);

    const old = await list('pathology', { visitDate: toIstDateKey(oldDate) });
    expect(ids(old)).toEqual(['opd-old']);
  });

  test('admissionDate matches only requests linked to an admission on that IST day', async () => {
    const res = await list('pathology', { admissionDate: toIstDateKey(new Date()) });
    expect(ids(res)).toEqual(['ipd-now']);
  });

  test('wardName (case-insensitive contains) and bedNumber (exact) use the linked admission', async () => {
    expect(ids(await list('pathology', { wardName: 'icu' }))).toEqual(['ipd-now']);
    expect(ids(await list('pathology', { wardName: 'general' }))).toEqual(['ipd-old']);
    expect(ids(await list('pathology', { bedNumber: 'b-01' }))).toEqual(['ipd-old']);
    expect(ids(await list('pathology', { bedNumber: 'B-0' }))).toEqual([]);
    expect(ids(await list('pathology', { wardName: 'ICU', bedNumber: 'B-01' }))).toEqual([]);
  });

  test('filters combine with status and search', async () => {
    await PathologyRequestModel.updateOne({ requestId: 'ipd-now' }, { status: 'COMPLETED' });
    expect(ids(await list('pathology', { wardName: 'ICU', status: 'PENDING' }))).toEqual([]);
    expect(ids(await list('pathology', { wardName: 'ICU', status: 'COMPLETED', search: 'PAT-001' }))).toEqual(['ipd-now']);
    expect(ids(await list('pathology', { wardName: 'ICU', search: 'nobody-matches' }))).toEqual([]);
  });

  test('legacy requests (no stored link) match by the encounter in effect at requestedAt', async () => {
    const insert = (requestId: string, requestedAt: Date) =>
      mongoose.connection.collection('pathology_requests').insertOne({
        requestId, patientId: 'PAT-001', tenantId, requestedBy: doctorId, testType: 'Lipid Profile',
        referredBy: 'SELF', status: 'PENDING', priority: 'NORMAL', notes: null, reportS3Key: null,
        chargeId: null, isDeleted: false, deletedAt: null, requestedAt, createdAt: requestedAt, updatedAt: requestedAt,
      });
    // During the old admission → IPD (General); on the old OPD day after discharge → OPD.
    await insert('legacy-ipd', new Date(oldDate.getTime() - 30 * 60_000));
    await insert('legacy-opd', new Date(oldDate.getTime() + 60_000));

    expect(ids(await list('pathology', { wardName: 'General' }))).toEqual(['ipd-old', 'legacy-ipd']);
    expect(ids(await list('pathology', { visitDate: toIstDateKey(oldDate) }))).toEqual(['legacy-opd', 'opd-old']);
  });

  test('radiology list applies the same filters', async () => {
    await RadiologyRequestModel.create({
      requestId: 'rad-ipd', patientId: 'PAT-001', tenantId, requestedBy: doctorId,
      imagingType: 'X-Ray Chest', status: 'PENDING', requestedAt: new Date(),
      opdVisitId: null, ipdAdmissionId: 'adm-f-1',
    });
    await RadiologyRequestModel.create({
      requestId: 'rad-opd', patientId: 'PAT-001', tenantId, requestedBy: doctorId,
      imagingType: 'MRI Brain', status: 'PENDING', requestedAt: new Date(),
      opdVisitId: 'OPD-LABTEST01', ipdAdmissionId: null,
    });
    expect(ids(await list('radiology', { bedNumber: 'B-07' }))).toEqual(['rad-ipd']);
    expect(ids(await list('radiology', { visitDate: toIstDateKey(new Date()) }))).toEqual(['rad-opd']);
  });

  test('date matches each request\'s own encounter date — OPD visit date or IPD admission date', async () => {
    const today = await list('pathology', { date: toIstDateKey(new Date()) });
    expect(today.status).toBe(200);
    expect(ids(today)).toEqual(['ipd-now', 'opd-today']);
    expect(today.body.data.total).toBe(2);

    // The old OPD visit day vs the old admission's day (one day earlier).
    expect(ids(await list('pathology', { date: toIstDateKey(oldDate) }))).toEqual(['opd-old']);
    expect(ids(await list('pathology', { date: toIstDateKey(new Date(oldDate.getTime() - DAY)) }))).toEqual(['ipd-old']);
  });

  test('date combines with Ward / Bed (IPD only) and status', async () => {
    const todayKey = toIstDateKey(new Date());
    expect(ids(await list('pathology', { date: todayKey, wardName: 'icu' }))).toEqual(['ipd-now']);
    expect(ids(await list('pathology', { date: todayKey, bedNumber: 'B-01' }))).toEqual([]);
    await PathologyRequestModel.updateOne({ requestId: 'opd-today' }, { status: 'COMPLETED' });
    expect(ids(await list('pathology', { date: todayKey, status: 'COMPLETED' }))).toEqual(['opd-today']);
  });

  test('date resolves legacy requests (no stored link) by the encounter in effect at requestedAt', async () => {
    const insert = (requestId: string, requestedAt: Date) =>
      mongoose.connection.collection('pathology_requests').insertOne({
        requestId, patientId: 'PAT-001', tenantId, requestedBy: doctorId, testType: 'Lipid Profile',
        referredBy: 'SELF', status: 'PENDING', priority: 'NORMAL', notes: null, reportS3Key: null,
        chargeId: null, isDeleted: false, deletedAt: null, requestedAt, createdAt: requestedAt, updatedAt: requestedAt,
      });
    await insert('legacy-ipd', new Date(oldDate.getTime() - 30 * 60_000));
    await insert('legacy-opd', new Date(oldDate.getTime() + 60_000));

    expect(ids(await list('pathology', { date: toIstDateKey(new Date(oldDate.getTime() - DAY)) })))
      .toEqual(['ipd-old', 'legacy-ipd']);
    expect(ids(await list('pathology', { date: toIstDateKey(oldDate) }))).toEqual(['legacy-opd', 'opd-old']);
  });

  test('radiology list applies the same date filter', async () => {
    await RadiologyRequestModel.create({
      requestId: 'rad-ipd', patientId: 'PAT-001', tenantId, requestedBy: doctorId,
      imagingType: 'X-Ray Chest', status: 'PENDING', requestedAt: new Date(),
      opdVisitId: null, ipdAdmissionId: 'adm-f-1',
    });
    await RadiologyRequestModel.create({
      requestId: 'rad-opd-old', patientId: 'PAT-001', tenantId, requestedBy: doctorId,
      imagingType: 'MRI Brain', status: 'PENDING', requestedAt: oldDate,
      opdVisitId: 'OPD-F-OLD', ipdAdmissionId: null,
    });
    expect(ids(await list('radiology', { date: toIstDateKey(new Date()) }))).toEqual(['rad-ipd']);
    expect(ids(await list('radiology', { date: toIstDateKey(oldDate) }))).toEqual(['rad-opd-old']);
  });

  test('400 — malformed date', async () => {
    const res = await list('pathology', { visitDate: '05-10-2026' });
    expect(res.status).toBe(400);
    expect((await list('pathology', { date: '2026/10/05' })).status).toBe(400);
  });
});
