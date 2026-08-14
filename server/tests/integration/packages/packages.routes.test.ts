import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';

jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: {
    log:       jest.fn().mockResolvedValue(undefined),
    queryLogs: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
  },
}));

import app             from '../../../src/app';
import { UserModel }   from '../../../src/modules/user/user.model';
import { TenantModel } from '../../../src/modules/tenant/tenant.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:           MongoMemoryServer;
let tenantId:         string;
let adminToken:       string;
let receptionistToken: string;
let nurseToken:       string;

function signToken(userId: string, role: UserRole): string {
  return jwt.sign(
    { userId, tenantId, role, email: 'x@x.com', isFirstLogin: false },
    JWT_SECRET,
  );
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
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );

  const tenant = await TenantModel.create({
    name:       'Packages Test Hospital',
    adminEmail: 'admin@pkgtest.com',
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg-cert-001',
      gstNumber:               'GST001',
      panCard:                 'PAN001',
      addressLine:            '555 Package Avenue',
      city:                    'Mumbai',
      state:                   'Maharashtra',
      pincode:                 '400001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const admin = await UserModel.create({
    tenantId, email: 'admin@pkg.com', name: 'Pkg Admin', passwordHash: 'x',
    role: UserRole.HOSPITAL_ADMIN, isActive: true, isFirstLogin: false,
  });
  adminToken = signToken((admin._id as mongoose.Types.ObjectId).toString(), UserRole.HOSPITAL_ADMIN);

  const receptionist = await UserModel.create({
    tenantId, email: 'reception@pkg.com', name: 'Pkg Receptionist', passwordHash: 'x',
    role: UserRole.RECEPTIONIST, isActive: true, isFirstLogin: false,
  });
  receptionistToken = signToken((receptionist._id as mongoose.Types.ObjectId).toString(), UserRole.RECEPTIONIST);

  const nurse = await UserModel.create({
    tenantId, email: 'nurse@pkg.com', name: 'Pkg Nurse', passwordHash: 'x',
    role: UserRole.NURSE, isActive: true, isFirstLogin: false,
  });
  nurseToken = signToken((nurse._id as mongoose.Types.ObjectId).toString(), UserRole.NURSE);
});

describe('POST /api/packages — description validation', () => {
  const validPayload = {
    name:             'Basic Health Checkup',
    price:            999,
    includedServices: ['CBC', 'Lipid Profile'],
  };

  test('creates a package with no description (optional field left empty)', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.description ?? null).toBeNull();
  });

  test('returns 400 for description exceeding maximum length', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, description: 'A'.repeat(501) });

    expect(res.status).toBe(400);
  });

  test('accepts description at exactly maximum length', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, description: 'A'.repeat(500) });

    expect(res.status).toBe(201);
  });

  test('trims leading/trailing whitespace from description', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, description: '  Comprehensive annual checkup  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBe('Comprehensive annual checkup');
  });
});

describe('POST /api/packages — role authorization', () => {
  const validPayload = {
    name:             'Full Body Checkup',
    price:            1499,
    includedServices: ['CBC', 'X-Ray', 'ECG'],
  };

  test('RECEPTIONIST can create a package and select included services', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe(validPayload.name);
    expect(res.body.data.includedServices).toEqual(validPayload.includedServices);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  test('HOSPITAL_ADMIN can still create a package (unchanged)', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
  });

  test('NURSE cannot create a package (unchanged)', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send(validPayload);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request cannot create a package', async () => {
    const res = await request(app)
      .post('/api/packages')
      .send(validPayload);

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/packages/:packageId — role authorization unchanged', () => {
  test('RECEPTIONIST cannot update a package', async () => {
    const created = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cardiac Screening', price: 2499, includedServices: ['ECG', 'Echo'] });

    const res = await request(app)
      .patch(`/api/packages/${created.body.data.packageId}`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ price: 2999 });

    expect(res.status).toBe(403);
  });
});
