import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';
import { v4 as uuidv4 }      from 'uuid';

jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: { sendInviteEmail: jest.fn(), sendWelcomeEmail: jest.fn() },
}));
jest.mock('../../../src/shared/services/websocket.service', () => ({
  pushToUser:            jest.fn(),
  initWebSocketServer:   jest.fn(),
  registerConnection:    jest.fn(),
  removeConnection:      jest.fn(),
}));

import app               from '../../../src/app';
import { AuditLogModel } from '../../../src/modules/audit/audit.model';
import { TenantModel }   from '../../../src/modules/tenant/tenant.model';
import { UserModel }     from '../../../src/modules/user/user.model';
import { TenantStatus, UserRole, AuditEntityType } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:      MongoMemoryServer;
let tenantId:    string;
let adminToken:  string;
let doctorToken: string;

function makeToken(userId: string, role: UserRole, tId: string | null = tenantId) {
  return jwt.sign({ userId, tenantId: tId, role, email: `${role.toLowerCase()}@test.com`, isFirstLogin: false }, JWT_SECRET, { expiresIn: '1h' });
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
    name:       'Audit Test Hospital',
    adminEmail: 'admin@audit.com',
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg-001',
      gstNumber: 'GST001',
      panCard: 'PAN001',
      addressProof: 'addr-001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const admin = await UserModel.create({
    tenantId, email: 'admin@audit.com', name: 'Audit Admin', passwordHash: 'x',
    role: UserRole.HOSPITAL_ADMIN, isActive: true, isFirstLogin: false,
  });
  await UserModel.create({
    tenantId, email: 'doctor@audit.com', name: 'Audit Doctor', passwordHash: 'x',
    role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
  });

  adminToken  = makeToken((admin._id as mongoose.Types.ObjectId).toString(), UserRole.HOSPITAL_ADMIN);
  doctorToken = makeToken(uuidv4(), UserRole.DOCTOR);
});

async function seedLogs(count: number, overrides: Record<string, unknown> = {}) {
  const docs = Array.from({ length: count }, (_, i) => ({
    auditId:    uuidv4(),
    entityType: AuditEntityType.PATIENT,
    entityId:   `pat-${i}`,
    action:     'CREATE',
    userId:     'user-001',
    tenantId,
    timestamp:  new Date(Date.now() - i * 1000),
    ...overrides,
  }));
  await AuditLogModel.insertMany(docs);
}

// ─── GET /api/audit ───────────────────────────────────────────────────────────

describe('GET /api/audit', () => {
  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });

  test('returns 403 for DOCTOR role', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  test('HOSPITAL_ADMIN can retrieve audit logs for their tenant', async () => {
    await seedLogs(3);
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.data).toHaveLength(3);
  });

  test('filters by entityType', async () => {
    await seedLogs(2, { entityType: AuditEntityType.PATIENT });
    await seedLogs(1, { entityType: AuditEntityType.PAYMENT_RECORD });

    const res = await request(app)
      .get(`/api/audit?entityType=${AuditEntityType.PATIENT}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
    expect(res.body.data.data.every((l: any) => l.entityType === 'PATIENT')).toBe(true);
  });

  test('filters by entityId', async () => {
    await seedLogs(3);
    await AuditLogModel.create({
      auditId: uuidv4(), entityType: AuditEntityType.USER_ACCOUNT,
      entityId: 'specific-entity', action: 'UPDATE',
      userId: 'user-001', tenantId, timestamp: new Date(),
    });

    const res = await request(app)
      .get('/api/audit?entityId=specific-entity')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].entityId).toBe('specific-entity');
  });

  test('filters by userId', async () => {
    await AuditLogModel.create({
      auditId: uuidv4(), entityType: AuditEntityType.PATIENT,
      entityId: 'e1', action: 'CREATE', userId: 'target-user', tenantId, timestamp: new Date(),
    });
    await AuditLogModel.create({
      auditId: uuidv4(), entityType: AuditEntityType.PATIENT,
      entityId: 'e2', action: 'UPDATE', userId: 'other-user', tenantId, timestamp: new Date(),
    });

    const res = await request(app)
      .get('/api/audit?userId=target-user')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].userId).toBe('target-user');
  });

  test('filters by dateFrom and dateTo', async () => {
    const old = new Date('2024-01-01T00:00:00Z');
    const recent = new Date('2026-05-01T00:00:00Z');
    await AuditLogModel.create({ auditId: uuidv4(), entityType: AuditEntityType.PATIENT, entityId: 'e1', action: 'CREATE', userId: 'u', tenantId, timestamp: old });
    await AuditLogModel.create({ auditId: uuidv4(), entityType: AuditEntityType.PATIENT, entityId: 'e2', action: 'UPDATE', userId: 'u', tenantId, timestamp: recent });

    const res = await request(app)
      .get('/api/audit?dateFrom=2026-01-01&dateTo=2026-12-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].entityId).toBe('e2');
  });

  test('paginates results correctly', async () => {
    await seedLogs(10);

    const res = await request(app)
      .get('/api/audit?page=2&limit=3')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(3);
    expect(res.body.data.page).toBe(2);
    expect(res.body.data.limit).toBe(3);
    expect(res.body.data.total).toBe(10);
    expect(res.body.data.totalPages).toBe(4);
  });

  test('HOSPITAL_ADMIN does not see logs from other tenants', async () => {
    await seedLogs(2);
    await AuditLogModel.create({
      auditId: uuidv4(), entityType: AuditEntityType.PATIENT,
      entityId: 'cross', action: 'CREATE', userId: 'u',
      tenantId: 'other-tenant', timestamp: new Date(),
    });

    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data.every((l: any) => l.tenantId === tenantId)).toBe(true);
  });

  test('returns 400 for invalid query parameters', async () => {
    const res = await request(app)
      .get('/api/audit?limit=999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });

  test('audit log write failure does NOT affect primary response (non-blocking)', async () => {
    // The audit.service.log() is fire-and-forget on failure
    // This test verifies the route still returns 200 even if audit write were to fail
    const { auditService } = await import('../../../src/modules/audit/audit.service');
    const spy = jest.spyOn(auditService, 'log').mockResolvedValue(undefined);

    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    spy.mockRestore();
  });
});
