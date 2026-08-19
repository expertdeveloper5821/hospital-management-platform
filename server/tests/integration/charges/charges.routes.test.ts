import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose              from 'mongoose';
import request               from 'supertest';
import jwt                   from 'jsonwebtoken';

jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/modules/notification/notification.service', () => ({
  notificationService: {
    sendNotification: jest.fn().mockResolvedValue(undefined),
    sendToRole:       jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn().mockResolvedValue('mocked-s3-key'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.test/presigned-url'),
  },
}));
jest.mock('../../../src/shared/services/pdf.service', () => ({
  pdfService: {
    generateReceipt:     jest.fn().mockResolvedValue(Buffer.from('%PDF-test-receipt')),
    generateMedicalCard: jest.fn().mockResolvedValue(Buffer.from('%PDF-test-card')),
  },
}));

import app               from '../../../src/app';
import { UserModel }     from '../../../src/modules/user/user.model';
import { TenantModel }   from '../../../src/modules/tenant/tenant.model';
import { PatientModel }  from '../../../src/modules/patient/patient.model';
import { ChargeModel }   from '../../../src/modules/charges/charges.model';
import { PaymentModel }  from '../../../src/modules/payment/payment.model';
import { PaymentStatus } from '../../../src/modules/payment/payment.types';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:            MongoMemoryServer;
let tenantId:          string;
let patientId:         string;
let receptionistToken: string;
let hospitalAdminToken: string;

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
    name:        'Charges Test Hospital',
    adminEmail:  'admin@chargestest.com',
    status:      TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'cert-001',
      gstNumber:               'GST001',
      panCard:                 'PAN001',
      addressLine:            '111 Charges Street',
      city:                    'Mumbai',
      state:                   'Maharashtra',
      pincode:                 '400001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const patient = await PatientModel.create({
    tenantId,
    fullName:     'Test Patient',
    dateOfBirth:  new Date('1990-01-01'),
    gender:       'MALE',
    mobileNumber: '9876543210',
    address:      '123 Main St',
  });
  patientId = patient.patientId;

  const receptionist = await UserModel.create({
    tenantId, email: 'receptionist@test.com', name: 'Charge Receptionist', passwordHash: 'x',
    role: UserRole.RECEPTIONIST, isActive: true, isFirstLogin: false,
  });
  const hospitalAdmin = await UserModel.create({
    tenantId, email: 'hospitaladmin@test.com', name: 'Charge Hospital Admin', passwordHash: 'x',
    role: UserRole.HOSPITAL_ADMIN, isActive: true, isFirstLogin: false,
  });

  const base = { tenantId, isFirstLogin: false };
  receptionistToken  = jwt.sign({ ...base, userId: (receptionist._id  as mongoose.Types.ObjectId).toString(), role: UserRole.RECEPTIONIST,   email: 'receptionist@test.com'   }, JWT_SECRET, { expiresIn: '1h' });
  hospitalAdminToken = jwt.sign({ ...base, userId: (hospitalAdmin._id as mongoose.Types.ObjectId).toString(), role: UserRole.HOSPITAL_ADMIN, email: 'hospitaladmin@test.com' }, JWT_SECRET, { expiresIn: '1h' });
});

describe('POST /api/charges', () => {
  test('201 — creates a non-LAB_TEST charge without a test type', async () => {
    const res = await request(app)
      .post('/api/charges')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, category: 'CONSULTATION', description: 'Consultation fee', amount: 500 });

    expect(res.status).toBe(201);
    expect(res.body.data.testTypeId).toBeNull();
    expect(res.body.data.testTypeName).toBeNull();
  });

  test('400 — LAB_TEST charge without testTypeId/testTypeName is rejected', async () => {
    const res = await request(app)
      .post('/api/charges')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, category: 'LAB_TEST', description: 'Blood test', amount: 300 });

    expect(res.status).toBe(400);
  });

  test('400 — LAB_TEST charge with only testTypeName (missing id) is rejected', async () => {
    const res = await request(app)
      .post('/api/charges')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, category: 'LAB_TEST', description: 'Blood test', amount: 300, testTypeName: 'Complete Blood Count' });

    expect(res.status).toBe(400);
  });

  test('201 — LAB_TEST charge with testTypeId/testTypeName stores both on the charge', async () => {
    const res = await request(app)
      .post('/api/charges')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({
        patientId, category: 'LAB_TEST', description: 'Blood test', amount: 300,
        testTypeId: 'PATHOLOGY:Complete Blood Count', testTypeName: 'Complete Blood Count',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.testTypeId).toBe('PATHOLOGY:Complete Blood Count');
    expect(res.body.data.testTypeName).toBe('Complete Blood Count');

    const stored = await ChargeModel.findOne({ tenantId, chargeId: res.body.data.chargeId });
    expect(stored!.testTypeId).toBe('PATHOLOGY:Complete Blood Count');
    expect(stored!.testTypeName).toBe('Complete Blood Count');
  });

  test('201 — testTypeId/testTypeName are ignored (stored as null) for a non-LAB_TEST category', async () => {
    const res = await request(app)
      .post('/api/charges')
      .set('Authorization', `Bearer ${hospitalAdminToken}`)
      .send({
        patientId, category: 'CONSULTATION', description: 'Consultation fee', amount: 400,
        testTypeId: 'PATHOLOGY:Complete Blood Count', testTypeName: 'Complete Blood Count',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.testTypeId).toBeNull();
    expect(res.body.data.testTypeName).toBeNull();
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app)
      .post('/api/charges')
      .send({ patientId, category: 'CONSULTATION', description: 'Consultation fee', amount: 500 });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/charges/:chargeId/pay — auto-creates a Payment record', () => {
  async function addUnpaidCharge(amount = 500): Promise<string> {
    const res = await request(app)
      .post('/api/charges')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, category: 'CONSULTATION', description: 'Consultation fee', amount });
    return res.body.data.chargeId as string;
  }

  test('200 — marks the charge PAID and creates a matching CHARGE-referenced Payment', async () => {
    const chargeId = await addUnpaidCharge(650);

    const res = await request(app)
      .patch(`/api/charges/${chargeId}/pay`)
      .set('Authorization', `Bearer ${hospitalAdminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PAID');
    expect(res.body.data.paidBy).toBeTruthy();

    const payments = await PaymentModel.find({ tenantId, referenceType: 'CHARGE', referenceId: chargeId });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(650);
    expect(payments[0].patientId).toBe(patientId);
    expect(payments[0].status).toBe(PaymentStatus.COMPLETED);
  });

  test('the auto-created payment appears in GET /api/payments', async () => {
    const chargeId = await addUnpaidCharge(300);

    await request(app)
      .patch(`/api/charges/${chargeId}/pay`)
      .set('Authorization', `Bearer ${hospitalAdminToken}`)
      .send();

    const res = await request(app)
      .get('/api/payments')
      .query({ referenceType: 'CHARGE', referenceId: chargeId })
      .set('Authorization', `Bearer ${hospitalAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].amount).toBe(300);
    expect(res.body.data.data[0].referenceType).toBe('CHARGE');
  });

  test('the auto-created payment lands under "Other" in department-wise revenue', async () => {
    const chargeId = await addUnpaidCharge(400);

    await request(app)
      .patch(`/api/charges/${chargeId}/pay`)
      .set('Authorization', `Bearer ${hospitalAdminToken}`)
      .send();

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${hospitalAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.other.total).toBeGreaterThanOrEqual(400);
    expect(res.body.data.other.directPayment).toBeGreaterThanOrEqual(400);
    for (const dept of res.body.data.departments) {
      expect(dept.total).toBe(0);
    }
  });

  test('409 — marking an already-paid charge paid again does not create a duplicate Payment', async () => {
    const chargeId = await addUnpaidCharge(200);

    const first = await request(app)
      .patch(`/api/charges/${chargeId}/pay`)
      .set('Authorization', `Bearer ${hospitalAdminToken}`)
      .send();
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`/api/charges/${chargeId}/pay`)
      .set('Authorization', `Bearer ${hospitalAdminToken}`)
      .send();
    expect(second.status).toBe(409);

    const payments = await PaymentModel.find({ tenantId, referenceType: 'CHARGE', referenceId: chargeId });
    expect(payments).toHaveLength(1);
  });
});
