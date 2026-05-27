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
    onboardingDocuments: { registrationCertificate: 'r', gstNumber: 'G', panCard: 'P', addressProof: 'A' },
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
});

// ─── PATCH /api/notifications/:notificationId/read ────────────────────────────

describe('PATCH /api/notifications/:notificationId/read', () => {
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
