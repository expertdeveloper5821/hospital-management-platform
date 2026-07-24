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

import app               from '../../../src/app';
import { UserModel }     from '../../../src/modules/user/user.model';
import { TenantModel }   from '../../../src/modules/tenant/tenant.model';
import { PatientModel }  from '../../../src/modules/patient/patient.model';
import { ChargeModel }   from '../../../src/modules/charges/charges.model';
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
