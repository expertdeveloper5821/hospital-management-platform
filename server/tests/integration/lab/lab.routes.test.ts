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
import { TenantStatus, UserRole }     from '../../../src/shared/types/common.types';
import { PATHOLOGY_REPORT_MAX_BYTES, RADIOLOGY_REPORT_MAX_BYTES } from '../../../src/modules/lab/lab.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:   MongoMemoryServer;
let tenantId: string;
let doctorId: string;
let doctorToken:      string;
let pathologistToken: string;
let radiologistToken: string;

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
      addressProof:            'addr-proof-001',
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

  const sign = (id: string, role: UserRole) =>
    jwt.sign({ userId: id, tenantId, role, email: 'x@x.com', isFirstLogin: false }, JWT_SECRET);

  doctorToken      = sign(doctorId, UserRole.DOCTOR);
  pathologistToken = sign(pathologistId, UserRole.PATHOLOGIST);
  radiologistToken = sign(radiologistId, UserRole.RADIOLOGIST);
});

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

describe('PATCH /api/lab/pathology/:requestId/report', () => {
  let requestId: string;

  beforeEach(async () => {
    requestId = uuidv4();
    await PathologyRequestModel.create({
      requestId, patientId: 'PAT-001', tenantId,
      requestedBy: doctorId, testType: 'Blood CBC',
      status: 'PENDING', requestedAt: new Date(),
    });
  });

  test('uploads a pathology report and sets status to COMPLETED (200)', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}/report`)
      .set('Authorization', `Bearer ${pathologistToken}`)
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
      .set('Authorization', `Bearer ${pathologistToken}`)
      .attach('report', oversized, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(413);
  });

  test('returns 400 when no file is attached', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${requestId}/report`)
      .set('Authorization', `Bearer ${pathologistToken}`)
      .field('note', 'missing file');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no file/i);
  });

  test('returns 404 for unknown request ID', async () => {
    const res = await request(app)
      .patch(`/api/lab/pathology/${uuidv4()}/report`)
      .set('Authorization', `Bearer ${pathologistToken}`)
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
      .set('Authorization', `Bearer ${pathologistToken}`)
      .attach('report', Buffer.from('new content'), {
        filename: 'report.pdf', contentType: 'application/pdf',
      });

    expect(res.status).toBe(409);
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
