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

import app              from '../../../src/app';
import { UserModel }    from '../../../src/modules/user/user.model';
import { TenantModel }  from '../../../src/modules/tenant/tenant.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { clearDashboardCache } from '../../../src/modules/dashboard/dashboard.service';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:      MongoMemoryServer;
let tenantId:    string;

function makeToken(role: UserRole, userId = 'user-001'): string {
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
  clearDashboardCache();

  const tenant = await TenantModel.create({
    name:       'Dashboard Test Hospital',
    adminEmail: 'admin@dashtest.com',
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg-001',
      gstNumber:               'GST001',
      panCard:                 'PAN001',
      addressProof:            'addr-001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  await UserModel.create({
    tenantId,
    email:        'admin@dashtest.com',
    name:         'Dash Admin',
    passwordHash: 'x',
    role:         UserRole.ADMIN,
    isActive:     true,
    isFirstLogin: false,
  });
});

// ─── Auth enforcement ─────────────────────────────────────────────────────────

describe('GET /api/dashboard/stats — auth enforcement', () => {
  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(401);
  });

  test('returns 200 for HOSPITAL_ADMIN role', async () => {
    const token = jwt.sign(
      { userId: 'ha-001', tenantId, role: UserRole.HOSPITAL_ADMIN, email: 'ha@test.com', isFirstLogin: false },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('returns 200 for FINANCE_MANAGER role', async () => {
    const token = makeToken(UserRole.FINANCE_MANAGER);
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ─── Permitted roles ──────────────────────────────────────────────────────────

describe('GET /api/dashboard/stats — permitted roles return 200', () => {
  const permittedRoles: UserRole[] = [
    UserRole.HOSPITAL_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.RECEPTIONIST,
    UserRole.STAFF,
  ];

  for (const role of permittedRoles) {
    test(`returns 200 for role: ${role}`, async () => {
      const res = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${makeToken(role)}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('lastUpdated');
    });
  }
});

// ─── Role-scoped field filtering ──────────────────────────────────────────────

describe('GET /api/dashboard/stats — role-scoped field filtering', () => {
  test('ADMIN response includes all fields', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveProperty('totalPatients');
    expect(data).toHaveProperty('todayOpdCount');
    expect(data).toHaveProperty('activeIpdCount');
    expect(data).toHaveProperty('pendingLabCount');
    expect(data).toHaveProperty('revenueToday');
    expect(data).toHaveProperty('revenueThisMonth');
    expect(data).toHaveProperty('lowStockCount');
    expect(data).toHaveProperty('totalActiveStaff');
    expect(data).toHaveProperty('monthlyOpdTrend');
    expect(data).toHaveProperty('monthlyRevenueTrend');
  });

  test('RECEPTIONIST response excludes revenue, IPD, lab, staff fields', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.RECEPTIONIST)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveProperty('totalPatients');
    expect(data).toHaveProperty('todayOpdCount');
    expect(data).not.toHaveProperty('activeIpdCount');
    expect(data).not.toHaveProperty('pendingLabCount');
    expect(data).not.toHaveProperty('revenueToday');
    expect(data).not.toHaveProperty('revenueThisMonth');
    expect(data).not.toHaveProperty('lowStockCount');
    expect(data).not.toHaveProperty('totalActiveStaff');
    expect(data).not.toHaveProperty('monthlyOpdTrend');
    expect(data).not.toHaveProperty('monthlyRevenueTrend');
  });

  test('NURSE response includes patients, OPD, IPD but not revenue or staff', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.NURSE)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveProperty('totalPatients');
    expect(data).toHaveProperty('todayOpdCount');
    expect(data).toHaveProperty('activeIpdCount');
    expect(data).not.toHaveProperty('pendingLabCount');
    expect(data).not.toHaveProperty('revenueToday');
  });

  test('STAFF response has only lastUpdated (no stat fields)', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.STAFF)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveProperty('lastUpdated');
    expect(data).not.toHaveProperty('totalPatients');
    expect(data).not.toHaveProperty('todayOpdCount');
  });
});

// ─── ?refresh=true bypass ─────────────────────────────────────────────────────

describe('GET /api/dashboard/stats?refresh=true', () => {
  test('returns fresh data without using cache', async () => {
    const token = makeToken(UserRole.ADMIN);

    const first = await request(app)
      .get('/api/dashboard/stats?refresh=true')
      .set('Authorization', `Bearer ${token}`);

    const second = await request(app)
      .get('/api/dashboard/stats?refresh=true')
      .set('Authorization', `Bearer ${token}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Both should have a lastUpdated timestamp
    expect(first.body.data.lastUpdated).toBeTruthy();
    expect(second.body.data.lastUpdated).toBeTruthy();
  });
});

// ─── Zero-value defaults ──────────────────────────────────────────────────────

describe('GET /api/dashboard/stats — zero-value defaults', () => {
  test('numeric fields default to 0 when no data exists', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.totalPatients).toBe(0);
    expect(data.todayOpdCount).toBe(0);
    expect(data.activeIpdCount).toBe(0);
    expect(data.pendingLabCount).toBe(0);
    expect(data.revenueToday).toBe(0);
    expect(data.revenueThisMonth).toBe(0);
    expect(data.lowStockCount).toBe(0);
    expect(Array.isArray(data.monthlyOpdTrend)).toBe(true);
    expect(Array.isArray(data.monthlyRevenueTrend)).toBe(true);
  });
});
