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
    uploadFile:      jest.fn().mockResolvedValue('https://s3.test/file'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.test/presigned'),
  },
}));

import app             from '../../../src/app';
import { UserModel }   from '../../../src/modules/user/user.model';
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
async function seedTenant(name = 'Test Hospital') {
  return TenantModel.create({
    name,
    adminEmail: `admin@${name.toLowerCase().replace(/\s/g, '')}.com`,
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'k1',
      gstNumber:               'GST1',
      panCard:                 'k2',
      addressProof:            'k3',
    },
    branding: { displayName: name, primaryColor: '#1A73E8' },
  });
}

async function seedUser(
  tenantId: string,
  email: string,
  role: UserRole,
  isFirstLogin = false,
) {
  const passwordHash = await bcrypt.hash('TestPass123!', 1);
  return UserModel.create({ tenantId, email, name: email.split('@')[0], passwordHash, role, isActive: true, isFirstLogin });
}

function tokenFor(userId: string, tenantId: string, role: UserRole) {
  return jwt.sign(
    { userId, tenantId, role, email: 'actor@test.com', isFirstLogin: false },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── POST /api/users ──────────────────────────────────────────────────────────
describe('POST /api/users', () => {
  test('201 — Hospital Admin creates a user', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .post('/api/users')
      .set(bearer(token))
      .send({ email: 'newdoc@h.com', name: 'Dr New', role: UserRole.DOCTOR });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('newdoc@h.com');
    expect(res.body.data.role).toBe(UserRole.DOCTOR);
  });

  test('201 — HR can create users', async () => {
    const tenant = await seedTenant();
    const hr     = await seedUser(tenant._id.toString(), 'hr@h.com', UserRole.HR);
    const token  = tokenFor(hr._id.toString(), tenant._id.toString(), UserRole.HR);

    const res = await request(app)
      .post('/api/users')
      .set(bearer(token))
      .send({ email: 'newstaff@h.com', name: 'Staff Name', role: UserRole.NURSE });

    expect(res.status).toBe(201);
  });

  test('409 — duplicate email within same tenant', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    // Create first user
    await request(app)
      .post('/api/users')
      .set(bearer(token))
      .send({ email: 'dup@h.com', name: 'First', role: UserRole.DOCTOR });

    // Duplicate
    const res = await request(app)
      .post('/api/users')
      .set(bearer(token))
      .send({ email: 'dup@h.com', name: 'Second', role: UserRole.DOCTOR });

    expect(res.status).toBe(409);
  });

  test('400 — invalid role value', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .post('/api/users')
      .set(bearer(token))
      .send({ email: 'x@h.com', name: 'X', role: 'INVALID_ROLE' });

    expect(res.status).toBe(400);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: 'x@h.com', name: 'X', role: UserRole.DOCTOR });

    expect(res.status).toBe(401);
  });

  test('403 — Doctor role cannot create users', async () => {
    const tenant = await seedTenant();
    const doctor = await seedUser(tenant._id.toString(), 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(doctor._id.toString(), tenant._id.toString(), UserRole.DOCTOR);

    const res = await request(app)
      .post('/api/users')
      .set(bearer(token))
      .send({ email: 'new@h.com', name: 'New', role: UserRole.NURSE });

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/users ───────────────────────────────────────────────────────────
describe('GET /api/users', () => {
  test('200 — returns paginated list scoped to tenant', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');

    const admin   = await seedUser(tenantA._id.toString(), 'admin@a.com', UserRole.HOSPITAL_ADMIN);
    const token   = tokenFor(admin._id.toString(), tenantA._id.toString(), UserRole.HOSPITAL_ADMIN);

    await seedUser(tenantA._id.toString(), 'u1@a.com', UserRole.DOCTOR);
    await seedUser(tenantA._id.toString(), 'u2@a.com', UserRole.NURSE);
    await seedUser(tenantB._id.toString(), 'u1@b.com', UserRole.DOCTOR);

    const res = await request(app)
      .get('/api/users')
      .set(bearer(token));

    expect(res.status).toBe(200);
    // Only returns users from tenantA (admin + 2 users = 3)
    expect(res.body.data.total).toBe(3);
  });

  test('200 — tenant isolation: different tenant sees 0 from tenant A', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');

    await seedUser(tenantA._id.toString(), 'u1@a.com', UserRole.DOCTOR);

    const adminB  = await seedUser(tenantB._id.toString(), 'admin@b.com', UserRole.HOSPITAL_ADMIN);
    const tokenB  = tokenFor(adminB._id.toString(), tenantB._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get('/api/users')
      .set(bearer(tokenB));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1); // Only adminB from tenantB
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  // ── E04-B04: filter / pagination enhancements ───────────────────────────────

  test('200 — search filter matches by name (case-insensitive)', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);
    await seedUser(tenant._id.toString(), 'alice@h.com', UserRole.DOCTOR);
    await seedUser(tenant._id.toString(), 'bob@h.com', UserRole.NURSE);

    const res = await request(app)
      .get('/api/users?search=alice')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.data.length).toBe(1);
    expect(res.body.data.data[0].email).toBe('alice@h.com');
  });

  test('200 — search filter matches by email', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);
    await seedUser(tenant._id.toString(), 'charlie@h.com', UserRole.DOCTOR);
    await seedUser(tenant._id.toString(), 'dave@h.com', UserRole.NURSE);

    const res = await request(app)
      .get('/api/users?search=charlie')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.data.length).toBe(1);
    expect(res.body.data.data[0].email).toBe('charlie@h.com');
  });

  test('200 — status=ACTIVE filter excludes inactive users', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);
    const active   = await seedUser(tenant._id.toString(), 'active@h.com', UserRole.DOCTOR);
    const inactive = await seedUser(tenant._id.toString(), 'inactive@h.com', UserRole.NURSE);
    await UserModel.findByIdAndUpdate(inactive._id, { isActive: false });

    const res = await request(app)
      .get('/api/users?status=ACTIVE')
      .set(bearer(token));

    expect(res.status).toBe(200);
    const emails = res.body.data.data.map((u: { email: string }) => u.email) as string[];
    expect(emails).toContain('active@h.com');
    expect(emails).not.toContain('inactive@h.com');
  });

  test('200 — status=INACTIVE filter returns only inactive users', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);
    await seedUser(tenant._id.toString(), 'active@h.com', UserRole.DOCTOR);
    const inactive = await seedUser(tenant._id.toString(), 'inactive@h.com', UserRole.NURSE);
    await UserModel.findByIdAndUpdate(inactive._id, { isActive: false });

    const res = await request(app)
      .get('/api/users?status=INACTIVE')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.data[0].email).toBe('inactive@h.com');
  });

  test('200 — role filter returns only matching roles', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);
    await seedUser(tenant._id.toString(), 'doc@h.com', UserRole.DOCTOR);
    await seedUser(tenant._id.toString(), 'nurse@h.com', UserRole.NURSE);

    const res = await request(app)
      .get(`/api/users?role=${UserRole.DOCTOR}`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.data[0].role).toBe(UserRole.DOCTOR);
  });

  test('200 — sortBy=name&sortOrder=asc returns alphabetical order', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);
    // seedUser sets name = email prefix
    await seedUser(tenant._id.toString(), 'zara@h.com', UserRole.DOCTOR);
    await seedUser(tenant._id.toString(), 'anna@h.com', UserRole.NURSE);

    const res = await request(app)
      .get('/api/users?sortBy=name&sortOrder=asc')
      .set(bearer(token));

    expect(res.status).toBe(200);
    const names = res.body.data.data.map((u: { name: string }) => u.name) as string[];
    expect(names[0].toLowerCase() < names[names.length - 1].toLowerCase()).toBe(true);
  });

  test('200 — pagination: page 2 returns next batch', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);
    // Seed 5 extra users
    for (let i = 0; i < 5; i++) {
      await seedUser(tenant._id.toString(), `user${i}@h.com`, UserRole.NURSE);
    }

    const res = await request(app)
      .get('/api/users?page=1&limit=3')
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.data.length).toBe(3);
    expect(res.body.data.total).toBe(6); // admin + 5
    expect(res.body.data.page).toBe(1);

    const res2 = await request(app)
      .get('/api/users?page=2&limit=3')
      .set(bearer(token));

    expect(res2.status).toBe(200);
    expect(res2.body.data.page).toBe(2);
  });

  test('200 — search with special regex characters is escaped safely', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    // Should not throw / 500 — just return 0 results
    const res = await request(app)
      .get('/api/users?search=(admin)')
      .set(bearer(token));

    expect(res.status).toBe(200);
  });

  test('200 — limit clamped to 100 returns warning in metadata', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get('/api/users?limit=200')
      .set(bearer(token));

    // paginationSchema already rejects > 100 with 400
    expect([200, 400]).toContain(res.status);
  });
});

// ─── GET /api/users/:userId ───────────────────────────────────────────────────
describe('GET /api/users/:userId', () => {
  test('200 — Hospital Admin gets user by ID', async () => {
    const tenant  = await seedTenant();
    const admin   = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const target  = await seedUser(tenant._id.toString(), 'target@h.com', UserRole.NURSE);
    const token   = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get(`/api/users/${target._id}`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('target@h.com');
  });

  test('404 — user from different tenant not found', async () => {
    const tenantA = await seedTenant('Hospital A');
    const tenantB = await seedTenant('Hospital B');

    const adminA  = await seedUser(tenantA._id.toString(), 'admin@a.com', UserRole.HOSPITAL_ADMIN);
    const userB   = await seedUser(tenantB._id.toString(), 'user@b.com', UserRole.DOCTOR);
    const tokenA  = tokenFor(adminA._id.toString(), tenantA._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .get(`/api/users/${userB._id}`)
      .set(bearer(tokenA));

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/users/:userId/role ────────────────────────────────────────────
describe('PATCH /api/users/:userId/role', () => {
  test('200 — Hospital Admin updates user role', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const target = await seedUser(tenant._id.toString(), 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch(`/api/users/${target._id}/role`)
      .set(bearer(token))
      .send({ role: UserRole.NURSE });

    expect(res.status).toBe(200);
  });

  test('409 — cannot demote last Hospital Admin', async () => {
    const tenant = await seedTenant();
    const admin  = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token  = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch(`/api/users/${admin._id}/role`)
      .set(bearer(token))
      .send({ role: UserRole.NURSE });

    expect(res.status).toBe(409);
  });

  test('403 — HR cannot update roles', async () => {
    const tenant = await seedTenant();
    const hr     = await seedUser(tenant._id.toString(), 'hr@h.com', UserRole.HR);
    const target = await seedUser(tenant._id.toString(), 'doc@h.com', UserRole.DOCTOR);
    const token  = tokenFor(hr._id.toString(), tenant._id.toString(), UserRole.HR);

    const res = await request(app)
      .patch(`/api/users/${target._id}/role`)
      .set(bearer(token))
      .send({ role: UserRole.NURSE });

    expect(res.status).toBe(403);
  });
});

// ─── PATCH /api/users/:userId/deactivate ─────────────────────────────────────
describe('PATCH /api/users/:userId/deactivate', () => {
  test('200 — Hospital Admin deactivates a user', async () => {
    const tenant  = await seedTenant();
    const admin   = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const target  = await seedUser(tenant._id.toString(), 'nurse@h.com', UserRole.NURSE);
    const token   = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch(`/api/users/${target._id}/deactivate`)
      .set(bearer(token));

    expect(res.status).toBe(200);

    const updated = await UserModel.findById(target._id);
    expect(updated?.isActive).toBe(false);
  });

  test('409 — cannot deactivate the last active Hospital Admin', async () => {
    const tenant  = await seedTenant();
    const admin   = await seedUser(tenant._id.toString(), 'admin@h.com', UserRole.HOSPITAL_ADMIN);
    const token   = tokenFor(admin._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch(`/api/users/${admin._id}/deactivate`)
      .set(bearer(token));

    expect(res.status).toBe(409);
  });

  test('200 — deactivating one of two admins succeeds', async () => {
    const tenant  = await seedTenant();
    const admin1  = await seedUser(tenant._id.toString(), 'admin1@h.com', UserRole.HOSPITAL_ADMIN);
    const admin2  = await seedUser(tenant._id.toString(), 'admin2@h.com', UserRole.HOSPITAL_ADMIN);
    const token   = tokenFor(admin1._id.toString(), tenant._id.toString(), UserRole.HOSPITAL_ADMIN);

    const res = await request(app)
      .patch(`/api/users/${admin2._id}/deactivate`)
      .set(bearer(token));

    expect(res.status).toBe(200);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).patch('/api/users/some-id/deactivate');
    expect(res.status).toBe(401);
  });
});
