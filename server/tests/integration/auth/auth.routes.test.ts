import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';
import bcrypt                 from 'bcryptjs';

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
    uploadFile:       jest.fn().mockResolvedValue('https://s3.test/file'),
    getPresignedUrl:  jest.fn().mockResolvedValue('https://s3.test/presigned'),
  },
}));

import app                  from '../../../src/app';
import { SuperAdminModel }  from '../../../src/modules/auth/auth.model';
import { UserModel }        from '../../../src/modules/user/user.model';
import { TenantModel }      from '../../../src/modules/tenant/tenant.model';
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
async function seedSuperAdmin(email: string, plainPassword: string) {
  // Pre-save hook hashes the plainPassword — use plain text as input
  return SuperAdminModel.create({ email, passwordHash: plainPassword });
}

async function seedTenant() {
  return TenantModel.create({
    name:        'Test Hospital',
    adminEmail:  'admin@testhospital.com',
    status:      TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 's3-key-1',
      gstNumber:               'GST123',
      panCard:                 's3-key-2',
      addressProof:            's3-key-3',
    },
    branding: { displayName: 'Test Hospital', primaryColor: '#1A73E8' },
  });
}

async function seedUser(tenantId: string, email: string, role: UserRole, isFirstLogin = false) {
  const passwordHash = await bcrypt.hash('UserPass123!', 1);
  return UserModel.create({ tenantId, email, passwordHash, role, isActive: true, isFirstLogin });
}

function signToken(userId: string, role: UserRole, tenantId: string | null, isFirstLogin = false) {
  return jwt.sign(
    { userId, tenantId, role, email: 'test@test.com', isFirstLogin },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  test('200 — valid super admin credentials return JWT', async () => {
    await seedSuperAdmin('sa@hms.com', 'Secret123!');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sa@hms.com', password: 'Secret123!', isSuperAdmin: true });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.role).toBe(UserRole.SUPER_ADMIN);
  });

  test('401 — wrong password for super admin', async () => {
    await seedSuperAdmin('sa@hms.com', 'Secret123!');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sa@hms.com', password: 'WrongPass!', isSuperAdmin: true });

    expect(res.status).toBe(401);
  });

  test('401 — unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@hms.com', password: 'Secret123!', isSuperAdmin: true });

    expect(res.status).toBe(401);
  });

  test('400 — invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'Secret123!' });

    expect(res.status).toBe(400);
  });

  test('400 — missing password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sa@hms.com' });

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  test('200 — valid JWT logs out successfully', async () => {
    const admin = await seedSuperAdmin('sa@hms.com', 'Secret123!');
    const token = signToken(admin._id.toString(), UserRole.SUPER_ADMIN, null, false);

    const res = await request(app)
      .post('/api/auth/logout')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/logged out/i);
  });

  test('401 — logout without token returns 401', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  test('401 — token added to denylist cannot be reused', async () => {
    const admin = await seedSuperAdmin('sa@hms.com', 'Secret123!');
    const token = signToken(admin._id.toString(), UserRole.SUPER_ADMIN, null, false);

    await request(app).post('/api/auth/logout').set(bearer(token));

    // Second request with same token should be rejected
    const res = await request(app)
      .post('/api/auth/logout')
      .set(bearer(token));

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  test('200 — returns user info for valid token', async () => {
    const admin = await seedSuperAdmin('sa@hms.com', 'Secret123!');
    const token = signToken(admin._id.toString(), UserRole.SUPER_ADMIN, null, false);

    const res = await request(app)
      .get('/api/auth/me')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe(UserRole.SUPER_ADMIN);
  });

  test('401 — no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('401 — expired token', async () => {
    const expiredToken = jwt.sign(
      { userId: 'u1', tenantId: null, role: UserRole.SUPER_ADMIN, email: 'x@x.com', isFirstLogin: false },
      JWT_SECRET,
      { expiresIn: -1 },
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set(bearer(expiredToken));

    expect(res.status).toBe(401);
  });

  test('401 — token signed with wrong secret', async () => {
    const badToken = jwt.sign(
      { userId: 'u1', tenantId: null, role: UserRole.SUPER_ADMIN, email: 'x@x.com', isFirstLogin: false },
      'totally-wrong-secret',
      { expiresIn: '1h' },
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set(bearer(badToken));

    expect(res.status).toBe(401);
  });

  test('403 — isFirstLogin=true blocks access (except change-password)', async () => {
    const tenant = await seedTenant();
    const user   = await seedUser(tenant._id.toString(), 'u@h.com', UserRole.HOSPITAL_ADMIN, true);
    const token  = signToken(user._id.toString(), UserRole.HOSPITAL_ADMIN, tenant._id.toString(), true);

    const res = await request(app)
      .get('/api/auth/me')
      .set(bearer(token));

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {
  test('200 — always succeeds even for unknown email (non-disclosure)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com', tenantId: 'tenant-123' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  test('400 — missing tenantId', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(400);
  });

  test('400 — invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-valid', tenantId: 'tenant-123' });

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
describe('POST /api/auth/reset-password', () => {
  test('401 — invalid reset token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'invalid-token-xyz', newPassword: 'NewPassword123!' });

    expect(res.status).toBe(401);
  });

  test('400 — newPassword under 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'some-token', newPassword: 'short' });

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────
describe('POST /api/auth/change-password', () => {
  test('401 — no auth token', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'old', newPassword: 'NewPass123!' });

    expect(res.status).toBe(401);
  });

  test('400 — newPassword under 8 characters', async () => {
    const admin = await seedSuperAdmin('sa@hms.com', 'Secret123!');
    const token = signToken(admin._id.toString(), UserRole.SUPER_ADMIN, null, false);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: 'Secret123!', newPassword: 'short' });

    expect(res.status).toBe(400);
  });

  test('401 — wrong current password', async () => {
    const tenant = await seedTenant();
    const user   = await seedUser(tenant._id.toString(), 'u@h.com', UserRole.HOSPITAL_ADMIN, false);
    const token  = signToken(user._id.toString(), UserRole.HOSPITAL_ADMIN, tenant._id.toString(), false);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: 'WrongPassword!', newPassword: 'NewPass123!' });

    expect(res.status).toBe(401);
  });
});

// ─── GET /health ──────────────────────────────────────────────────────────────
describe('GET /health', () => {
  test('200 — health check returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
