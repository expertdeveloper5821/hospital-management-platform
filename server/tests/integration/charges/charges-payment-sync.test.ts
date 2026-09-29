import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

jest.mock('../../../src/modules/patient/patient.repository', () => ({
  patientRepository: {
    findByPatientId: jest.fn(async (_tenantId: string, patientId: string) => ({
      patientId, fullName: 'Test Patient',
    })),
  },
}));
jest.mock('../../../src/modules/tenant/tenant.repository', () => ({
  tenantRepository: { findById: jest.fn(async () => null) },
}));
jest.mock('../../../src/shared/services/pdf.service', () => ({
  pdfService: { generateReceipt: jest.fn(async () => Buffer.from('pdf')) },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn(async () => undefined),
    getPresignedUrl: jest.fn(async () => null),
  },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn(async () => undefined) },
}));
jest.mock('../../../src/modules/notification/notification.service', () => ({
  notificationService: { sendNotification: jest.fn(async () => undefined) },
}));

import { chargeService } from '../../../src/modules/charges/charges.service';
import { PaymentModel } from '../../../src/modules/payment/payment.model';
import { UserRole } from '../../../src/shared/types/common.types';

const TENANT = 'tenant-charge-payment-sync';

let mongod: MongoMemoryServer;

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
});

async function addCharge() {
  return chargeService.addCharge(
    TENANT,
    { patientId: 'PAT-SYNC1', category: 'PROCEDURE', description: 'Dressing', amount: 250 },
    'user-1',
    UserRole.RECEPTIONIST,
  );
}

async function paymentFor(chargeId: string) {
  return PaymentModel.find({ tenantId: TENANT, referenceType: 'CHARGE', referenceId: chargeId });
}

describe('Billing charge → Payments status sync', () => {
  test('adding a charge creates a PENDING payment', async () => {
    const charge = await addCharge();
    const payments = await paymentFor(charge.chargeId);

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('PENDING');
    expect(payments[0].amount).toBe(250);
    expect(payments[0].description).toBe('Billing Charge – Dressing');
  });

  test('marking the charge paid settles the same payment to COMPLETED', async () => {
    const charge = await addCharge();
    await chargeService.markPaid(TENANT, charge.chargeId, 'user-2', UserRole.RECEPTIONIST);
    const payments = await paymentFor(charge.chargeId);

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('COMPLETED');
    expect(payments[0].receiptS3Key).toContain(payments[0].paymentId);
  });

  test('cancelling the charge settles the same payment to CANCELLED', async () => {
    const charge = await addCharge();
    await chargeService.cancelCharge(TENANT, charge.chargeId, 'user-2', 'User Two', UserRole.RECEPTIONIST);
    const payments = await paymentFor(charge.chargeId);

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('CANCELLED');
    expect(payments[0].receiptS3Key).toBeNull();
  });

  test('a legacy charge with no payment record still gets a COMPLETED payment when paid', async () => {
    const charge = await addCharge();
    await PaymentModel.deleteMany({ tenantId: TENANT });

    await chargeService.markPaid(TENANT, charge.chargeId, 'user-2', UserRole.RECEPTIONIST);
    const payments = await paymentFor(charge.chargeId);

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('COMPLETED');
  });
});
