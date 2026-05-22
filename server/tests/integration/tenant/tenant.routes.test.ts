import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';

jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: {
    sendInviteEmail:        jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail:       jest.fn().mockResolvedValue(undefined),
    sendAccountLockEmail:   jest.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendTemplatedEmail:     jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn().mockResolvedValue('https://s3.test/logo.png'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.test/presigned'),
  },
}));

import app             from '../../../src/app';
import { TenantModel } from '../../../src/modules/tenant/tenant.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function superAdminToken(userId = 'sa-1') {
  return jwt.sign(
    { userId, tenantId: null, role: UserRole.SUPER_ADMIN, email: 'sa@hms.com', isFirstLogin: false },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function hospitalAdminToken(tenantId: string, userId = 'ha-1') {
  return jwt.sign(
    { userId, tenantId, role: UserRole.HOSPITAL_ADMIN, email: 'admin@h.com', isFirstLogin: false },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function seedPendingTenant(name = 'Test Hospital') {
  return TenantModel.create({
    name,
    adminEmail: 'admin@testhospital.com',
    status: TenantStatus.PENDING_VERIFICATION,
    onboardingDocuments: {
      registrationCertificate: 's3-key-1',
      gstNumber:               'GST123',
      panCard:                 's3-key-2',
      addressProof:            's3-key-3',
    },
    branding: { displayName: name, primaryColor: '#1A73E8' },
  });
}

async function seedActiveTenant(name = 'Active Hospital') {
  return TenantModel.create({
    name,
    adminEmail: 'admin@activehospital.com',
    status: TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 's3-key-1',
      gstNumber:               'GST123',
      panCard:                 's3-key-2',
      addressProof:            's3-key-3',
    },
    branding: { displayName: name, primaryColor: '#1A73E8' },
  });
}

// ─── POST /api/tenants ────────────────────────────────────────────────────────
describe('POST /api/tenants', () => {
  test('201 — Super Admin creates tenant with PENDING_VERIFICATION status', async () => {
    const token = superAdminToken();

    const res = await request(app)
      .post('/api/tenants')
      .set(bearer(token))
      .send({
        name:       'New Hospital',
        adminEmail: 'newadmin@newhospital.com',
        onboardingDocuments: {
          registrationCertificate: 's3-reg-cert',
          gstNumber:               'GST999',
          panCard:                 's3-pan',
          addressProof:            's3-addr',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(TenantStatus.PENDING_VERIFICATION);
    expect(res.body.data.name).toBe('New Hospital');
  });

  test('401 — unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/tenants')
      .send({ name: 'Hospital', adminEmail: 'a@a.com' });

    expect(res.status).toBe(401);
  });

  test('403 — Hospital Admin cannot create tenants', async () => {
    const tenant = await seedActiveTenant();
    const token  = hospitalAdminToken(tenant._id.toString());

    const res = await request(app)
      .post('/api/tenants')
      .set(bearer(token))
      .send({
        name:       'Another Hospital',
        adminEmail: 'x@x.com',
        onboardingDocuments: {
          registrationCertificate: 'k1',
          gstNumber:               'G1',
          panCard:                 'k2',
          addressProof:            'k3',
        },
      });

    expect(res.status).toBe(403);
  });

  test('400 — missing required fields', async () => {
    const token = superAdminToken();

    const res = await request(app)
      .post('/api/tenants')
      .set(bearer(token))
      .send({ name: 'Incomplete' });

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/tenants ─────────────────────────────────────────────────────────
describe('GET /api/tenants', () => {
  test('200 — Super Admin lists tenants', async () => {
    await seedPendingTenant('Hospital A');
    await seedPendingTenant('Hospital B');
    const token = superAdminToken();

    const res = await request(app)
      .get('/api/tenants')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
  });

  test('401 — unauthenticated request', async () => {
    const res = await request(app).get('/api/tenants');
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/tenants/:tenantId/approve ────────────────────────────────────
describe('PATCH /api/tenants/:tenantId/approve', () => {
  test('200 — approves a PENDING_VERIFICATION tenant', async () => {
    const tenant = await seedPendingTenant();
    const token  = superAdminToken();

    const res = await request(app)
      .patch(`/api/tenants/${tenant._id}/approve`)
      .set(bearer(token));

    expect(res.status).toBe(200);

    const updated = await TenantModel.findById(tenant._id);
    expect(updated?.status).toBe(TenantStatus.ACTIVE);
  });

  test('409 — cannot approve an already ACTIVE tenant', async () => {
    const tenant = await seedActiveTenant();
    const token  = superAdminToken();

    const res = await request(app)
      .patch(`/api/tenants/${tenant._id}/approve`)
      .set(bearer(token));

    expect(res.status).toBe(409);
  });

  test('404 — unknown tenantId returns 404', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const token  = superAdminToken();

    const res = await request(app)
      .patch(`/api/tenants/${fakeId}/approve`)
      .set(bearer(token));

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/tenants/:tenantId/deactivate ─────────────────────────────────
describe('PATCH /api/tenants/:tenantId/deactivate', () => {
  test('200 — deactivates an ACTIVE tenant', async () => {
    const tenant = await seedActiveTenant();
    const token  = superAdminToken();

    const res = await request(app)
      .patch(`/api/tenants/${tenant._id}/deactivate`)
      .set(bearer(token));

    expect(res.status).toBe(200);

    const updated = await TenantModel.findById(tenant._id);
    expect(updated?.status).toBe(TenantStatus.INACTIVE);
  });

  test('401 — unauthenticated request', async () => {
    const tenant = await seedActiveTenant();
    const res    = await request(app).patch(`/api/tenants/${tenant._id}/deactivate`);
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/tenants/:tenantId/branding ─────────────────────────────────────
describe('GET /api/tenants/:tenantId/branding', () => {
  test('200 — returns branding config (public endpoint)', async () => {
    const tenant = await seedActiveTenant('Branding Hospital');

    const res = await request(app)
      .get(`/api/tenants/${tenant._id}/branding`);

    expect(res.status).toBe(200);
  });
});

// ─── PATCH /api/tenants/:tenantId/branding ───────────────────────────────────
describe('PATCH /api/tenants/:tenantId/branding', () => {
  test('200 — Hospital Admin can update branding', async () => {
    const tenant = await seedActiveTenant();
    const token  = hospitalAdminToken(tenant._id.toString());

    const res = await request(app)
      .patch(`/api/tenants/${tenant._id}/branding`)
      .set(bearer(token))
      .send({ displayName: 'New Display Name', primaryColor: '#FF5733' });

    expect(res.status).toBe(200);
  });

  test('400 — invalid primaryColor format', async () => {
    const tenant = await seedActiveTenant();
    const token  = hospitalAdminToken(tenant._id.toString());

    const res = await request(app)
      .patch(`/api/tenants/${tenant._id}/branding`)
      .set(bearer(token))
      .send({ primaryColor: 'not-a-hex-color' });

    expect(res.status).toBe(400);
  });

  test('401 — unauthenticated branding update', async () => {
    const tenant = await seedActiveTenant();

    const res = await request(app)
      .patch(`/api/tenants/${tenant._id}/branding`)
      .send({ displayName: 'Hack' });

    expect(res.status).toBe(401);
  });
});
