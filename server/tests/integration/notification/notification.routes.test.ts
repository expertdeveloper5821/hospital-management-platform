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
jest.mock('../../../src/shared/services/websocket.service', () => ({
  pushToUser:          jest.fn(),
  initWebSocketServer: jest.fn(),
  registerConnection:  jest.fn(),
  removeConnection:    jest.fn(),
}));

import app                  from '../../../src/app';
import { NotificationModel } from '../../../src/modules/notification/notification.model';
import { TenantModel }       from '../../../src/modules/tenant/tenant.model';
import { UserModel }         from '../../../src/modules/user/user.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';
import { auditService }      from '../../../src/shared/services/audit.service';

const mockAuditLog = auditService.log as jest.Mock;

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:   MongoMemoryServer;
let tenantId: string;
let userId:   string;
let token:    string;

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
    name: 'Notif Test Hospital', adminEmail: 'admin@notif.com',
    status: TenantStatus.ACTIVE,
    onboardingDocuments: { registrationCertificate: 'r', gstNumber: 'G', panCard: 'P', addressLine: 'A', city: 'B', state: 'C', pincode: '400001' },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const user = await UserModel.create({
    tenantId, email: 'doctor@notif.com', name: 'Notif Doctor', passwordHash: 'x',
    role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
  });
  userId = (user._id as mongoose.Types.ObjectId).toString();

  token = jwt.sign(
    { userId, tenantId, role: UserRole.DOCTOR, email: 'doctor@notif.com', isFirstLogin: false },
    JWT_SECRET, { expiresIn: '1h' },
  );

  mockAuditLog.mockClear();
});

async function seedNotification(overrides: Record<string, unknown> = {}) {
  return NotificationModel.create({
    notificationId: uuidv4(),
    userId,
    tenantId,
    title:   'Test',
    message: 'Test body',
    isRead:  false,
    ...overrides,
  });
}

// ─── GET /api/notifications ───────────────────────────────────────────────────

describe('GET /api/notifications', () => {
  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  // Regression test: scopeTenant bypasses tenant checks for SUPER_ADMIN, so
  // without requireRole here the controller's req.user!.tenantId (null) would
  // reach the repository's tenant-scoped query instead of being rejected.
  test('returns 403 for a role outside tenant scope (e.g. SUPER_ADMIN)', async () => {
    const superAdminToken = jwt.sign(
      { userId: 'super-1', tenantId: null, role: UserRole.SUPER_ADMIN, email: 'super@notif.com', isFirstLogin: false },
      JWT_SECRET, { expiresIn: '1h' },
    );

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(403);
  });

  test('returns notifications for authenticated user', async () => {
    await seedNotification({ title: 'A' });
    await seedNotification({ title: 'B' });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveLength(2);
  });

  test('only returns notifications within last 30 days', async () => {
    await seedNotification({ title: 'Recent' }); // now — within 30 days
    await NotificationModel.create({
      notificationId: uuidv4(), userId, tenantId,
      title: 'Old', message: 'Old body', isRead: false,
      createdAt: new Date('2020-01-01'), // far in the past
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Recent');
  });

  test('does not return notifications belonging to other users', async () => {
    await seedNotification({ userId: 'other-user-id', title: 'Other' });
    await seedNotification({ title: 'Mine' });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Mine');
  });

  test('respects limit query param', async () => {
    await Promise.all(Array.from({ length: 5 }, () => seedNotification()));

    const res = await request(app)
      .get('/api/notifications?limit=3')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });
});

// ─── GET /api/notifications/unread-count ──────────────────────────────────────

describe('GET /api/notifications/unread-count', () => {
  test('returns count of unread notifications', async () => {
    await seedNotification({ isRead: false });
    await seedNotification({ isRead: false });
    await seedNotification({ isRead: true });

    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);
  });

  test('returns 0 when all notifications are read', async () => {
    await seedNotification({ isRead: true });

    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(0);
  });

  // Regression test: countUnread previously had no date cap while the list
  // endpoint capped history at 30 days (FR-N-04), so a stale unread notification
  // older than 30 days would inflate the badge forever with no way to reach it
  // via "Mark all as read" (it never appears in the fetched list).
  test('does not count unread notifications older than 30 days', async () => {
    await seedNotification({ isRead: false }); // recent — within 30 days
    await NotificationModel.create({
      notificationId: uuidv4(), userId, tenantId,
      title: 'Old', message: 'Old body', isRead: false,
      createdAt: new Date('2020-01-01'), // far in the past
    });

    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });

  test('returns 403 for a role outside tenant scope (e.g. SUPER_ADMIN)', async () => {
    const superAdminToken = jwt.sign(
      { userId: 'super-1', tenantId: null, role: UserRole.SUPER_ADMIN, email: 'super@notif.com', isFirstLogin: false },
      JWT_SECRET, { expiresIn: '1h' },
    );

    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── PATCH /api/notifications/:notificationId/read ────────────────────────────

describe('PATCH /api/notifications/:notificationId/read', () => {
  test('returns 403 for a role outside tenant scope (e.g. SUPER_ADMIN)', async () => {
    const notif = await seedNotification({ isRead: false });
    const superAdminToken = jwt.sign(
      { userId: 'super-1', tenantId: null, role: UserRole.SUPER_ADMIN, email: 'super@notif.com', isFirstLogin: false },
      JWT_SECRET, { expiresIn: '1h' },
    );

    const res = await request(app)
      .patch(`/api/notifications/${notif.notificationId}/read`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(403);
  });

  test('marks a notification as read', async () => {
    const notif = await seedNotification({ isRead: false });

    const res = await request(app)
      .patch(`/api/notifications/${notif.notificationId}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isRead).toBe(true);
  });

  test('is idempotent — calling twice returns isRead=true both times', async () => {
    const notif = await seedNotification({ isRead: false });

    const first = await request(app)
      .patch(`/api/notifications/${notif.notificationId}/read`)
      .set('Authorization', `Bearer ${token}`);
    const second = await request(app)
      .patch(`/api/notifications/${notif.notificationId}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.isRead).toBe(true);
    expect(second.body.data.isRead).toBe(true);
  });

  test('returns 404 for non-existent notificationId', async () => {
    const res = await request(app)
      .patch(`/api/notifications/${uuidv4()}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid UUID notificationId', async () => {
    const res = await request(app)
      .patch('/api/notifications/not-a-uuid/read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  test('cannot mark another user\'s notification as read', async () => {
    const notif = await seedNotification({ userId: 'other-user', isRead: false });

    const res = await request(app)
      .patch(`/api/notifications/${notif.notificationId}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/notifications/mark-all-read ───────────────────────────────────

describe('PATCH /api/notifications/mark-all-read', () => {
  test('returns 401 without token', async () => {
    const res = await request(app).patch('/api/notifications/mark-all-read');
    expect(res.status).toBe(401);
  });

  test('marks every unread notification for the user as read', async () => {
    await seedNotification({ isRead: false });
    await seedNotification({ isRead: false });
    await seedNotification({ isRead: true });

    const res = await request(app)
      .patch('/api/notifications/mark-all-read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);

    const unread = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);
    expect(unread.body.data.count).toBe(0);
  });

  test('also clears unread notifications older than 30 days (unlike the badge count/list)', async () => {
    await NotificationModel.create({
      notificationId: uuidv4(), userId, tenantId,
      title: 'Old', message: 'Old body', isRead: false,
      createdAt: new Date('2020-01-01'),
    });

    const res = await request(app)
      .patch('/api/notifications/mark-all-read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });

  test('does not affect another user\'s notifications', async () => {
    await seedNotification({ userId: 'other-user', isRead: false });
    await seedNotification({ isRead: false });

    const res = await request(app)
      .patch('/api/notifications/mark-all-read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);

    const other = await NotificationModel.findOne({ userId: 'other-user' });
    expect(other?.isRead).toBe(false);
  });

  test('is idempotent — returns 0 modified on a second call', async () => {
    await seedNotification({ isRead: false });

    await request(app).patch('/api/notifications/mark-all-read').set('Authorization', `Bearer ${token}`);
    const second = await request(app)
      .patch('/api/notifications/mark-all-read')
      .set('Authorization', `Bearer ${token}`);

    expect(second.status).toBe(200);
    expect(second.body.data.count).toBe(0);
  });

  test('returns 403 for a role outside tenant scope (e.g. SUPER_ADMIN)', async () => {
    const superAdminToken = jwt.sign(
      { userId: 'super-1', tenantId: null, role: UserRole.SUPER_ADMIN, email: 'super@notif.com', isFirstLogin: false },
      JWT_SECRET, { expiresIn: '1h' },
    );

    const res = await request(app)
      .patch('/api/notifications/mark-all-read')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(403);
  });

  test('writes an audit log entry after successfully marking notifications read', async () => {
    await seedNotification({ isRead: false });
    await seedNotification({ isRead: false });

    const res = await request(app)
      .patch('/api/notifications/mark-all-read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'NOTIFICATION',
        action:     'UPDATE',
        userId,
        tenantId,
        newValue:   { count: 2 },
      }),
    );
  });
});
