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
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { PaymentStatus, PaymentMethod } from '../../../src/modules/payment/payment.types';

const JWT_SECRET = process.env.JWT_SECRET!;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET!;

let mongod:            MongoMemoryServer;
let tenantId:          string;
let receptionistToken: string;
let managerToken:      string;
let financeToken:      string;
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
      addressProof:            'addr-001',
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

  const base = { tenantId, isFirstLogin: false };
  receptionistToken = jwt.sign({ ...base, userId: (receptionist._id as mongoose.Types.ObjectId).toString(), role: UserRole.RECEPTIONIST,  email: 'receptionist@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  managerToken      = jwt.sign({ ...base, userId: (manager._id      as mongoose.Types.ObjectId).toString(), role: UserRole.MANAGER,         email: 'manager@test.com'      }, JWT_SECRET, { expiresIn: '1h' });
  financeToken      = jwt.sign({ ...base, userId: (finance._id      as mongoose.Types.ObjectId).toString(), role: UserRole.FINANCE_MANAGER, email: 'finance@test.com'      }, JWT_SECRET, { expiresIn: '1h' });
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
