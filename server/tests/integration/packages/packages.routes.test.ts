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

let mongod:     MongoMemoryServer;
let tenantId:   string;
let adminToken: string;

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
      addressProof:            'addr-proof-001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const admin = await UserModel.create({
    tenantId, email: 'admin@pkg.com', name: 'Pkg Admin', passwordHash: 'x',
    role: UserRole.HOSPITAL_ADMIN, isActive: true, isFirstLogin: false,
  });

  adminToken = jwt.sign(
    { userId: (admin._id as mongoose.Types.ObjectId).toString(), tenantId, role: UserRole.HOSPITAL_ADMIN, email: 'x@x.com', isFirstLogin: false },
    JWT_SECRET,
  );
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
