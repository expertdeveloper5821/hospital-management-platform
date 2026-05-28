import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';

jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: { sendInviteEmail: jest.fn(), sendWelcomeEmail: jest.fn() },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: { uploadFile: jest.fn(), getPresignedUrl: jest.fn() },
}));
jest.mock('../../../src/modules/notification/notification.service', () => ({
  notificationService: {
    sendNotification: jest.fn().mockResolvedValue(undefined),
    sendToRole:       jest.fn().mockResolvedValue(undefined),
  },
}));

import app             from '../../../src/app';
import { UserModel }   from '../../../src/modules/user/user.model';
import { PatientModel } from '../../../src/modules/patient/patient.model';
import { TenantModel } from '../../../src/modules/tenant/tenant.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:   MongoMemoryServer;
let tenantId: string;

function makeToken(role: UserRole = UserRole.ADMIN, userId = 'user-001'): string {
  return jwt.sign(
    { userId, tenantId, role, email: `${role.toLowerCase()}@test.com`, isFirstLogin: false },
    JWT_SECRET,
    { expiresIn: '1h' },
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
    name:       'Search Test Hospital',
    adminEmail: 'admin@searchtest.com',
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg-001',
      gstNumber:               'GST001',
      panCard:                 'PAN001',
      addressProof:            'addr-001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();
});

// ─── Auth enforcement ─────────────────────────────────────────────────────────

describe('GET /api/search — auth enforcement', () => {
  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/search?q=John');
    expect(res.status).toBe(401);
  });

  test('returns 200 with valid token and query', async () => {
    const res = await request(app)
      .get('/api/search?q=Jo')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });
});

// ─── Query validation ─────────────────────────────────────────────────────────

describe('GET /api/search — query validation', () => {
  test('returns 400 when q is missing', async () => {
    const res = await request(app)
      .get('/api/search')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
  });

  test('returns 400 when q is shorter than 2 chars', async () => {
    const res = await request(app)
      .get('/api/search?q=a')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
  });

  test('returns 400 when q exceeds 100 chars', async () => {
    const longQuery = 'a'.repeat(101);
    const res = await request(app)
      .get(`/api/search?q=${longQuery}`)
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid type filter', async () => {
    const res = await request(app)
      .get('/api/search?q=test&type=invalid_type')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(400);
  });

  test('accepts exactly 2 character query', async () => {
    const res = await request(app)
      .get('/api/search?q=Jo')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
  });
});

// ─── Response shape ───────────────────────────────────────────────────────────

describe('GET /api/search — response shape', () => {
  test('returns grouped results shape with query, results, and total', async () => {
    const res = await request(app)
      .get('/api/search?q=test')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveProperty('query', 'test');
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('total');
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.total).toBe(data.results.length);
  });

  test('returns patient in results when patient matches query', async () => {
    await PatientModel.create({
      tenantId,
      fullName:    'Alice Wonderland',
      dateOfBirth: new Date('1990-01-01'),
      gender:      'FEMALE',
      mobileNumber: '9999999999',
      address:     '123 Test St',
    });

    const res = await request(app)
      .get('/api/search?q=Alice')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    const patient = data.results.find((r: { entityType: string }) => r.entityType === 'patient');
    expect(patient).toBeDefined();
    expect(patient.title).toBe('Alice Wonderland');
  });

  test('returns user in results when user matches query', async () => {
    await UserModel.create({
      tenantId,
      email:        'bob@hospital.com',
      name:         'Bob Doctor',
      passwordHash: 'x',
      role:         UserRole.DOCTOR,
      isActive:     true,
      isFirstLogin: false,
    });

    const res = await request(app)
      .get('/api/search?q=Bob')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    const userResult = res.body.data.results.find((r: { entityType: string }) => r.entityType === 'user');
    expect(userResult).toBeDefined();
    expect(userResult.title).toBe('Bob Doctor');
  });

  test('returns empty results array for no matches', async () => {
    const res = await request(app)
      .get('/api/search?q=ZZZnoMatch')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });
});

// ─── Type filter ──────────────────────────────────────────────────────────────

describe('GET /api/search — type filter', () => {
  test('returns only patient results when type=patient', async () => {
    await PatientModel.create({
      tenantId,
      fullName:    'Carl Patient',
      dateOfBirth: new Date('1985-06-15'),
      gender:      'MALE',
      mobileNumber: '8888888888',
      address:     '456 Test Ave',
    });

    const res = await request(app)
      .get('/api/search?q=Carl&type=patient')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    const { results } = res.body.data;
    expect(results.every((r: { entityType: string }) => r.entityType === 'patient')).toBe(true);
  });
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

describe('GET /api/search — tenant isolation', () => {
  test('does not return records from another tenant', async () => {
    const otherTenant = await TenantModel.create({
      name:       'Other Hospital',
      adminEmail: 'admin@other.com',
      status:     TenantStatus.ACTIVE,
      onboardingDocuments: {
        registrationCertificate: 'reg-002',
        gstNumber:               'GST002',
        panCard:                 'PAN002',
        addressProof:            'addr-002',
      },
    });
    const otherTenantId = (otherTenant._id as mongoose.Types.ObjectId).toString();

    await PatientModel.create({
      tenantId: otherTenantId,
      fullName:    'Diana Other',
      dateOfBirth: new Date('1992-03-20'),
      gender:      'FEMALE',
      mobileNumber: '7777777777',
      address:     '789 Other St',
    });

    const res = await request(app)
      .get('/api/search?q=Diana&type=patient')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(0);
  });
});
