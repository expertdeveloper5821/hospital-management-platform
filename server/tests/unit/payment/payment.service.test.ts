import crypto from 'crypto';

jest.mock('../../../src/modules/payment/payment.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/tenant/tenant.repository');
jest.mock('../../../src/shared/services/pdf.service');
jest.mock('../../../src/shared/services/s3.service');
jest.mock('../../../src/shared/services/audit.service');
jest.mock('razorpay');

import { paymentRepository } from '../../../src/modules/payment/payment.repository';
import { patientRepository } from '../../../src/modules/patient/patient.repository';
import { tenantRepository }  from '../../../src/modules/tenant/tenant.repository';
import { pdfService }        from '../../../src/shared/services/pdf.service';
import { s3Service }         from '../../../src/shared/services/s3.service';
import { PaymentService }    from '../../../src/modules/payment/payment.service';
import { PaymentStatus, PaymentMethod } from '../../../src/modules/payment/payment.types';
import { IPayment }          from '../../../src/modules/payment/payment.model';
import { IPatient }          from '../../../src/modules/patient/patient.model';
import { ITenant }           from '../../../src/modules/tenant/tenant.model';
import Razorpay              from 'razorpay';

const mockPayRepo   = paymentRepository as jest.Mocked<typeof paymentRepository>;
const mockPatRepo   = patientRepository as jest.Mocked<typeof patientRepository>;
const mockTenantRepo = tenantRepository as jest.Mocked<typeof tenantRepository>;
const mockPdf       = pdfService       as jest.Mocked<typeof pdfService>;
const mockS3        = s3Service        as jest.Mocked<typeof s3Service>;

const TENANT    = 'tenant-001';
const USER      = 'user-001';
const PATIENT_ID = 'PAT-00000001';

function makePatient(overrides: Partial<IPatient> = {}): IPatient {
  return {
    patientId:   PATIENT_ID,
    fullName:    'Priya Sharma',
    tenantId:    TENANT,
    ...overrides,
  } as unknown as IPatient;
}

function makeTenant(): ITenant {
  return {
    _id:         TENANT,
    name:        'City Hospital',
    branding: { displayName: 'City Hospital', primaryColor: '#1A73E8', logoUrl: null },
  } as unknown as ITenant;
}

function makePayment(overrides: Partial<IPayment> = {}): IPayment {
  return {
    paymentId:         'pay-uuid-001',
    tenantId:          TENANT,
    patientId:         PATIENT_ID,
    amount:            500,
    paymentMethod:     PaymentMethod.CASH,
    description:       'Consultation fee',
    status:            PaymentStatus.COMPLETED,
    receiptS3Key:      `org/${TENANT}/payments/pay-uuid-001/receipt.pdf`,
    razorpayOrderId:   null,
    razorpayPaymentId: null,
    createdBy:         USER,
    createdAt:         new Date('2026-05-19'),
    updatedAt:         new Date('2026-05-19'),
    ...overrides,
  } as unknown as IPayment;
}

// ─── createManualPayment ──────────────────────────────────────────────────────

describe('PaymentService — createManualPayment', () => {
  let service: PaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentService();
    mockPatRepo.findByPatientId = jest.fn().mockResolvedValue(makePatient());
    mockTenantRepo.findById     = jest.fn().mockResolvedValue(makeTenant());
    mockPdf.generateReceipt     = jest.fn().mockResolvedValue(Buffer.from('%PDF'));
    mockS3.uploadFile           = jest.fn().mockResolvedValue('s3-key');
    mockS3.getPresignedUrl      = jest.fn().mockResolvedValue('https://s3.test/receipt');
    mockPayRepo.save            = jest.fn().mockResolvedValue(makePayment());
  });

  test('creates payment with COMPLETED status and returns receiptUrl', async () => {
    const result = await service.createManualPayment(
      { patientId: PATIENT_ID, amount: 500, paymentMethod: PaymentMethod.CASH, description: 'Consultation fee' },
      TENANT, USER,
    );

    expect(result.status).toBe(PaymentStatus.COMPLETED);
    expect(mockPdf.generateReceipt).toHaveBeenCalledTimes(1);
    expect(mockS3.uploadFile).toHaveBeenCalledTimes(1);
    expect(mockPayRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId:     TENANT,
        status:       PaymentStatus.COMPLETED,
        paymentMethod: PaymentMethod.CASH,
      }),
    );
  });

  test('throws NotFoundError when patient does not exist', async () => {
    mockPatRepo.findByPatientId = jest.fn().mockResolvedValue(null);

    await expect(
      service.createManualPayment(
        { patientId: 'unknown', amount: 100, paymentMethod: PaymentMethod.CASH, description: 'test' },
        TENANT, USER,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockPayRepo.save).not.toHaveBeenCalled();
  });

  test('rejects zero amount via Zod schema (validated before service call)', () => {
    const { CreateManualPaymentSchema } = require('../../../src/modules/payment/payment.types');
    const result = CreateManualPaymentSchema.safeParse({
      patientId: PATIENT_ID, amount: 0, paymentMethod: 'CASH', description: 'test',
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative amount via Zod schema', () => {
    const { CreateManualPaymentSchema } = require('../../../src/modules/payment/payment.types');
    const result = CreateManualPaymentSchema.safeParse({
      patientId: PATIENT_ID, amount: -50, paymentMethod: 'CASH', description: 'test',
    });
    expect(result.success).toBe(false);
  });

  test('uploads receipt to correct S3 key path', async () => {
    await service.createManualPayment(
      { patientId: PATIENT_ID, amount: 200, paymentMethod: PaymentMethod.CHEQUE, description: 'Admission fee' },
      TENANT, USER,
    );

    const [calledKey] = (mockS3.uploadFile as jest.Mock).mock.calls[0] as [string, ...unknown[]];
    expect(calledKey).toMatch(new RegExp(`^org/${TENANT}/payments/[^/]+/receipt\\.pdf$`));
  });

  test('CHEQUE paymentMethod is accepted', async () => {
    mockPayRepo.save = jest.fn().mockResolvedValue(makePayment({ paymentMethod: PaymentMethod.CHEQUE }));

    const result = await service.createManualPayment(
      { patientId: PATIENT_ID, amount: 1000, paymentMethod: PaymentMethod.CHEQUE, description: 'Lab fee' },
      TENANT, USER,
    );

    expect(result.paymentMethod).toBe(PaymentMethod.CHEQUE);
  });
});

// ─── handleRazorpayWebhook ────────────────────────────────────────────────────

describe('PaymentService — handleRazorpayWebhook', () => {
  let service: PaymentService;
  const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET!;

  function buildWebhookBody(orderId: string): Buffer {
    return Buffer.from(JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_rzp_001', order_id: orderId, amount: 50000, method: 'upi' },
        },
      },
    }));
  }

  function signBody(body: Buffer): string {
    return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentService();
    mockS3.uploadFile       = jest.fn().mockResolvedValue('s3-key');
    mockPdf.generateReceipt = jest.fn().mockResolvedValue(Buffer.from('%PDF'));
    mockTenantRepo.findById  = jest.fn().mockResolvedValue(makeTenant());
    mockPatRepo.findByPatientId = jest.fn().mockResolvedValue(makePatient());
    mockPayRepo.update       = jest.fn().mockResolvedValue(makePayment({ status: PaymentStatus.COMPLETED }));
  });

  test('rejects webhook with invalid signature (returns 400)', async () => {
    const body = buildWebhookBody('order_test_001');
    await expect(
      service.handleRazorpayWebhook(body, 'invalid_signature_hex'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects webhook with tampered body (signature mismatch)', async () => {
    const body    = buildWebhookBody('order_test_002');
    const sig     = signBody(body);
    const tampered = Buffer.from(body.toString().replace('captured', 'TAMPERED'));

    await expect(
      service.handleRazorpayWebhook(tampered, sig),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('accepts valid signature and updates payment to COMPLETED', async () => {
    const orderId = 'order_valid_001';
    const pending = makePayment({ status: PaymentStatus.PENDING, razorpayOrderId: orderId });
    mockPayRepo.findByRazorpayOrderId = jest.fn().mockResolvedValue(pending);

    const body = buildWebhookBody(orderId);
    const sig  = signBody(body);

    await service.handleRazorpayWebhook(body, sig);

    expect(mockPayRepo.update).toHaveBeenCalledWith(
      pending.paymentId, TENANT,
      expect.objectContaining({ status: PaymentStatus.COMPLETED, razorpayPaymentId: 'pay_rzp_001' }),
    );
  });

  test('is idempotent — skips already-COMPLETED payment', async () => {
    const orderId    = 'order_already_done';
    const completed  = makePayment({ status: PaymentStatus.COMPLETED, razorpayOrderId: orderId });
    mockPayRepo.findByRazorpayOrderId = jest.fn().mockResolvedValue(completed);

    const body = buildWebhookBody(orderId);
    const sig  = signBody(body);

    await service.handleRazorpayWebhook(body, sig);

    expect(mockPayRepo.update).not.toHaveBeenCalled();
  });

  test('ignores unknown order IDs (no payment record found)', async () => {
    mockPayRepo.findByRazorpayOrderId = jest.fn().mockResolvedValue(null);

    const body = buildWebhookBody('order_unknown');
    const sig  = signBody(body);

    await expect(service.handleRazorpayWebhook(body, sig)).resolves.toBeUndefined();
    expect(mockPayRepo.update).not.toHaveBeenCalled();
  });

  test('ignores non-payment.captured events (no update)', async () => {
    const body = Buffer.from(JSON.stringify({ event: 'order.paid', payload: {} }));
    const sig  = signBody(body);

    await expect(service.handleRazorpayWebhook(body, sig)).resolves.toBeUndefined();
    expect(mockPayRepo.update).not.toHaveBeenCalled();
  });
});

// ─── getReceiptUrl ────────────────────────────────────────────────────────────

describe('PaymentService — getReceiptUrl', () => {
  let service: PaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentService();
    mockS3.getPresignedUrl = jest.fn().mockResolvedValue('https://s3.test/receipt');
  });

  test('returns pre-signed URL when receipt exists', async () => {
    mockPayRepo.findById = jest.fn().mockResolvedValue(
      makePayment({ receiptS3Key: 'org/tenant-001/payments/pay-uuid-001/receipt.pdf' }),
    );

    const url = await service.getReceiptUrl('pay-uuid-001', TENANT);
    expect(url).toBe('https://s3.test/receipt');
    expect(mockS3.getPresignedUrl).toHaveBeenCalledTimes(1);
  });

  test('throws 404 when payment not found', async () => {
    mockPayRepo.findById = jest.fn().mockResolvedValue(null);

    await expect(
      service.getReceiptUrl('non-existent', TENANT),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 404 when receipt not yet generated (PENDING Razorpay)', async () => {
    mockPayRepo.findById = jest.fn().mockResolvedValue(
      makePayment({ status: PaymentStatus.PENDING, receiptS3Key: null }),
    );

    await expect(
      service.getReceiptUrl('pay-uuid-001', TENANT),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── Razorpay orders.create mock setup ───────────────────────────────────────

describe('PaymentService — createRazorpayOrder', () => {
  let service: PaymentService;

  const mockOrdersCreate = jest.fn().mockResolvedValue({
    id: 'order_rzp_001', amount: 50000, currency: 'INR',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (Razorpay as jest.MockedClass<typeof Razorpay>).mockImplementation(() => ({
      orders: { create: mockOrdersCreate },
    }) as unknown as Razorpay);

    service = new PaymentService();
    mockPatRepo.findByPatientId = jest.fn().mockResolvedValue(makePatient());
    mockPayRepo.save = jest.fn().mockResolvedValue(makePayment({
      status: PaymentStatus.PENDING, razorpayOrderId: 'order_rzp_001',
    }));
  });

  test('returns Razorpay order details and stores PENDING record', async () => {
    const result = await service.createRazorpayOrder(
      { patientId: PATIENT_ID, amount: 500, paymentMethod: PaymentMethod.UPI, description: 'Online payment' },
      TENANT, USER,
    );

    expect(result.razorpayOrderId).toBe('order_rzp_001');
    expect(result.amountPaise).toBe(50000);
    expect(result.currency).toBe('INR');
    expect(mockPayRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.PENDING, razorpayOrderId: 'order_rzp_001' }),
    );
  });

  test('converts amount to paise correctly (multiplies by 100)', async () => {
    await service.createRazorpayOrder(
      { patientId: PATIENT_ID, amount: 750, paymentMethod: PaymentMethod.CARD, description: 'Fee' },
      TENANT, USER,
    );

    expect(mockOrdersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 75000 }),
    );
  });

  test('throws NotFoundError when patient does not exist', async () => {
    mockPatRepo.findByPatientId = jest.fn().mockResolvedValue(null);

    await expect(
      service.createRazorpayOrder(
        { patientId: 'unknown', amount: 100, paymentMethod: PaymentMethod.UPI, description: 'test' },
        TENANT, USER,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
