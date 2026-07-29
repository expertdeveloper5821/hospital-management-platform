import crypto from 'crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose              from 'mongoose';
import request               from 'supertest';
import jwt                   from 'jsonwebtoken';

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
jest.mock('../../../src/shared/services/pdf.service', () => ({
  pdfService: {
    generateReceipt:     jest.fn().mockResolvedValue(Buffer.from('%PDF-test-receipt')),
    generateMedicalCard: jest.fn().mockResolvedValue(Buffer.from('%PDF-test-card')),
  },
}));
jest.mock('razorpay', () => {
  return jest.fn().mockImplementation(() => ({
    orders: {
      create: jest.fn().mockResolvedValue({
        id:       'order_rzp_test_001',
        amount:   50000,
        currency: 'INR',
      }),
    },
  }));
});

import app            from '../../../src/app';
import { UserModel }  from '../../../src/modules/user/user.model';
import { TenantModel } from '../../../src/modules/tenant/tenant.model';
import { PatientModel } from '../../../src/modules/patient/patient.model';
import { PaymentModel } from '../../../src/modules/payment/payment.model';
import { OPDVisitModel } from '../../../src/modules/opd/opd.model';
import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
import { DepartmentModel } from '../../../src/modules/department/department.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { PaymentStatus, PaymentMethod } from '../../../src/modules/payment/payment.types';

const JWT_SECRET = process.env.JWT_SECRET!;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET!;

let mongod:            MongoMemoryServer;
let tenantId:          string;
let receptionistToken: string;
let managerToken:      string;
let financeToken:      string;
let doctorToken:       string;
let adminRoleToken:    string;
let patientId:         string;

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
    name:        'Pay Test Hospital',
    adminEmail:  'admin@paytest.com',
    status:      TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'cert-001',
      gstNumber:               'GST001',
      panCard:                 'PAN001',
      addressLine:            '111 Payment Street',
      city:                    'Mumbai',
      state:                   'Maharashtra',
      pincode:                 '400001',
    },
    branding: { displayName: 'Pay Test Hospital', primaryColor: '#1A73E8', logoUrl: null },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const patient = await PatientModel.create({
    tenantId,
    fullName:    'Test Patient',
    dateOfBirth: new Date('1990-01-01'),
    gender:      'MALE',
    mobileNumber: '9876543210',
    address:     '123 Main St',
  });
  patientId = patient.patientId;

  const receptionist = await UserModel.create({
    tenantId, email: 'receptionist@test.com', name: 'Pay Receptionist', passwordHash: 'x',
    role: UserRole.RECEPTIONIST, isActive: true, isFirstLogin: false,
  });
  const manager = await UserModel.create({
    tenantId, email: 'manager@test.com', name: 'Pay Manager', passwordHash: 'x',
    role: UserRole.MANAGER, isActive: true, isFirstLogin: false,
  });
  const finance = await UserModel.create({
    tenantId, email: 'finance@test.com', name: 'Pay Finance', passwordHash: 'x',
    role: UserRole.FINANCE_MANAGER, isActive: true, isFirstLogin: false,
  });
  const doctor = await UserModel.create({
    tenantId, email: 'doctor@test.com', name: 'Pay Doctor', passwordHash: 'x',
    role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
  });
  const adminRole = await UserModel.create({
    tenantId, email: 'adminrole@test.com', name: 'Pay Admin Role', passwordHash: 'x',
    role: UserRole.ADMIN, isActive: true, isFirstLogin: false,
  });

  const base = { tenantId, isFirstLogin: false };
  receptionistToken = jwt.sign({ ...base, userId: (receptionist._id as mongoose.Types.ObjectId).toString(), role: UserRole.RECEPTIONIST,  email: 'receptionist@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  managerToken      = jwt.sign({ ...base, userId: (manager._id      as mongoose.Types.ObjectId).toString(), role: UserRole.MANAGER,         email: 'manager@test.com'      }, JWT_SECRET, { expiresIn: '1h' });
  financeToken      = jwt.sign({ ...base, userId: (finance._id      as mongoose.Types.ObjectId).toString(), role: UserRole.FINANCE_MANAGER, email: 'finance@test.com'      }, JWT_SECRET, { expiresIn: '1h' });
  doctorToken       = jwt.sign({ ...base, userId: (doctor._id       as mongoose.Types.ObjectId).toString(), role: UserRole.DOCTOR,          email: 'doctor@test.com'       }, JWT_SECRET, { expiresIn: '1h' });
  adminRoleToken    = jwt.sign({ ...base, userId: (adminRole._id    as mongoose.Types.ObjectId).toString(), role: UserRole.ADMIN,           email: 'adminrole@test.com'    }, JWT_SECRET, { expiresIn: '1h' });
});

// ─── U5-B-07: Manual payment endpoints ───────────────────────────────────────

describe('POST /api/payments/manual', () => {
  test('creates a COMPLETED payment and returns receipt URL', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 500, paymentMethod: 'CASH', description: 'Consultation fee' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.status).toBe(PaymentStatus.COMPLETED);
    expect(res.body.data.paymentMethod).toBe(PaymentMethod.CASH);
    expect(res.body.data.receiptUrl).toBe('https://s3.test/presigned-url');
  });

  test('rejects zero amount with 400', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 0, paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(400);
  });

  test('rejects negative amount with 400', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: -100, paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(400);
  });

  test('accepts UPI method (CASH, CHEQUE, UPI, CARD all valid for manual)', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 100, paymentMethod: 'UPI', description: 'Fee' });

    expect(res.status).toBe(201);
  });

  test('returns 404 for unknown patient', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: 'PAT-UNKNOWN', amount: 100, paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(404);
  });

  test('Finance Manager can create manual payment', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ patientId, amount: 250, paymentMethod: 'CHEQUE', description: 'Lab fee' });

    expect(res.status).toBe(201);
  });

  test('Manager cannot create manual payment (403)', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ patientId, amount: 100, paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(403);
  });

  test('rejects empty description with 400', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 100, paymentMethod: 'CASH', description: '' });

    expect(res.status).toBe(400);
  });

  test('rejects description exceeding maximum length (400)', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 100, paymentMethod: 'CASH', description: 'A'.repeat(501) });

    expect(res.status).toBe(400);
  });

  test('trims leading/trailing whitespace from description', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 100, paymentMethod: 'CASH', description: '  Consultation fee  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBe('Consultation fee');
  });

  // ─── OPD payment amount fix ─────────────────────────────────────────────────

  test.each(['CASH', 'UPI', 'CARD'] as const)(
    'saves and returns the exact ₹500 amount entered for %s',
    async (paymentMethod) => {
      const res = await request(app)
        .post('/api/payments/manual')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          patientId, amount: 500, paymentMethod, description: 'OPD Consultation – Visit #1',
          referenceType: 'OPD_VISIT', referenceId: 'OPD-TESTVISIT1',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe(500);

      const stored = await PaymentModel.findOne({ paymentId: res.body.data.paymentId });
      expect(stored?.amount).toBe(500);
    },
  );

  test('saves and returns a decimal amount (₹500.50) exactly', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 500.5, paymentMethod: 'CASH', description: 'OPD Consultation' });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(500.5);

    const stored = await PaymentModel.findOne({ paymentId: res.body.data.paymentId });
    expect(stored?.amount).toBe(500.5);
  });

  test('rejects an amount with more than 2 decimal places (400)', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 500.505, paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(400);
  });

  test('accepts a 10-digit amount (201)', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 9999999999, paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(9999999999);
  });

  test('rejects an amount exceeding 10 digits (400)', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 12345678901, paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Amount cannot exceed 10 digits\./);
  });

  test('rejects a non-numeric amount (400)', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: '500', paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(400);
  });

  test('rejects an empty/missing amount (400)', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(400);
  });

  test('stores referenceType/referenceId when provided, so the payment can be looked up by exact visit', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({
        patientId, amount: 500, paymentMethod: 'UPI', description: 'OPD Consultation – Visit #1',
        referenceType: 'OPD_VISIT', referenceId: 'OPD-ABCD1234',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.referenceType).toBe('OPD_VISIT');
    expect(res.body.data.referenceId).toBe('OPD-ABCD1234');
  });

  // Reproduces the reported bug: a patient with a same-day registration-fee
  // payment AND an OPD consultation payment must not have the two amounts
  // conflated when looking up "the payment for this visit".
  test('a same-day registration-fee payment does not leak into the OPD visit payment lookup', async () => {
    await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 3, paymentMethod: 'CASH', description: 'Patient Registration Fee' });

    const opdPayment = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({
        patientId, amount: 500, paymentMethod: 'UPI', description: 'OPD Consultation – Visit #1',
        referenceType: 'OPD_VISIT', referenceId: 'OPD-SAMEDAY01',
      });
    expect(opdPayment.status).toBe(201);

    const res = await request(app)
      .get('/api/payments?referenceType=OPD_VISIT&referenceId=OPD-SAMEDAY01')
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].amount).toBe(500);
  });
});

// ─── U5-C-06: Razorpay order creation ────────────────────────────────────────

describe('POST /api/payments/razorpay-order', () => {
  test('creates a Razorpay order and stores PENDING payment', async () => {
    const res = await request(app)
      .post('/api/payments/razorpay-order')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 500, paymentMethod: 'UPI', description: 'Online payment' });

    expect(res.status).toBe(201);
    expect(res.body.data.razorpayOrderId).toBe('order_rzp_test_001');
    expect(res.body.data.amountPaise).toBe(50000);
    expect(res.body.data.currency).toBe('INR');

    const stored = await PaymentModel.findOne({ razorpayOrderId: 'order_rzp_test_001' });
    expect(stored?.status).toBe(PaymentStatus.PENDING);
  });

  test('rejects CASH method for Razorpay order', async () => {
    const res = await request(app)
      .post('/api/payments/razorpay-order')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 100, paymentMethod: 'CASH', description: 'Fee' });

    expect(res.status).toBe(400);
  });

  test('rejects an amount exceeding 10 digits (400)', async () => {
    const res = await request(app)
      .post('/api/payments/razorpay-order')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId, amount: 12345678901, paymentMethod: 'UPI', description: 'Fee' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Amount cannot exceed 10 digits\./);
  });
});

// ─── GET /api/payments ────────────────────────────────────────────────────────

describe('GET /api/payments', () => {
  test('returns paginated payment list for Manager', async () => {
    // Create a payment first
    await PaymentModel.create({
      paymentId:    'pay-test-001',
      tenantId,
      patientId,
      amount:       300,
      paymentMethod: PaymentMethod.CASH,
      description:  'Test',
      status:       PaymentStatus.COMPLETED,
      receiptS3Key: 'key',
      createdBy:    'user-001',
    });

    const res = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
  });

  test('filters by paymentMethod', async () => {
    await PaymentModel.create([
      { paymentId: 'pay-cash-001', tenantId, patientId, amount: 100, paymentMethod: 'CASH',   description: 'A', status: 'COMPLETED', receiptS3Key: 'k1', createdBy: 'u' },
      { paymentId: 'pay-chq-001',  tenantId, patientId, amount: 200, paymentMethod: 'CHEQUE', description: 'B', status: 'COMPLETED', receiptS3Key: 'k2', createdBy: 'u' },
    ]);

    const res = await request(app)
      .get('/api/payments?paymentMethod=CASH')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].paymentMethod).toBe('CASH');
  });

  test('Doctor cannot view payment data (403) — OPD/IPD sidebar must not fetch it for this role', async () => {
    await PaymentModel.create({
      paymentId:    'pay-test-doc-001',
      tenantId,
      patientId,
      amount:       300,
      paymentMethod: PaymentMethod.CASH,
      description:  'Test',
      status:       PaymentStatus.COMPLETED,
      receiptS3Key: 'key',
      createdBy:    'user-001',
    });

    const res = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });
});

// ─── GET /api/payments/summary ────────────────────────────────────────────────

describe('GET /api/payments/summary', () => {
  test('returns totals broken down by payment method', async () => {
    await PaymentModel.create([
      { paymentId: 'p1', tenantId, patientId, amount: 500,  paymentMethod: 'CASH',   description: 'A', status: 'COMPLETED', receiptS3Key: 'k1', createdBy: 'u' },
      { paymentId: 'p2', tenantId, patientId, amount: 1000, paymentMethod: 'CASH',   description: 'B', status: 'COMPLETED', receiptS3Key: 'k2', createdBy: 'u' },
      { paymentId: 'p3', tenantId, patientId, amount: 750,  paymentMethod: 'CHEQUE', description: 'C', status: 'COMPLETED', receiptS3Key: 'k3', createdBy: 'u' },
      { paymentId: 'p4', tenantId, patientId, amount: 200,  paymentMethod: 'UPI',    description: 'D', status: 'PENDING',   receiptS3Key: null, createdBy: 'u' },
    ]);

    const res = await request(app)
      .get('/api/payments/summary')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.CASH).toBe(1500);
    expect(res.body.data.CHEQUE).toBe(750);
    expect(res.body.data.UPI).toBe(0);    // PENDING excluded
    expect(res.body.data.total).toBe(2250);
  });

  test('returns zeros when no completed payments', async () => {
    const res = await request(app)
      .get('/api/payments/summary')
      .set('Authorization', `Bearer ${financeToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.CASH).toBe(0);
    expect(res.body.data.total).toBe(0);
  });

  test('Receptionist cannot access summary (403)', async () => {
    const res = await request(app)
      .get('/api/payments/summary')
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/payments/summary/by-department ─────────────────────────────────

describe('GET /api/payments/summary/by-department', () => {
  async function seedDepartment(name: string) {
    const dept = await DepartmentModel.create({ departmentId: `dept-${name}`, tenantId, name });
    return dept.departmentId;
  }

  async function seedOpdVisit(departmentId: string | null, visitId: string) {
    await OPDVisitModel.create({
      visitId, tenantId, patientId, departmentId,
      doctorIds: [], visitDate: new Date(), queueNumber: 1, status: 'OPEN',
    });
  }

  async function seedIpdAdmission(departmentId: string | null, admissionId: string) {
    await IPDAdmissionModel.create({
      admissionId, tenantId, patientId, departmentId,
      wardId: 'ward-1', bedId: 'bed-1', bedNumber: '1', wardName: 'Ward A',
    });
  }

  test('returns every active department with ₹0 when there are no payments', async () => {
    await seedDepartment('Cardiology');
    await seedDepartment('Radiology');

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.departments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Cardiology', total: 0 }),
        expect.objectContaining({ name: 'Radiology', total: 0 }),
      ]),
    );
    expect(res.body.data.otherTotal).toBe(0);
    expect(res.body.data.grandTotal).toBe(0);
  });

  test('maps OPD-visit and IPD-admission payments to their department, buckets referenceType-less payments as unassigned, and leaves untouched departments at ₹0', async () => {
    const cardiologyId = await seedDepartment('Cardiology');
    const radiologyId  = await seedDepartment('Radiology');
    await seedDepartment('Neurology'); // no revenue at all

    await seedOpdVisit(cardiologyId, 'OPD-DEPT001');
    await seedIpdAdmission(radiologyId, 'ADM-DEPT001');

    await PaymentModel.create([
      // OPD_VISIT → Cardiology
      { paymentId: 'p1', tenantId, patientId, amount: 500, paymentMethod: 'CASH', description: 'OPD', status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT001', createdBy: 'u' },
      // IPD_ADMISSION → Radiology
      { paymentId: 'p2', tenantId, patientId, amount: 800, paymentMethod: 'CARD', description: 'IPD', status: 'COMPLETED', referenceType: 'IPD_ADMISSION', referenceId: 'ADM-DEPT001', createdBy: 'u' },
      // No referenceType at all (e.g. registration fee) → unassigned, since this patient has no departmentId
      { paymentId: 'p3', tenantId, patientId, amount: 300, paymentMethod: 'UPI', description: 'Registration', status: 'COMPLETED', createdBy: 'u' },
      // PENDING — must be excluded from revenue entirely
      { paymentId: 'p4', tenantId, patientId, amount: 999, paymentMethod: 'CASH', description: 'Pending', status: 'PENDING', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT001', createdBy: 'u' },
      // FAILED — must be excluded
      { paymentId: 'p5', tenantId, patientId, amount: 999, paymentMethod: 'CASH', description: 'Failed', status: 'FAILED', createdBy: 'u' },
      // CANCELLED — must be excluded
      { paymentId: 'p6', tenantId, patientId, amount: 999, paymentMethod: 'CASH', description: 'Cancelled', status: 'CANCELLED', createdBy: 'u' },
    ]);

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      (res.body.data.departments as Array<{ name: string; total: number }>).map((d) => [d.name, d.total]),
    );
    expect(byName['Cardiology']).toBe(500);
    expect(byName['Radiology']).toBe(800);
    expect(byName['Neurology']).toBe(0); // department exists but never appears on any payment
    expect(res.body.data.otherTotal).toBe(300);
    expect(res.body.data.grandTotal).toBe(1600); // 500 + 800 + 300 — pending/failed/cancelled excluded

    // Invariant: department revenue always reconciles with the grand total.
    const departmentSum = (res.body.data.departments as Array<{ total: number }>)
      .reduce((sum, d) => sum + d.total, 0);
    expect(departmentSum + res.body.data.otherTotal).toBe(res.body.data.grandTotal);
  });

  test('an OPD visit with no department assigned is safely bucketed as unassigned, not dropped or errored', async () => {
    await seedDepartment('Cardiology');
    await seedOpdVisit(null, 'OPD-NODEPT01'); // old/legacy visit with no department

    await PaymentModel.create({
      paymentId: 'p1', tenantId, patientId, amount: 400, paymentMethod: 'CASH', description: 'OPD',
      status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-NODEPT01', createdBy: 'u',
    });

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.otherTotal).toBe(400);
    expect(res.body.data.grandTotal).toBe(400);
  });

  test('a payment referencing an OPD visit that no longer exists is safely bucketed as unassigned', async () => {
    await seedDepartment('Cardiology');
    // No matching OPDVisit document at all — simulates a data gap/old record.
    await PaymentModel.create({
      paymentId: 'p1', tenantId, patientId, amount: 250, paymentMethod: 'CASH', description: 'OPD',
      status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-MISSING', createdBy: 'u',
    });

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.otherTotal).toBe(250);
    expect(res.body.data.grandTotal).toBe(250);
  });

  test('revenue mapped to a since-deleted department folds into unassigned instead of vanishing', async () => {
    const cardiologyId = await seedDepartment('Cardiology');
    await seedOpdVisit(cardiologyId, 'OPD-DEPT002');
    await PaymentModel.create({
      paymentId: 'p1', tenantId, patientId, amount: 600, paymentMethod: 'CASH', description: 'OPD',
      status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT002', createdBy: 'u',
    });

    await DepartmentModel.updateOne({ departmentId: cardiologyId }, { $set: { isDeleted: true, deletedAt: new Date() } });

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.departments).toHaveLength(0); // Cardiology no longer active
    expect(res.body.data.otherTotal).toBe(600);
    expect(res.body.data.grandTotal).toBe(600);
  });

  test('applies the dateFrom/dateTo filters, matching the payments list', async () => {
    const cardiologyId = await seedDepartment('Cardiology');
    await seedOpdVisit(cardiologyId, 'OPD-DEPT003');

    const inRange  = await PaymentModel.create({
      paymentId: 'p1', tenantId, patientId, amount: 500, paymentMethod: 'CASH', description: 'In range',
      status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT003', createdBy: 'u',
    });
    await PaymentModel.create({
      paymentId: 'p2', tenantId, patientId, amount: 900, paymentMethod: 'CASH', description: 'Out of range',
      status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT003', createdBy: 'u',
    });
    // Push p2 outside the query window. Mongoose's timestamps plugin silently
    // ignores an explicit `createdAt` in a regular updateOne, so go through
    // the native driver collection to actually backdate it.
    await PaymentModel.collection.updateOne({ paymentId: 'p2' }, { $set: { createdAt: new Date('2020-01-01') } });

    const dateFrom = new Date(inRange.createdAt.getTime() - 60_000).toISOString();
    const dateTo   = new Date(inRange.createdAt.getTime() + 60_000).toISOString();

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .query({ dateFrom, dateTo })
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.grandTotal).toBe(500);
  });

  test('applies the paymentMethod filter', async () => {
    const cardiologyId = await seedDepartment('Cardiology');
    await seedOpdVisit(cardiologyId, 'OPD-DEPT004');
    await PaymentModel.create([
      { paymentId: 'p1', tenantId, patientId, amount: 500, paymentMethod: 'CASH', description: 'Cash', status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT004', createdBy: 'u' },
      { paymentId: 'p2', tenantId, patientId, amount: 700, paymentMethod: 'UPI',  description: 'UPI',  status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT004', createdBy: 'u' },
    ]);

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .query({ paymentMethod: 'CASH' })
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.grandTotal).toBe(500);
  });

  test('defaults to COMPLETED-only revenue, but an explicit status filter overrides that default', async () => {
    const cardiologyId = await seedDepartment('Cardiology');
    await seedOpdVisit(cardiologyId, 'OPD-DEPT005');
    await PaymentModel.create([
      { paymentId: 'p1', tenantId, patientId, amount: 500, paymentMethod: 'CASH', description: 'Completed', status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT005', createdBy: 'u' },
      { paymentId: 'p2', tenantId, patientId, amount: 250, paymentMethod: 'CASH', description: 'Pending',   status: 'PENDING',   referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT005', createdBy: 'u' },
    ]);

    const defaultRes = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(defaultRes.body.data.grandTotal).toBe(500);

    const pendingRes = await request(app)
      .get('/api/payments/summary/by-department')
      .query({ status: 'PENDING' })
      .set('Authorization', `Bearer ${managerToken}`);
    expect(pendingRes.body.data.grandTotal).toBe(250);
  });

  test('tenant isolation — another tenant\'s departments and payments never appear', async () => {
    const otherTenant = await TenantModel.create({
      name: 'Other Hospital', adminEmail: 'admin@other.com', status: TenantStatus.ACTIVE,
      onboardingDocuments: {
        registrationCertificate: 'cert-002', gstNumber: 'GST002', panCard: 'PAN002',
        addressLine: '2 Other Rd', city: 'Delhi', state: 'Delhi', pincode: '110001',
      },
      branding: { displayName: 'Other Hospital', primaryColor: '#000000', logoUrl: null },
    });
    const otherTenantId = (otherTenant._id as mongoose.Types.ObjectId).toString();
    await DepartmentModel.create({ departmentId: 'dept-other', tenantId: otherTenantId, name: 'OtherDept' });
    await PaymentModel.create({
      paymentId: 'p-other', tenantId: otherTenantId, patientId: 'PAT-OTHER', amount: 5000,
      paymentMethod: 'CASH', description: 'Other tenant', status: 'COMPLETED', createdBy: 'u',
    });

    await seedDepartment('Cardiology');

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.departments).toHaveLength(1);
    expect(res.body.data.departments[0].name).toBe('Cardiology');
    expect(res.body.data.grandTotal).toBe(0);
  });

  test('multiple payments for the same department are summed once each, never double-counted', async () => {
    const cardiologyId = await seedDepartment('Cardiology');
    await seedOpdVisit(cardiologyId, 'OPD-DEPT006');
    await seedIpdAdmission(cardiologyId, 'ADM-DEPT006');

    await PaymentModel.create([
      { paymentId: 'p1', tenantId, patientId, amount: 100, paymentMethod: 'CASH', description: 'OPD 1', status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT006', createdBy: 'u' },
      { paymentId: 'p2', tenantId, patientId, amount: 200, paymentMethod: 'CASH', description: 'OPD 2', status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-DEPT006', createdBy: 'u' },
      { paymentId: 'p3', tenantId, patientId, amount: 300, paymentMethod: 'CASH', description: 'IPD 1', status: 'COMPLETED', referenceType: 'IPD_ADMISSION', referenceId: 'ADM-DEPT006', createdBy: 'u' },
    ]);

    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    const cardiology = (res.body.data.departments as Array<{ name: string; total: number }>)
      .find((d) => d.name === 'Cardiology');
    // Exactly 100 + 200 + 300 — each payment counted once, not per-lookup or per-request.
    expect(cardiology?.total).toBe(600);
    expect(res.body.data.grandTotal).toBe(600);

    // Fetching again must not accumulate/duplicate totals.
    const res2 = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res2.body.data.grandTotal).toBe(600);
  });

  test('Manager, Finance Manager, and Admin can access; Receptionist and Doctor cannot', async () => {
    await seedDepartment('Cardiology');

    const okRoles = [managerToken, financeToken, adminRoleToken];
    for (const token of okRoles) {
      const res = await request(app)
        .get('/api/payments/summary/by-department')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    }

    for (const token of [receptionistToken, doctorToken]) {
      const res = await request(app)
        .get('/api/payments/summary/by-department')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/payments/summary/by-department');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/payments/:paymentId/receipt ─────────────────────────────────────

describe('GET /api/payments/:paymentId/receipt', () => {
  test('returns pre-signed receipt URL', async () => {
    const payUuid = '550e8400-e29b-41d4-a716-446655440000';
    await PaymentModel.create({
      paymentId:    payUuid,
      tenantId,
      patientId,
      amount:       500,
      paymentMethod: 'CASH',
      description:  'Test',
      status:       'COMPLETED',
      receiptS3Key: `org/${tenantId}/payments/${payUuid}/receipt.pdf`,
      createdBy:    'user-001',
    });

    const res = await request(app)
      .get(`/api/payments/${payUuid}/receipt`)
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.receiptUrl).toBe('https://s3.test/presigned-url');
  });
});

// ─── ADMIN role — payment access (parity with HOSPITAL_ADMIN) ────────────────

describe('ADMIN role — payment access', () => {
  test('ADMIN can create a manual payment (201)', async () => {
    const res = await request(app)
      .post('/api/payments/manual')
      .set('Authorization', `Bearer ${adminRoleToken}`)
      .send({ patientId, amount: 500, paymentMethod: 'CASH', description: 'Consultation fee' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(PaymentStatus.COMPLETED);
  });

  test('ADMIN can create a Razorpay order (201)', async () => {
    const res = await request(app)
      .post('/api/payments/razorpay-order')
      .set('Authorization', `Bearer ${adminRoleToken}`)
      .send({ patientId, amount: 500, paymentMethod: 'UPI', description: 'Online payment' });

    expect(res.status).toBe(201);
  });

  test('ADMIN can list payments (200)', async () => {
    await PaymentModel.create({
      paymentId:    'pay-admin-role-001',
      tenantId,
      patientId,
      amount:       300,
      paymentMethod: PaymentMethod.CASH,
      description:  'Test',
      status:       PaymentStatus.COMPLETED,
      receiptS3Key: 'key',
      createdBy:    'user-001',
    });

    const res = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${adminRoleToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
  });

  test('ADMIN can access the payment summary (200)', async () => {
    const res = await request(app)
      .get('/api/payments/summary')
      .set('Authorization', `Bearer ${adminRoleToken}`);

    expect(res.status).toBe(200);
  });

  test('ADMIN can access a receipt URL (200)', async () => {
    const payUuid = '650e8400-e29b-41d4-a716-446655440001';
    await PaymentModel.create({
      paymentId:    payUuid,
      tenantId,
      patientId,
      amount:       500,
      paymentMethod: 'CASH',
      description:  'Test',
      status:       'COMPLETED',
      receiptS3Key: `org/${tenantId}/payments/${payUuid}/receipt.pdf`,
      createdBy:    'user-001',
    });

    const res = await request(app)
      .get(`/api/payments/${payUuid}/receipt`)
      .set('Authorization', `Bearer ${adminRoleToken}`);

    expect(res.status).toBe(200);
  });
});

// ─── POST /api/webhooks/razorpay ──────────────────────────────────────────────

describe('POST /api/webhooks/razorpay', () => {
  function buildCapture(orderId: string): Buffer {
    return Buffer.from(JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_rzp_webhook_001', order_id: orderId, amount: 50000, method: 'upi' },
        },
      },
    }));
  }

  function sign(body: Buffer): string {
    // Sign the string form — same bytes that express.raw() will reassemble from the HTTP stream
    return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body.toString()).digest('hex');
  }

  test('returns 400 for missing signature header', async () => {
    const body = buildCapture('order_test');
    const res  = await request(app)
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid signature', async () => {
    const body = buildCapture('order_bad_sig');
    const res  = await request(app)
      .post('/api/webhooks/razorpay')
      .type('application/json')
      .set('x-razorpay-signature', 'deadbeef')
      .send(body.toString());

    expect(res.status).toBe(400);
  });

  test('accepts valid signature and marks PENDING payment as COMPLETED', async () => {
    const orderId = 'order_webhook_happy';
    await PaymentModel.create({
      paymentId:      'pay-webhook-001',
      tenantId,
      patientId,
      amount:         500,
      paymentMethod:  'UPI',
      description:    'Online',
      status:         'PENDING',
      receiptS3Key:   null,
      razorpayOrderId: orderId,
      createdBy:      'user-001',
    });

    const body = buildCapture(orderId);
    const sig  = sign(body);

    // Send as string — supertest JSON-serialises Buffers when Content-Type is application/json,
    // changing the body bytes and breaking the HMAC check. Sending the string gives the same bytes.
    const res = await request(app)
      .post('/api/webhooks/razorpay')
      .type('application/json')
      .set('x-razorpay-signature', sig)
      .send(body.toString());

    expect(res.status).toBe(200);

    const updated = await PaymentModel.findOne({ razorpayOrderId: orderId });
    expect(updated?.status).toBe(PaymentStatus.COMPLETED);
    expect(updated?.razorpayPaymentId).toBe('pay_rzp_webhook_001');
  });
});
