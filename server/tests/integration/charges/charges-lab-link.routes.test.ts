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
jest.mock('../../../src/shared/services/pdf.service', () => ({
  pdfService: {
    generateReceipt:    jest.fn().mockResolvedValue(Buffer.from('%PDF-generic-receipt')),
    generateLabReceipt: jest.fn().mockResolvedValue(Buffer.from('%PDF-lab-receipt')),
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
import { ChargeModel }      from '../../../src/modules/charges/charges.model';
import { PaymentModel }     from '../../../src/modules/payment/payment.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../../../src/modules/lab/lab.model';
import { labService }       from '../../../src/modules/lab/lab.service';
import { notificationService } from '../../../src/modules/notification/notification.service';
import { pdfService }       from '../../../src/shared/services/pdf.service';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;
const PATIENT_ID = 'PAT-LINK1';

let mongod:   MongoMemoryServer;
let tenantId: string;
const tokens: Partial<Record<UserRole, string>> = {};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Unique indexes (one lab request per charge, one COMPLETED lab payment per request).
  await Promise.all([PathologyRequestModel.init(), RadiologyRequestModel.init(), PaymentModel.init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );

  const tenant = await TenantModel.create({
    name: 'Lab Link Hospital', adminEmail: 'admin@lablink.com', status: TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'REG-LINK', gstNumber: 'GST001', panCard: 'PAN001',
      addressLine: '1 Link Street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  for (const role of [
    UserRole.RECEPTIONIST, UserRole.HOSPITAL_ADMIN, UserRole.PATHOLOGIST, UserRole.RADIOLOGIST,
  ]) {
    const user = await UserModel.create({
      tenantId, email: `${role.toLowerCase()}@lablink.com`, name: `User ${role}`, passwordHash: 'x',
      role, isActive: true, isFirstLogin: false,
    });
    tokens[role] = jwt.sign(
      { userId: (user._id as mongoose.Types.ObjectId).toString(), tenantId, role, email: 'x@x.com', isFirstLogin: false },
      JWT_SECRET,
    );
  }

  await PatientModel.create({
    patientId: PATIENT_ID, tenantId, fullName: 'Linked Patient',
    dateOfBirth: new Date('1985-01-01'), gender: 'MALE',
    mobileNumber: '9876543210', address: '1 Test Street',
  });
});

const auth = (role: UserRole) => ({ Authorization: `Bearer ${tokens[role]}` });

async function addLabCharge(testTypeId: string, testTypeName: string, amount: number) {
  return request(app)
    .post('/api/charges')
    .set(auth(UserRole.RECEPTIONIST))
    .set('Idempotency-Key', uuidv4())
    .send({ patientId: PATIENT_ID, category: 'LAB_TEST', description: `Lab – ${testTypeName}`, amount, testTypeId, testTypeName });
}

async function listLab(kind: 'pathology' | 'radiology', role: UserRole = UserRole.RECEPTIONIST) {
  const res = await request(app).get(`/api/lab/${kind}`).set(auth(role));
  expect(res.status).toBe(200);
  return res.body.data.data as Array<Record<string, any>>;
}

function upload(kind: 'pathology' | 'radiology', requestId: string, role: UserRole) {
  return request(app)
    .patch(`/api/lab/${kind}/${requestId}/report`)
    .set(auth(role))
    .attach('report', Buffer.from('%PDF-1.4 lab report'), { filename: 'report.pdf', contentType: 'application/pdf' });
}

describe('Billing LAB_TEST charge → Lab request', () => {
  test('a Pathology test charge creates a linked, unpaid pathology request visible in Lab', async () => {
    const res = await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300);
    expect(res.status).toBe(201);
    const charge = res.body.data;
    expect(charge.labRequestKind).toBe('PATHOLOGY');
    expect(charge.labRequestId).toEqual(expect.any(String));

    const rows = await listLab('pathology');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      requestId: charge.labRequestId,
      patientId: PATIENT_ID,
      testType:  'Complete Blood Count',
      chargeId:  charge.chargeId,
      status:    'PENDING',
      payment:   null,
    });
    // Pathologists are notified, same as a Lab-created request.
    expect(notificationService.sendToRole).toHaveBeenCalledWith(
      UserRole.PATHOLOGIST, tenantId, expect.any(String), expect.any(String), 'PATHOLOGY_REQUEST', charge.labRequestId,
    );
    expect(await listLab('radiology')).toHaveLength(0);
  });

  test('a Radiology test charge creates a linked radiology request', async () => {
    const res = await addLabCharge('RADIOLOGY:X-Ray Chest', 'X-Ray Chest', 800);
    expect(res.status).toBe(201);

    const rows = await listLab('radiology', UserRole.RADIOLOGIST);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ imagingType: 'X-Ray Chest', chargeId: res.body.data.chargeId, payment: null });
  });

  test('a test type that is neither Pathology nor Radiology is rejected and creates nothing', async () => {
    const res = await addLabCharge('OTHER:Mystery', 'Mystery', 300);
    expect(res.status).toBe(400);
    expect(await ChargeModel.countDocuments({ tenantId })).toBe(0);
    expect(await PathologyRequestModel.countDocuments({ tenantId })).toBe(0);
  });

  test('if the Lab request cannot be created, the charge is rolled back', async () => {
    const spy = jest.spyOn(labService, 'createPathologyRequest').mockRejectedValueOnce(new Error('boom'));
    const res = await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300);
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(await ChargeModel.countDocuments({ tenantId })).toBe(0);
    expect(await PaymentModel.countDocuments({ tenantId })).toBe(0);
  });

  test('at most one Lab request can be linked to a charge', async () => {
    const res = await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300);
    await expect(PathologyRequestModel.create({
      requestId: uuidv4(), patientId: PATIENT_ID, tenantId, requestedBy: 'x',
      testType: 'Complete Blood Count', chargeId: res.body.data.chargeId,
    })).rejects.toMatchObject({ code: 11000 });
  });
});

describe('Billing payment → Lab paid status, receipt and report upload', () => {
  test('report upload is blocked until Billing collects the payment', async () => {
    const charge = (await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300)).body.data;
    const res = await upload('pathology', charge.labRequestId, UserRole.PATHOLOGIST);
    expect(res.status).toBe(409);
  });

  test('Mark Paid in Billing marks the same request Paid with one shared Lab receipt, and the Pathologist can upload', async () => {
    const charge = (await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300)).body.data;

    const pay = await request(app).patch(`/api/charges/${charge.chargeId}/pay`).set(auth(UserRole.RECEPTIONIST));
    expect(pay.status).toBe(200);

    // Exactly one payment — the charge's own — now COMPLETED with a receipt.
    const payments = await PaymentModel.find({ tenantId });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: 'COMPLETED', referenceType: 'CHARGE', referenceId: charge.chargeId, amount: 300 });
    expect(payments[0].receiptS3Key).toEqual(expect.any(String));
    expect(pdfService.generateLabReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receiptNumber: payments[0].paymentId,
      labRequestId:  charge.labRequestId,
      labCategory:   'PATHOLOGY',
      testName:      'Complete Blood Count',
      amountInr:     300,
    }));
    expect(pdfService.generateReceipt).not.toHaveBeenCalled();

    // Lab shows it Paid against the same payment/receipt…
    const [row] = await listLab('pathology');
    expect(row.payment).toMatchObject({ paymentId: payments[0].paymentId, amount: 300, receiptAvailable: true });

    // …and so does Billing.
    const billing = await request(app).get('/api/charges').set(auth(UserRole.RECEPTIONIST));
    expect(billing.body.data.data[0]).toMatchObject({
      chargeId: charge.chargeId, status: 'PAID', paymentId: payments[0].paymentId, receiptAvailable: true,
    });

    const up = await upload('pathology', charge.labRequestId, UserRole.PATHOLOGIST);
    expect(up.status).toBe(200);
    expect(up.body.data.status).toBe('COMPLETED');
    expect(await PaymentModel.countDocuments({ tenantId })).toBe(1);
  });

  test('the Radiologist can upload once the radiology charge is paid', async () => {
    const charge = (await addLabCharge('RADIOLOGY:X-Ray Chest', 'X-Ray Chest', 800)).body.data;
    await request(app).patch(`/api/charges/${charge.chargeId}/pay`).set(auth(UserRole.RECEPTIONIST));

    const up = await upload('radiology', charge.labRequestId, UserRole.RADIOLOGIST);
    expect(up.status).toBe(200);
  });
});

describe('Duplicate payment prevention', () => {
  test('Lab Collect Payment is rejected for a Billing-created request (unpaid and paid)', async () => {
    const charge = (await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300)).body.data;
    const collect = () => request(app)
      .post(`/api/lab/pathology/${charge.labRequestId}/payment`)
      .set(auth(UserRole.RECEPTIONIST))
      .send({ amount: 300, paymentMethod: 'CASH' });

    const before = await collect();
    expect(before.status).toBe(409);
    expect(before.body.message).toMatch(/Billing/);

    await request(app).patch(`/api/charges/${charge.chargeId}/pay`).set(auth(UserRole.RECEPTIONIST));
    const after = await collect();
    expect(after.status).toBe(409);
    expect(after.body.message).toMatch(/already been collected/);

    expect(await PaymentModel.countDocuments({ tenantId, status: 'COMPLETED' })).toBe(1);
  });

  test('a generic manual payment referencing a Billing-created request is rejected', async () => {
    const charge = (await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300)).body.data;
    const res = await request(app)
      .post('/api/payments/manual')
      .set(auth(UserRole.RECEPTIONIST))
      .set('Idempotency-Key', uuidv4())
      .send({
        patientId: PATIENT_ID, amount: 300, paymentMethod: 'CASH', description: 'Lab',
        referenceType: 'PATHOLOGY_REQUEST', referenceId: charge.labRequestId,
      });
    expect(res.status).toBe(409);
    expect(await PaymentModel.countDocuments({ tenantId, status: 'COMPLETED' })).toBe(0);
  });

  test('marking the charge paid twice settles only once', async () => {
    const charge = (await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300)).body.data;
    await request(app).patch(`/api/charges/${charge.chargeId}/pay`).set(auth(UserRole.RECEPTIONIST));
    const again = await request(app).patch(`/api/charges/${charge.chargeId}/pay`).set(auth(UserRole.RECEPTIONIST));
    expect(again.status).toBe(409);
    expect(await PaymentModel.countDocuments({ tenantId })).toBe(1);
  });
});

describe('Free (₹0) lab tests', () => {
  test('a ₹0 Lab Test charge is Paid immediately with a ₹0 receipt, and the report can be uploaded', async () => {
    const res = await addLabCharge('PATHOLOGY:Blood Sugar', 'Blood Sugar', 0);
    expect(res.status).toBe(201);
    const charge = res.body.data;
    expect(charge.status).toBe('PAID');

    const payments = await PaymentModel.find({ tenantId });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: 'COMPLETED', amount: 0, referenceType: 'CHARGE', referenceId: charge.chargeId });
    expect(payments[0].receiptS3Key).toEqual(expect.any(String));
    expect(pdfService.generateLabReceipt).toHaveBeenCalledWith(expect.objectContaining({
      amountInr: 0, paymentMethod: 'FREE', labRequestId: charge.labRequestId,
    }));

    const [row] = await listLab('pathology');
    expect(row.payment).toMatchObject({ paymentId: payments[0].paymentId, amount: 0, receiptAvailable: true });

    const up = await upload('pathology', charge.labRequestId, UserRole.PATHOLOGIST);
    expect(up.status).toBe(200);
  });

  test('₹0 is still rejected for non-Lab-Test charges', async () => {
    const res = await request(app)
      .post('/api/charges')
      .set(auth(UserRole.RECEPTIONIST))
      .set('Idempotency-Key', uuidv4())
      .send({ patientId: PATIENT_ID, category: 'PROCEDURE', description: 'Dressing', amount: 0 });
    expect(res.status).toBe(400);
  });
});

describe('Cancel / delete consistency', () => {
  test('cancelling an unpaid Lab Test charge removes its Lab request', async () => {
    const charge = (await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300)).body.data;
    const res = await request(app).patch(`/api/charges/${charge.chargeId}/cancel`).set(auth(UserRole.RECEPTIONIST));
    expect(res.status).toBe(200);

    expect(await listLab('pathology')).toHaveLength(0);
    const stored = await PathologyRequestModel.findOne({ requestId: charge.labRequestId });
    expect(stored!.isDeleted).toBe(true);
  });

  test('a Billing-created Lab request cannot be deleted from the Lab section', async () => {
    const charge = (await addLabCharge('PATHOLOGY:Complete Blood Count', 'Complete Blood Count', 300)).body.data;
    const res = await request(app)
      .delete(`/api/lab/pathology/${charge.labRequestId}`)
      .set(auth(UserRole.HOSPITAL_ADMIN));
    expect(res.status).toBe(409);
    expect(await listLab('pathology')).toHaveLength(1);
  });
});
