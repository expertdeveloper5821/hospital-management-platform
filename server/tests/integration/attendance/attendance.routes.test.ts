import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose              from 'mongoose';
import request               from 'supertest';
import jwt                   from 'jsonwebtoken';

jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));

import app                 from '../../../src/app';
import { UserModel }       from '../../../src/modules/user/user.model';
import { TenantModel }     from '../../../src/modules/tenant/tenant.model';
import { AttendanceModel } from '../../../src/modules/attendance/attendance.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:       MongoMemoryServer;
let tenantId:     string;
let nurseId:      string;
let nurseToken:   string;
let adminId:      string;
let adminToken:   string;

const now   = new Date();
const month = now.getUTCMonth() + 1;
const year  = now.getUTCFullYear();

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
    name:        'Attendance Test Hospital',
    adminEmail:  'admin@attendancetest.com',
    status:      TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'cert-001',
      gstNumber:               'GST001',
      panCard:                 'PAN001',
      addressLine:            '111 Attendance Street',
      city:                    'Mumbai',
      state:                   'Maharashtra',
      pincode:                 '400001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const nurse = await UserModel.create({
    tenantId, email: 'nurse@test.com', name: 'Test Nurse', passwordHash: 'x',
    role: UserRole.NURSE, isActive: true, isFirstLogin: false,
  });
  nurseId = (nurse._id as mongoose.Types.ObjectId).toString();

  const admin = await UserModel.create({
    tenantId, email: 'hospitaladmin@test.com', name: 'Test Hospital Admin', passwordHash: 'x',
    role: UserRole.HOSPITAL_ADMIN, isActive: true, isFirstLogin: false,
  });
  adminId = (admin._id as mongoose.Types.ObjectId).toString();

  const base = { tenantId, isFirstLogin: false };
  nurseToken = jwt.sign({ ...base, userId: nurseId, role: UserRole.NURSE, email: 'nurse@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  adminToken = jwt.sign({ ...base, userId: adminId, role: UserRole.HOSPITAL_ADMIN, email: 'hospitaladmin@test.com' }, JWT_SECRET, { expiresIn: '1h' });
});

describe('POST /api/attendance/check-in', () => {
  test('201 — checks in and creates an IN_PROGRESS record', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send();

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.checkIn).toBeTruthy();
    expect(res.body.data.checkOut).toBeNull();

    const stored = await AttendanceModel.findOne({ tenantId, userId: nurseId });
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe('IN_PROGRESS');
  });

  test('409 — cannot check in twice on the same day', async () => {
    await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();
    const res = await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();

    expect(res.status).toBe(409);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).post('/api/attendance/check-in').send();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/attendance/check-out', () => {
  test('400 — cannot check out without checking in first', async () => {
    const res = await request(app).post('/api/attendance/check-out').set('Authorization', `Bearer ${nurseToken}`).send();
    expect(res.status).toBe(400);
  });

  test('200 — checks out and computes totalHours + PRESENT status', async () => {
    await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();
    const res = await request(app).post('/api/attendance/check-out').set('Authorization', `Bearer ${nurseToken}`).send();

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PRESENT');
    expect(res.body.data.checkOut).toBeTruthy();
    expect(typeof res.body.data.totalHours).toBe('number');
  });

  test('409 — cannot check out twice on the same day', async () => {
    await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();
    await request(app).post('/api/attendance/check-out').set('Authorization', `Bearer ${nurseToken}`).send();
    const res = await request(app).post('/api/attendance/check-out').set('Authorization', `Bearer ${nurseToken}`).send();

    expect(res.status).toBe(409);
  });
});

describe('GET /api/attendance/my-attendance', () => {
  test('200 — returns a day grid for the current month including today\'s IN_PROGRESS row', async () => {
    await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();

    const res = await request(app)
      .get(`/api/attendance/my-attendance?month=${month}&year=${year}`)
      .set('Authorization', `Bearer ${nurseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBeGreaterThan(0);
    const todayRow = res.body.data.records[res.body.data.records.length - 1];
    expect(todayRow.status).toBe('IN_PROGRESS');
    expect(res.body.data.summary.totalWorkingDays).toBe(res.body.data.records.length);
  });
});

describe('GET /api/attendance (admin)', () => {
  test('403 — non-admin cannot list attendance for other employees', async () => {
    const res = await request(app)
      .get(`/api/attendance?userId=${nurseId}&month=${month}&year=${year}`)
      .set('Authorization', `Bearer ${nurseToken}`);

    expect(res.status).toBe(403);
  });

  test('200 — admin can view an employee\'s monthly attendance', async () => {
    await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();

    const res = await request(app)
      .get(`/api/attendance?userId=${nurseId}&month=${month}&year=${year}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const todayRow = res.body.data.records[res.body.data.records.length - 1];
    expect(todayRow.status).toBe('IN_PROGRESS');
  });

  test('200 — admin request without userId returns a tenant-wide grid for every active employee', async () => {
    await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();

    const res = await request(app)
      .get(`/api/attendance?month=${month}&year=${year}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Both the nurse and the admin are active employees in this tenant.
    const nurseRecords = res.body.data.records.filter((r: { userId: string }) => r.userId === nurseId);
    const adminRecords = res.body.data.records.filter((r: { userId: string }) => r.userId === adminId);
    expect(nurseRecords.length).toBeGreaterThan(0);
    expect(adminRecords.length).toBeGreaterThan(0);

    const nurseToday = nurseRecords[nurseRecords.length - 1];
    expect(nurseToday.status).toBe('IN_PROGRESS');
    expect(nurseToday.employeeName).toBe('Test Nurse');

    // Admin never checked in — every one of their days is ABSENT.
    expect(adminRecords.every((r: { status: string }) => r.status === 'ABSENT')).toBe(true);
  });

  test('403 — non-admin cannot list the tenant-wide attendance grid either', async () => {
    const res = await request(app)
      .get(`/api/attendance?month=${month}&year=${year}`)
      .set('Authorization', `Bearer ${nurseToken}`);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/attendance/employees', () => {
  test('200 — admin gets every active employee of their tenant, alphabetically, excluding no one', async () => {
    const res = await request(app)
      .get('/api/attendance/employees')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((e: { name: string }) => e.name);
    expect(names).toEqual(['Test Hospital Admin', 'Test Nurse']);
  });

  test('200 — inactive employees are excluded from the roster', async () => {
    await UserModel.create({
      tenantId, email: 'inactive@test.com', name: 'Inactive Person', passwordHash: 'x',
      role: UserRole.NURSE, isActive: false, isFirstLogin: false,
    });

    const res = await request(app)
      .get('/api/attendance/employees')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((e: { name: string }) => e.name);
    expect(names).not.toContain('Inactive Person');
  });

  test("200 — employees from another tenant are never included", async () => {
    const otherTenant = await TenantModel.create({
      name:        'Other Hospital',
      adminEmail:  'admin@othertest.com',
      status:      TenantStatus.ACTIVE,
      onboardingDocuments: {
        registrationCertificate: 'cert-002',
        gstNumber:               'GST002',
        panCard:                 'PAN002',
        addressLine:            '222 Other Street',
        city:                    'Delhi',
        state:                   'Delhi',
        pincode:                 '110001',
      },
    });
    await UserModel.create({
      tenantId: (otherTenant._id as mongoose.Types.ObjectId).toString(),
      email: 'other@othertest.com', name: 'Other Hospital Nurse', passwordHash: 'x',
      role: UserRole.NURSE, isActive: true, isFirstLogin: false,
    });

    const res = await request(app)
      .get('/api/attendance/employees')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((e: { name: string }) => e.name);
    expect(names).not.toContain('Other Hospital Nurse');
  });

  test('403 — non-manager role cannot list the employee roster', async () => {
    const res = await request(app)
      .get('/api/attendance/employees')
      .set('Authorization', `Bearer ${nurseToken}`);

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/attendance/:attendanceId', () => {
  test('200 — admin corrects check-in/check-out and hours recompute', async () => {
    await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();
    const stored = await AttendanceModel.findOne({ tenantId, userId: nurseId });

    const checkIn  = new Date(Date.UTC(year, now.getUTCMonth(), now.getUTCDate(), 1, 0, 0)).toISOString();
    const checkOut = new Date(Date.UTC(year, now.getUTCMonth(), now.getUTCDate(), 9, 0, 0)).toISOString();

    const res = await request(app)
      .patch(`/api/attendance/${stored!.attendanceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ checkIn, checkOut });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PRESENT');
    expect(res.body.data.totalHours).toBe(8);

    const updated = await AttendanceModel.findOne({ tenantId, attendanceId: stored!.attendanceId });
    expect(updated!.totalHours).toBe(8);
    expect(updated!.status).toBe('PRESENT');
  });

  test('400 — checkOut before checkIn is rejected', async () => {
    await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();
    const stored = await AttendanceModel.findOne({ tenantId, userId: nurseId });

    const res = await request(app)
      .patch(`/api/attendance/${stored!.attendanceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ checkOut: new Date('2020-01-01T00:00:00.000Z').toISOString() });

    expect(res.status).toBe(400);
  });

  test('403 — non-admin cannot edit attendance', async () => {
    await request(app).post('/api/attendance/check-in').set('Authorization', `Bearer ${nurseToken}`).send();
    const stored = await AttendanceModel.findOne({ tenantId, userId: nurseId });

    const res = await request(app)
      .patch(`/api/attendance/${stored!.attendanceId}`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ checkOut: new Date().toISOString() });

    expect(res.status).toBe(403);
  });

  test('404 — unknown attendanceId', async () => {
    const res = await request(app)
      .patch('/api/attendance/ATT-DOESNOTEXIST')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ checkOut: new Date().toISOString() });

    expect(res.status).toBe(404);
  });
});
