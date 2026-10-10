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

import app             from '../../../src/app';
import { TenantModel }  from '../../../src/modules/tenant/tenant.model';
import { PatientModel } from '../../../src/modules/patient/patient.model';
import { PaymentModel } from '../../../src/modules/payment/payment.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import * as exportPdf from '../../../src/modules/payment/payment-export.pdf';
import { PaymentExportReport } from '../../../src/modules/payment/payment-export';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:   MongoMemoryServer;
let tenantId: string;
let patientId: string;

function tokenFor(role: UserRole, tid = tenantId): string {
  return jwt.sign(
    { tenantId: tid, isFirstLogin: false, userId: new mongoose.Types.ObjectId().toString(), role, email: `${role.toLowerCase()}@test.com` },
    JWT_SECRET, { expiresIn: '1h' },
  );
}

async function createTenant(name: string): Promise<string> {
  const tenant = await TenantModel.create({
    name, adminEmail: `admin@${name.replace(/\s/g, '').toLowerCase()}.com`, status: TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'cert', gstNumber: 'GST', panCard: 'PAN',
      addressLine: '1 Street', city: 'Pune', state: 'Maharashtra', pincode: '411001',
    },
    branding: { displayName: name, primaryColor: '#1A73E8', logoUrl: null },
  });
  return (tenant._id as mongoose.Types.ObjectId).toString();
}

let seq = 0;
function pay(overrides: Record<string, unknown>) {
  seq += 1;
  return {
    paymentId: `pay-${String(seq).padStart(6, '0')}`, tenantId, patientId, amount: 100,
    paymentMethod: 'CASH', description: 'Consultation', status: 'COMPLETED', createdBy: 'u',
    ...overrides,
  };
}

// The response is a binary PDF; the report handed to the renderer (rows and
// totals) is captured so the numbers can be asserted without parsing the PDF.
const pdfSpy = jest.spyOn(exportPdf, 'buildPaymentExportPdf');
function lastReport(): PaymentExportReport {
  return pdfSpy.mock.calls[pdfSpy.mock.calls.length - 1][0];
}

function exportReq(qs: string, role: UserRole) {
  return request(app).get(`/api/payments/export?${qs}`)
    .set('Authorization', `Bearer ${tokenFor(role)}`)
    .buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

// Summary of a report: transaction count, grand total and [count, amount] per method (rupees).
function totals(report: PaymentExportReport): Record<string, unknown> {
  return {
    count: report.rows.length,
    total: report.grandTotalPaise / 100,
    ...Object.fromEntries(Object.entries(report.methodTotals).map(([m, t]) => [m, [t.count, t.paise / 100]])),
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  pdfSpy.mockClear();
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  tenantId = await createTenant('Export Test Hospital');
  const patient = await PatientModel.create({
    tenantId, fullName: 'Ravi Kumar', dateOfBirth: new Date('1990-01-01'), gender: 'MALE',
    mobileNumber: '9876543210', address: '1 Main St',
  });
  patientId = patient.patientId;
});

describe('GET /api/payments/export', () => {
  test('returns a PDF attachment with header metadata', async () => {
    const res = await exportReq('period=CUSTOM&dateFrom=2025-03-10&dateTo=2025-03-12', UserRole.FINANCE_MANAGER);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="payments-custom-2025-03-10_to_2025-03-12.pdf"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const report = lastReport();
    expect(report.hospitalName).toBe('Export Test Hospital');
    expect(report.range).toMatchObject({ period: 'CUSTOM', fromKey: '2025-03-10', toKey: '2025-03-12' });
    expect(report.generatedBy).toBe('finance_manager@test.com');
  });

  test('day boundaries are IST: 23:59 IST is included, 00:00 IST next day is not', async () => {
    await PaymentModel.create([
      pay({ amount: 1,  createdAt: new Date('2025-03-09T18:29:59.999Z') }), // 2025-03-09 23:59 IST — before
      pay({ amount: 10, createdAt: new Date('2025-03-09T18:30:00.000Z') }), // 2025-03-10 00:00 IST — in
      pay({ amount: 20, createdAt: new Date('2025-03-10T18:29:59.999Z') }), // 2025-03-10 23:59 IST — in
      pay({ amount: 40, createdAt: new Date('2025-03-10T18:30:00.000Z') }), // 2025-03-11 00:00 IST — after
    ]);

    const res = await exportReq('period=DAILY&date=2025-03-10', UserRole.MANAGER);

    expect(res.status).toBe(200);
    expect(lastReport().rows.map((r) => r.createdAt.toISOString())).toEqual([
      '2025-03-09T18:30:00.000Z', '2025-03-10T18:29:59.999Z',
    ]);
    expect(totals(lastReport())).toMatchObject({ count: 2, total: 30 });
  });

  test('WEEKLY / MONTHLY cover the calendar week (Mon–Sun) and month', async () => {
    await PaymentModel.create([
      pay({ amount: 5,   createdAt: new Date('2025-03-02T06:00:00.000Z') }), // Sun 2 Mar — previous week
      pay({ amount: 50,  createdAt: new Date('2025-03-03T06:00:00.000Z') }), // Mon 3 Mar
      pay({ amount: 70,  createdAt: new Date('2025-03-09T06:00:00.000Z') }), // Sun 9 Mar
      pay({ amount: 900, createdAt: new Date('2025-04-01T06:00:00.000Z') }), // next month
    ]);

    await exportReq('period=WEEKLY&date=2025-03-05', UserRole.HOSPITAL_ADMIN);
    expect(lastReport().range).toMatchObject({ fromKey: '2025-03-03', toKey: '2025-03-09' });
    expect(totals(lastReport())).toMatchObject({ count: 2, total: 120 });

    await exportReq('period=MONTHLY&date=2025-03-20', UserRole.HOSPITAL_ADMIN);
    expect(lastReport().range).toMatchObject({ fromKey: '2025-03-01', toKey: '2025-03-31' });
    expect(totals(lastReport())).toMatchObject({ count: 3, total: 125 });
  });

  test('method breakdown reconciles with the grand total; only COMPLETED counts', async () => {
    const at = new Date('2025-03-10T06:00:00.000Z');
    await PaymentModel.create([
      pay({ amount: 100.25, paymentMethod: 'CASH',   createdAt: at }),
      pay({ amount: 200.5,  paymentMethod: 'CASH',   createdAt: at }),
      pay({ amount: 300,    paymentMethod: 'UPI',    createdAt: at }),
      pay({ amount: 0.1,    paymentMethod: 'CARD',   createdAt: at }),
      pay({ amount: 0.2,    paymentMethod: 'CARD',   createdAt: at }),
      pay({ amount: 1000,   paymentMethod: 'CHEQUE', createdAt: at }),
      pay({ amount: 999,    paymentMethod: 'UPI',    createdAt: at, status: 'PENDING' }),
      pay({ amount: 999,    paymentMethod: 'CARD',   createdAt: at, status: 'FAILED' }),
      pay({ amount: 999,    paymentMethod: 'CASH',   createdAt: at, status: 'CANCELLED' }),
      pay({ amount: 999,    paymentMethod: 'CASH',   createdAt: at, status: 'CANCELLED' }),
    ]);

    const res = await exportReq('period=DAILY&date=2025-03-10', UserRole.ADMIN);

    expect(res.status).toBe(200);
    const report = lastReport();
    expect(totals(report)).toEqual({
      count: 6, total: 1601.05,
      CASH: [2, 300.75], UPI: [1, 300], CARD: [2, 0.3], CHEQUE: [1, 1000],
    });
    expect(report.grandTotalPaise).toBe(report.rows.reduce((sum, r) => sum + r.amountPaise, 0));
    expect(report.excludedCounts).toEqual({ PENDING: 1, FAILED: 1, CANCELLED: 2 });

    // Totals agree with the existing /summary endpoint for the same range.
    const summary = await request(app)
      .get('/api/payments/summary?dateFrom=2025-03-09T18:30:00.000Z&dateTo=2025-03-10T18:29:59.999Z')
      .set('Authorization', `Bearer ${tokenFor(UserRole.ADMIN)}`);
    expect(summary.body.data.total).toBeCloseTo(1601.05, 2);
  });

  test('decrypts description / transactionId and resolves patient name', async () => {
    await PaymentModel.create(pay({
      paymentMethod: 'UPI', description: 'OPD Consultation, Visit #3', transactionId: 'UTR123',
      createdAt: new Date('2025-03-10T06:00:00.000Z'),
    }));
    const res = await exportReq('period=DAILY&date=2025-03-10', UserRole.ADMIN);
    expect(res.status).toBe(200);
    expect(lastReport().rows[0]).toEqual({
      paymentId: `pay-${String(seq).padStart(6, '0')}`, createdAt: new Date('2025-03-10T06:00:00.000Z'),
      patientId, patientName: 'Ravi Kumar', description: 'OPD Consultation, Visit #3',
      paymentMethod: 'UPI', transactionId: 'UTR123', amountPaise: 10000,
    });
    expect((res.body as Buffer).toString('latin1')).not.toContain('enc:v1:');
  });

  test('pagination: exports every row across multiple pages, including tied timestamps', async () => {
    const tie = new Date('2025-03-10T06:00:00.000Z');
    const docs = Array.from({ length: 1234 }, (_, i) => pay({
      amount: 1,
      paymentMethod: ['CASH', 'UPI', 'CARD'][i % 3],
      // ~half share one identical createdAt so page boundaries fall inside a tie
      createdAt: i % 2 === 0 ? tie : new Date(tie.getTime() + i * 1000),
    }));
    await PaymentModel.insertMany(docs);

    const res = await exportReq('period=DAILY&date=2025-03-10', UserRole.FINANCE_MANAGER);

    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const report = lastReport();
    expect(new Set(report.rows.map((r) => r.paymentId)).size).toBe(1234);
    expect(totals(report)).toEqual({
      count: 1234, total: 1234,
      CASH: [412, 412], UPI: [411, 411], CARD: [411, 411], CHEQUE: [0, 0],
    });
  }, 60000);

  test('never includes another tenant\'s payments', async () => {
    const otherTenant = await createTenant('Other Hospital');
    await PaymentModel.create([
      pay({ amount: 10, createdAt: new Date('2025-03-10T06:00:00.000Z') }),
      pay({ amount: 5000, tenantId: otherTenant, createdAt: new Date('2025-03-10T06:00:00.000Z') }),
    ]);
    await exportReq('period=DAILY&date=2025-03-10', UserRole.ADMIN);
    expect(totals(lastReport())).toMatchObject({ count: 1, total: 10 });
  });

  describe('access control', () => {
    test.each([UserRole.MANAGER, UserRole.FINANCE_MANAGER, UserRole.HOSPITAL_ADMIN, UserRole.ADMIN])(
      '%s can export', async (role) => {
        const res = await request(app).get('/api/payments/export?period=DAILY&date=2025-03-10').set('Authorization', `Bearer ${tokenFor(role)}`);
        expect(res.status).toBe(200);
      },
    );

    test.each([UserRole.RECEPTIONIST, UserRole.DOCTOR, UserRole.NURSE])(
      '%s is forbidden (403)', async (role) => {
        const res = await request(app).get('/api/payments/export?period=DAILY&date=2025-03-10').set('Authorization', `Bearer ${tokenFor(role)}`);
        expect(res.status).toBe(403);
      },
    );

    test('unauthenticated is 401', async () => {
      const res = await request(app).get('/api/payments/export?period=DAILY');
      expect(res.status).toBe(401);
    });
  });

  describe('validation', () => {
    const token = () => tokenFor(UserRole.ADMIN);
    test.each([
      ['missing period',            ''],
      ['unknown period',            'period=YEARLY'],
      ['custom without dates',      'period=CUSTOM'],
      ['custom reversed',           'period=CUSTOM&dateFrom=2025-03-10&dateTo=2025-03-01'],
      ['invalid calendar date',     'period=DAILY&date=2025-02-30'],
      ['wrong format',              'period=DAILY&date=10-03-2025'],
      ['future date',               'period=DAILY&date=2999-01-01'],
      ['custom range over 366 days','period=CUSTOM&dateFrom=2023-01-01&dateTo=2025-01-01'],
    ])('%s → 400', async (_label, qs) => {
      const res = await request(app).get(`/api/payments/export?${qs}`).set('Authorization', `Bearer ${token()}`);
      expect(res.status).toBe(400);
    });
  });
});
