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
    deleteFile:      jest.fn().mockResolvedValue(undefined),
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
import { PaymentModel }     from '../../../src/modules/payment/payment.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../../../src/modules/lab/lab.model';
import { TenantStatus, UserRole }  from '../../../src/shared/types/common.types';
import { auditService }     from '../../../src/shared/services/audit.service';
import { s3Service }        from '../../../src/shared/services/s3.service';
import { pdfService }       from '../../../src/shared/services/pdf.service';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:   MongoMemoryServer;
let tenantId: string;
let otherTenantId: string;
let doctorId: string;
const tokens: Partial<Record<UserRole, string>> = {};
let otherTenantReceptionistToken: string;
let pathologyRequestId: string;
let radiologyRequestId: string;

const PATIENT_ID = 'PAT-001';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Make sure the partial unique index exists before the concurrency tests run.
  await PaymentModel.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function createTenant(name: string, email: string, registrationCertificate: string): Promise<string> {
  const tenant = await TenantModel.create({
    name, adminEmail: email, status: TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate,
      gstNumber: 'GST001', panCard: 'PAN001',
      addressLine: '321 Lab Street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001',
    },
  });
  return (tenant._id as mongoose.Types.ObjectId).toString();
}

async function createUser(tid: string, role: UserRole, name: string): Promise<string> {
  const user = await UserModel.create({
    tenantId: tid, email: `${role.toLowerCase()}-${uuidv4()}@test.com`, name, passwordHash: 'x',
    role, isActive: true, isFirstLogin: false,
  });
  return (user._id as mongoose.Types.ObjectId).toString();
}

const sign = (tid: string, id: string, role: UserRole) =>
  jwt.sign({ userId: id, tenantId: tid, role, email: 'x@x.com', isFirstLogin: false }, JWT_SECRET);

beforeEach(async () => {
  jest.clearAllMocks();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );

  tenantId      = await createTenant('Lab Pay Hospital', 'admin@labpay.com', 'REG-2026-0042');
  otherTenantId = await createTenant('Other Hospital',   'admin@other.com',  'REG-OTHER');

  doctorId = await createUser(tenantId, UserRole.DOCTOR, 'Dr. Referrer');
  for (const role of [
    UserRole.RECEPTIONIST, UserRole.HOSPITAL_ADMIN, UserRole.NURSE, UserRole.PATHOLOGIST,
    UserRole.RADIOLOGIST, UserRole.MANAGER, UserRole.ADMIN, UserRole.FINANCE_MANAGER,
  ]) {
    const name = role === UserRole.RECEPTIONIST ? 'Front Desk Receptionist' : `User ${role}`;
    tokens[role] = sign(tenantId, await createUser(tenantId, role, name), role);
  }
  tokens[UserRole.DOCTOR] = sign(tenantId, doctorId, UserRole.DOCTOR);
  otherTenantReceptionistToken = sign(
    otherTenantId, await createUser(otherTenantId, UserRole.RECEPTIONIST, 'Other Desk'), UserRole.RECEPTIONIST,
  );

  await PatientModel.create({
    patientId: PATIENT_ID, tenantId, fullName: 'John Doe', age: 46,
    dateOfBirth: new Date('1980-01-01'), gender: 'MALE',
    mobileNumber: '9876543210', address: '123 Test Street',
  });
  await PatientModel.create({
    patientId: 'PAT-002', tenantId, fullName: 'Jane Roe',
    dateOfBirth: new Date('1990-01-01'), gender: 'FEMALE',
    mobileNumber: '9123456780', address: '456 Test Street',
  });

  pathologyRequestId = uuidv4();
  radiologyRequestId = uuidv4();
  await PathologyRequestModel.create({
    requestId: pathologyRequestId, patientId: PATIENT_ID, tenantId,
    requestedBy: doctorId, referredBy: doctorId, testType: 'Complete Blood Count',
    status: 'PENDING', requestedAt: new Date(),
  });
  await RadiologyRequestModel.create({
    requestId: radiologyRequestId, patientId: PATIENT_ID, tenantId,
    requestedBy: doctorId, imagingType: 'X-Ray Chest',
    status: 'PENDING', requestedAt: new Date(),
  });
});

const collect = (kind: 'pathology' | 'radiology', id: string, token: string | undefined, body: object) => {
  const req = request(app).post(`/api/lab/${kind}/${id}/payment`);
  return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
};

const VALID_BODY = { amount: 450, paymentMethod: 'CASH' };

// ─── Happy path & linkage ──────────────────────────────────────────────────────

describe('POST /api/lab/:type/:requestId/payment — collection', () => {
  test('201 — receptionist collects a pathology payment linked to the request and its patient', async () => {
    const res = await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      patientId:     PATIENT_ID,
      amount:        450,
      paymentMethod: 'CASH',
      status:        'COMPLETED',
      referenceType: 'PATHOLOGY_REQUEST',
      referenceId:   pathologyRequestId,
      description:   'Pathology – Complete Blood Count',
    });
    expect(res.body.data.receiptUrl).toBe('https://s3.test/presigned-url');

    const rows = await PaymentModel.find({ tenantId, referenceId: pathologyRequestId });
    expect(rows).toHaveLength(1);
    expect(rows[0].patientId).toBe(PATIENT_ID);
    expect(rows[0].receiptS3Key).toBe(`org/${tenantId}/payments/${rows[0].paymentId}/receipt.pdf`);
  });

  test('201 — hospital admin collects a radiology payment with a UPI transaction ID', async () => {
    const res = await collect('radiology', radiologyRequestId, tokens.HOSPITAL_ADMIN, {
      amount: 1200.5, paymentMethod: 'UPI', transactionId: 'UPI-REF-123',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      referenceType: 'RADIOLOGY_REQUEST', referenceId: radiologyRequestId,
      amount: 1200.5, paymentMethod: 'UPI', transactionId: 'UPI-REF-123',
      description: 'Radiology – X-Ray Chest',
    });
  });

  test('records an audit entry with the transaction ID redacted', async () => {
    await collect('radiology', radiologyRequestId, tokens.RECEPTIONIST, {
      amount: 100, paymentMethod: 'CARD', transactionId: 'CARD-999',
    });

    const call = (auditService.log as jest.Mock).mock.calls.find(([e]) => e.entityType === 'PAYMENT_RECORD');
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({ action: 'CREATE', tenantId, newValue: { amount: 100, method: 'CARD', transactionId: '[redacted]' } });
  });

  test('payment shows up in the department-wise revenue against the request department', async () => {
    await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);
    const res = await request(app)
      .get('/api/payments/summary/by-department')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.grandTotal).toBe(450);
  });
});

// ─── Receipt ───────────────────────────────────────────────────────────────────

describe('Lab payment receipt', () => {
  test('generates the Lab A5 receipt from the stored records and uploads it to S3', async () => {
    const spy = jest.spyOn(pdfService, 'generateLabReceipt');

    const res = await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, {
      amount: 450, paymentMethod: 'UPI', transactionId: 'UPI-77',
    });
    expect(res.status).toBe(201);

    expect(spy).toHaveBeenCalledTimes(1);
    const data = spy.mock.calls[0][0];
    expect(data).toMatchObject({
      receiptNumber:              res.body.data.paymentId,
      hospitalName:               'Lab Pay Hospital',
      hospitalRegistrationNumber: 'REG-2026-0042',
      hospitalAddress:            '321 Lab Street, Mumbai, Maharashtra - 400001',
      patientName:                'John Doe',
      patientId:                  PATIENT_ID,
      patientAge:                 46,
      patientGender:              'MALE',
      patientMobile:              '9876543210',
      labCategory:                'PATHOLOGY',
      labRequestId:               pathologyRequestId,
      testName:                   'Complete Blood Count',
      referredBy:                 'Dr. Referrer',
      createdBy:                  'Front Desk Receptionist',
      amountInr:                  450,
      paymentMethod:              'UPI',
      transactionId:              'UPI-77',
    });
    // The Lab receipt is monochrome — the tenant brand colour is not passed in.
    expect(data).not.toHaveProperty('primaryColor');
    // Receipt date is the payment's own timestamp (within the request window).
    const stored = await PaymentModel.findOne({ paymentId: res.body.data.paymentId });
    expect(Math.abs(data.paymentDate.getTime() - stored!.createdAt.getTime())).toBeLessThan(5000);

    const upload = (s3Service.uploadFile as jest.Mock).mock.calls[0];
    expect(upload[0]).toBe(`org/${tenantId}/payments/${res.body.data.paymentId}/receipt.pdf`);
    expect((upload[1] as Buffer).slice(0, 4).toString('ascii')).toBe('%PDF');
    expect(upload[2]).toBe('application/pdf');

    spy.mockRestore();
  });

  test('referred-by "Self" and a document-path registration value are rendered safely', async () => {
    await TenantModel.updateOne({ _id: tenantId }, { 'onboardingDocuments.registrationCertificate': 'docs/t1/reg-cert.pdf' });
    const spy = jest.spyOn(pdfService, 'generateLabReceipt');

    await collect('radiology', radiologyRequestId, tokens.RECEPTIONIST, VALID_BODY);

    expect(spy.mock.calls[0][0]).toMatchObject({
      labCategory: 'RADIOLOGY', testName: 'X-Ray Chest', referredBy: 'Self',
      hospitalRegistrationNumber: null, transactionId: null,
    });
    spy.mockRestore();
  });

  test('receipt download URL is available to the receptionist via the existing receipt endpoint', async () => {
    const created = await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);
    const res = await request(app)
      .get(`/api/payments/${created.body.data.paymentId}/receipt`)
      .set('Authorization', `Bearer ${tokens.RECEPTIONIST}`);
    expect(res.status).toBe(200);
    expect(res.body.data.receiptUrl).toBe('https://s3.test/presigned-url');
  });

  test('a receipt generation failure does not fail the payment', async () => {
    const spy = jest.spyOn(pdfService, 'generateLabReceipt').mockRejectedValueOnce(new Error('pdf boom'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data.receiptUrl).toBeNull();

    const list = await request(app).get('/api/lab/pathology').set('Authorization', `Bearer ${tokens.RECEPTIONIST}`);
    expect(list.body.data.data[0].payment.receiptAvailable).toBe(false);

    spy.mockRestore();
    warn.mockRestore();
  });
});

// ─── RBAC ──────────────────────────────────────────────────────────────────────

describe('Lab payment collection — authorization', () => {
  test.each([
    UserRole.DOCTOR, UserRole.NURSE, UserRole.PATHOLOGIST, UserRole.RADIOLOGIST,
    UserRole.MANAGER, UserRole.ADMIN, UserRole.FINANCE_MANAGER,
  ])('403 — %s cannot collect a lab payment', async (role) => {
    const [p, r] = await Promise.all([
      collect('pathology', pathologyRequestId, tokens[role], VALID_BODY),
      collect('radiology', radiologyRequestId, tokens[role], VALID_BODY),
    ]);
    expect(p.status).toBe(403);
    expect(r.status).toBe(403);
    expect(await PaymentModel.countDocuments({})).toBe(0);
  });

  test('401 — no auth token', async () => {
    const res = await collect('pathology', pathologyRequestId, undefined, VALID_BODY);
    expect(res.status).toBe(401);
  });

  test('404 — a receptionist from another tenant cannot collect against this tenant\'s request', async () => {
    const res = await collect('pathology', pathologyRequestId, otherTenantReceptionistToken, VALID_BODY);
    expect(res.status).toBe(404);
    expect(await PaymentModel.countDocuments({})).toBe(0);
  });
});

// ─── Validation ────────────────────────────────────────────────────────────────

describe('Lab payment collection — validation', () => {
  test.each([
    ['missing amount',               { paymentMethod: 'CASH' }],
    ['zero amount',                  { amount: 0, paymentMethod: 'CASH' }],
    ['negative amount',              { amount: -5, paymentMethod: 'CASH' }],
    ['amount with 3 decimals',       { amount: 10.555, paymentMethod: 'CASH' }],
    ['amount over 10 digits',        { amount: 12345678901, paymentMethod: 'CASH' }],
    ['string amount',                { amount: '450', paymentMethod: 'CASH' }],
    ['unsupported method (CHEQUE)',  { amount: 450, paymentMethod: 'CHEQUE' }],
    ['missing method',               { amount: 450 }],
    ['transactionId over 100 chars', { amount: 450, paymentMethod: 'UPI', transactionId: 'x'.repeat(101) }],
    ['client-supplied patientId',    { amount: 450, paymentMethod: 'CASH', patientId: 'PAT-002' }],
    ['client-supplied referenceId',  { amount: 450, paymentMethod: 'CASH', referenceId: 'other' }],
  ])('400 — %s', async (_label, body) => {
    const res = await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, body);
    expect(res.status).toBe(400);
    expect(await PaymentModel.countDocuments({})).toBe(0);
  });

  test('400 — malformed requestId', async () => {
    const res = await collect('pathology', 'not-a-uuid', tokens.RECEPTIONIST, VALID_BODY);
    expect(res.status).toBe(400);
  });

  test('404 — unknown request', async () => {
    const res = await collect('radiology', uuidv4(), tokens.RECEPTIONIST, VALID_BODY);
    expect(res.status).toBe(404);
  });

  test('404 — a pathology requestId cannot be paid through the radiology route', async () => {
    const res = await collect('radiology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);
    expect(res.status).toBe(404);
  });

  test('404 — soft-deleted request', async () => {
    await PathologyRequestModel.updateOne({ requestId: pathologyRequestId }, { isDeleted: true, deletedAt: new Date() });
    const res = await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);
    expect(res.status).toBe(404);
  });
});

// ─── Duplicates & concurrency ──────────────────────────────────────────────────

describe('Lab payment collection — duplicate prevention', () => {
  test('409 — a second collect for the same request is rejected', async () => {
    const first  = await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);
    const second = await collect('pathology', pathologyRequestId, tokens.HOSPITAL_ADMIN, { amount: 999, paymentMethod: 'CARD' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(await PaymentModel.countDocuments({ referenceId: pathologyRequestId })).toBe(1);
  });

  test('concurrent collects for the same request produce exactly one payment', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => collect('radiology', radiologyRequestId, tokens.RECEPTIONIST, VALID_BODY)),
    );
    const statuses = results.map((r) => r.status).sort();

    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect(await PaymentModel.countDocuments({ referenceId: radiologyRequestId, status: 'COMPLETED' })).toBe(1);
  });

  test('database index rejects a second COMPLETED payment for the same lab request', async () => {
    const base = {
      tenantId, patientId: PATIENT_ID, amount: 100, paymentMethod: 'CASH', description: 'x',
      referenceType: 'PATHOLOGY_REQUEST', referenceId: pathologyRequestId, createdBy: 'u',
    };
    await PaymentModel.create({ ...base, paymentId: uuidv4(), status: 'COMPLETED' });
    await expect(PaymentModel.create({ ...base, paymentId: uuidv4(), status: 'COMPLETED' }))
      .rejects.toMatchObject({ code: 11000 });
  });

  test('database index leaves non-lab and non-COMPLETED payments unconstrained', async () => {
    const base = {
      tenantId, patientId: PATIENT_ID, amount: 100, paymentMethod: 'CASH', description: 'x', createdBy: 'u',
    };
    // Existing behaviour: several payments may share an OPD visit reference.
    await PaymentModel.create({ ...base, paymentId: uuidv4(), status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-1' });
    await PaymentModel.create({ ...base, paymentId: uuidv4(), status: 'COMPLETED', referenceType: 'OPD_VISIT', referenceId: 'OPD-1' });
    // A cancelled lab payment does not block a completed one.
    await PaymentModel.create({ ...base, paymentId: uuidv4(), status: 'CANCELLED', referenceType: 'RADIOLOGY_REQUEST', referenceId: radiologyRequestId });
    await PaymentModel.create({ ...base, paymentId: uuidv4(), status: 'COMPLETED', referenceType: 'RADIOLOGY_REQUEST', referenceId: radiologyRequestId });
    expect(await PaymentModel.countDocuments({})).toBe(4);
  });
});

// ─── Generic manual-payment endpoint guard ─────────────────────────────────────

describe('POST /api/payments/manual with a lab reference', () => {
  const manual = (body: object) => request(app)
    .post('/api/payments/manual')
    .set('Authorization', `Bearer ${tokens.RECEPTIONIST}`)
    .send({ amount: 100, paymentMethod: 'CASH', description: 'Lab fee', ...body });

  test('400 — lab request belongs to a different patient', async () => {
    const res = await manual({ patientId: 'PAT-002', referenceType: 'PATHOLOGY_REQUEST', referenceId: pathologyRequestId });
    expect(res.status).toBe(400);
  });

  test('404 — referenced lab request does not exist', async () => {
    const res = await manual({ patientId: PATIENT_ID, referenceType: 'RADIOLOGY_REQUEST', referenceId: uuidv4() });
    expect(res.status).toBe(404);
  });

  test('400 — lab reference type without referenceId', async () => {
    const res = await manual({ patientId: PATIENT_ID, referenceType: 'RADIOLOGY_REQUEST' });
    expect(res.status).toBe(400);
  });

  test('409 — cannot add a second payment to a lab request already paid from the Lab section', async () => {
    await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);
    const res = await manual({ patientId: PATIENT_ID, referenceType: 'PATHOLOGY_REQUEST', referenceId: pathologyRequestId });
    expect(res.status).toBe(409);
    expect(await PaymentModel.countDocuments({ referenceId: pathologyRequestId })).toBe(1);
  });

  test('201 — non-lab manual payments are unaffected', async () => {
    const res = await manual({ patientId: PATIENT_ID, referenceType: 'OPD_VISIT', referenceId: 'OPD-ANY' });
    expect(res.status).toBe(201);
  });
});

// ─── Paid/Unpaid status in Lab responses ───────────────────────────────────────

describe('Lab request payment status', () => {
  test('list and detail show null payment while unpaid and the payment summary once paid', async () => {
    const before = await request(app).get('/api/lab/pathology').set('Authorization', `Bearer ${tokens.RECEPTIONIST}`);
    expect(before.body.data.data[0].payment).toBeNull();

    const paid = await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, { amount: 300, paymentMethod: 'CARD' });

    const [list, detail] = await Promise.all([
      request(app).get('/api/lab/pathology').set('Authorization', `Bearer ${tokens.RECEPTIONIST}`),
      request(app).get(`/api/lab/pathology/${pathologyRequestId}`).set('Authorization', `Bearer ${tokens.RECEPTIONIST}`),
    ]);
    const expected = {
      paymentId: paid.body.data.paymentId, amount: 300, paymentMethod: 'CARD', receiptAvailable: true,
    };
    expect(list.body.data.data[0].payment).toMatchObject(expected);
    expect(detail.body.data.payment).toMatchObject(expected);
    expect(typeof detail.body.data.payment.paidAt).toBe('string');

    // Paying pathology never marks the radiology request paid.
    const rad = await request(app).get(`/api/lab/radiology/${radiologyRequestId}`).set('Authorization', `Bearer ${tokens.RECEPTIONIST}`);
    expect(rad.body.data.payment).toBeNull();
  });

  test('newly created requests report payment: null', async () => {
    const res = await request(app)
      .post('/api/lab/pathology')
      .set('Authorization', `Bearer ${tokens.RECEPTIONIST}`)
      .send({ patientId: PATIENT_ID, testType: 'Lipid Profile' });
    expect(res.status).toBe(201);
    expect(res.body.data.payment).toBeNull();
  });
});

// ─── Delete protection ─────────────────────────────────────────────────────────

describe('Deleting a paid lab request', () => {
  test('409 — hospital admin cannot delete a paid pathology request', async () => {
    await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);
    const res = await request(app)
      .delete(`/api/lab/pathology/${pathologyRequestId}`)
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/paid/i);
    const doc = await PathologyRequestModel.findOne({ requestId: pathologyRequestId });
    expect(doc!.isDeleted).toBe(false);
  });

  test('409 — manager cannot delete a paid radiology request', async () => {
    await collect('radiology', radiologyRequestId, tokens.RECEPTIONIST, VALID_BODY);
    const res = await request(app)
      .delete(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${tokens.MANAGER}`);
    expect(res.status).toBe(409);
  });

  test('200 — an unpaid request can still be deleted (unchanged)', async () => {
    const res = await request(app)
      .delete(`/api/lab/radiology/${radiologyRequestId}`)
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`);
    expect(res.status).toBe(200);
  });
});

// ─── Report upload gated on payment ────────────────────────────────────────────

describe('Report upload requires a collected payment', () => {
  const kinds = [
    { kind: 'pathology' as const, role: UserRole.PATHOLOGIST, otherRole: UserRole.RADIOLOGIST, id: () => pathologyRequestId },
    { kind: 'radiology' as const, role: UserRole.RADIOLOGIST, otherRole: UserRole.PATHOLOGIST, id: () => radiologyRequestId },
  ];

  const upload = (kind: 'pathology' | 'radiology', id: string, token: string | undefined) =>
    request(app)
      .patch(`/api/lab/${kind}/${id}/report`)
      .set('Authorization', `Bearer ${token}`)
      .attach('report', Buffer.from('%PDF-1.4 lab report'), { filename: 'report.pdf', contentType: 'application/pdf' });

  const getDetail = (kind: 'pathology' | 'radiology', id: string, token: string | undefined) =>
    request(app).get(`/api/lab/${kind}/${id}`).set('Authorization', `Bearer ${token}`);

  test.each(kinds)('409 — $role cannot upload a $kind report before payment, and nothing is stored', async ({ kind, role, id }) => {
    const res = await upload(kind, id(), tokens[role]);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/payment must be collected/i);
    expect(s3Service.uploadFile).not.toHaveBeenCalled();

    const detail = await getDetail(kind, id(), tokens[role]);
    expect(detail.body.data.status).toBe('PENDING');
    expect(detail.body.data.reportUrl).toBeNull();
    expect(detail.body.data.payment).toBeNull();
  });

  test.each(kinds)('409 — hospital admin cannot bypass the $kind payment gate either', async ({ kind, id }) => {
    const res = await upload(kind, id(), tokens.HOSPITAL_ADMIN);
    expect(res.status).toBe(409);
  });

  test.each(kinds)('200 — $role uploads the $kind report once the receptionist has collected payment', async ({ kind, role, id }) => {
    const paid = await collect(kind, id(), tokens.RECEPTIONIST, VALID_BODY);
    expect(paid.status).toBe(201);
    jest.mocked(s3Service.uploadFile).mockClear();
    jest.mocked(s3Service.getPresignedUrl).mockClear();

    const res = await upload(kind, id(), tokens[role]);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.reportUrl).toBe('https://s3.test/presigned-url');

    // The report is stored under, and View Report resolves, this request's own key.
    const expectedKey = `org/${tenantId}/lab/${kind}/${id()}/report.pdf`;
    expect(s3Service.uploadFile).toHaveBeenCalledWith(expectedKey, expect.any(Buffer), 'application/pdf');
    const stored = kind === 'pathology'
      ? await PathologyRequestModel.findOne({ requestId: id() })
      : await RadiologyRequestModel.findOne({ requestId: id() });
    expect(stored!.reportS3Key).toBe(expectedKey);

    jest.mocked(s3Service.getPresignedUrl).mockClear();
    const detail = await getDetail(kind, id(), tokens[role]);
    expect(detail.body.data.reportUrl).toBe('https://s3.test/presigned-url');
    expect(s3Service.getPresignedUrl).toHaveBeenCalledWith(expectedKey, expect.any(Number));
  });

  test.each(kinds)('403 — $otherRole still cannot upload a paid $kind report (role permissions unchanged)', async ({ kind, otherRole, id }) => {
    await collect(kind, id(), tokens.RECEPTIONIST, VALID_BODY);
    const res = await upload(kind, id(), tokens[otherRole]);
    expect(res.status).toBe(403);
  });

  test('paying one request does not unlock upload for a different request', async () => {
    await collect('pathology', pathologyRequestId, tokens.RECEPTIONIST, VALID_BODY);

    const otherRequestId = uuidv4();
    await PathologyRequestModel.create({
      requestId: otherRequestId, patientId: PATIENT_ID, tenantId,
      requestedBy: doctorId, testType: 'Lipid Profile', status: 'PENDING', requestedAt: new Date(),
    });
    const res = await upload('pathology', otherRequestId, tokens.PATHOLOGIST);
    expect(res.status).toBe(409);

    // Nor does a pathology payment unlock the radiology request.
    const rad = await upload('radiology', radiologyRequestId, tokens.RADIOLOGIST);
    expect(rad.status).toBe(409);
  });

  test('a payment in another tenant does not unlock this tenant\'s request', async () => {
    await PaymentModel.create({
      paymentId: `PAY-${uuidv4()}`, tenantId: otherTenantId, patientId: PATIENT_ID,
      amount: 100, paymentMethod: 'CASH', description: 'x', status: 'COMPLETED',
      referenceType: 'PATHOLOGY_REQUEST', referenceId: pathologyRequestId, createdBy: 'test',
    });
    const res = await upload('pathology', pathologyRequestId, tokens.PATHOLOGIST);
    expect(res.status).toBe(409);
  });
});
