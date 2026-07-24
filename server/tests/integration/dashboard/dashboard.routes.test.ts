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
import { OPDVisitModel } from '../../../src/modules/opd/opd.model';
import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../../../src/modules/lab/lab.model';
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
      addressLine:            '123 Dashboard Street',
      city:                    'Mumbai',
      state:                   'Maharashtra',
      pincode:                 '400001',
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
    expect(data).not.toHaveProperty('admissionsToday'); // removed for every role
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
    expect(data).not.toHaveProperty('admissionsToday'); // removed for every role
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
    expect(data).not.toHaveProperty('admissionsToday'); // removed for every role
  });

  test('DOCTOR response includes only doctor-scoped clinical fields — no hospital-wide beds/trend/staff/revenue/inventory', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.DOCTOR, 'doc-scope-1')}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveProperty('totalPatients');
    expect(data).toHaveProperty('todayOpdCount');
    expect(data).toHaveProperty('activeIpdCount');
    expect(data).toHaveProperty('pendingLabCount');
    expect(data).toHaveProperty('labReportsToday');
    expect(data).not.toHaveProperty('totalBeds');
    expect(data).not.toHaveProperty('occupiedBeds');
    expect(data).not.toHaveProperty('monthlyOpdTrend');
    expect(data).not.toHaveProperty('monthlyRevenueTrend');
    expect(data).not.toHaveProperty('totalActiveStaff');
    expect(data).not.toHaveProperty('revenueToday');
    expect(data).not.toHaveProperty('lowStockCount');
    expect(data).not.toHaveProperty('totalInventoryItems');
    expect(data).not.toHaveProperty('admissionsToday'); // removed for every role
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
    expect(data).not.toHaveProperty('admissionsToday'); // removed for every role
  });
});

// ─── Doctor dashboard is scoped to the logged-in doctor ───────────────────────

describe('GET /api/dashboard/stats — Doctor dashboard data is scoped by doctor userId', () => {
  const DOCTOR_A = 'doctor-a-001';
  const DOCTOR_B = 'doctor-b-001';
  const today = new Date();

  beforeEach(async () => {
    await UserModel.create([
      { tenantId, email: 'doc-a@dashtest.com', name: 'Doctor A', passwordHash: 'x', role: UserRole.DOCTOR, isActive: true, isFirstLogin: false },
      { tenantId, email: 'doc-b@dashtest.com', name: 'Doctor B', passwordHash: 'x', role: UserRole.DOCTOR, isActive: true, isFirstLogin: false },
    ]);

    // Doctor A: 2 OPD visits today (2 distinct patients) + 1 active IPD admission (a 3rd patient).
    await OPDVisitModel.create([
      { visitId: 'v-a-1', tenantId, patientId: 'PAT-A1', doctorIds: [DOCTOR_A], visitDate: today, queueNumber: 1, status: 'OPEN', chiefComplaint: 'Fever' },
      { visitId: 'v-a-2', tenantId, patientId: 'PAT-A2', doctorIds: [DOCTOR_A], visitDate: today, queueNumber: 2, status: 'OPEN', chiefComplaint: 'Cough' },
    ]);
    await IPDAdmissionModel.create([
      { admissionId: 'adm-a-1', tenantId, patientId: 'PAT-A3', wardId: 'w1', bedId: 'b1', bedNumber: '1', wardName: 'General', assignedDoctorIds: [DOCTOR_A], status: 'ADMITTED', admissionDate: today },
    ]);
    // A pending pathology request Doctor A personally requested (patient not otherwise theirs).
    await PathologyRequestModel.create({
      requestId: 'path-a-1', tenantId, patientId: 'PAT-A4', requestedBy: DOCTOR_A,
      testType: 'CBC', status: 'PENDING', priority: 'NORMAL', requestedAt: today,
    });
    // A radiology request completed today for one of Doctor A's own OPD patients, requested by someone else.
    await RadiologyRequestModel.create({
      requestId: 'radio-a-1', tenantId, patientId: 'PAT-A1', requestedBy: 'some-radiologist',
      imagingType: 'Chest X-Ray', status: 'COMPLETED', priority: 'NORMAL', requestedAt: today,
    });

    // Doctor B: different visits/admissions/requests entirely — must never appear in Doctor A's stats.
    await OPDVisitModel.create([
      { visitId: 'v-b-1', tenantId, patientId: 'PAT-B1', doctorIds: [DOCTOR_B], visitDate: today, queueNumber: 3, status: 'OPEN', chiefComplaint: 'Headache' },
    ]);
    await IPDAdmissionModel.create([
      { admissionId: 'adm-b-1', tenantId, patientId: 'PAT-B2', wardId: 'w1', bedId: 'b2', bedNumber: '2', wardName: 'General', assignedDoctorIds: [DOCTOR_B], status: 'ADMITTED', admissionDate: today },
      { admissionId: 'adm-b-2', tenantId, patientId: 'PAT-B3', wardId: 'w1', bedId: 'b3', bedNumber: '3', wardName: 'General', assignedDoctorIds: [DOCTOR_B], status: 'ADMITTED', admissionDate: today },
    ]);
    await PathologyRequestModel.create({
      requestId: 'path-b-1', tenantId, patientId: 'PAT-B1', requestedBy: DOCTOR_B,
      testType: 'Lipid Profile', status: 'PENDING', priority: 'NORMAL', requestedAt: today,
    });
  });

  test("Doctor A's stats reflect only Doctor A's own patients/visits/admissions/requests", async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.DOCTOR, DOCTOR_A)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    // PAT-A1, PAT-A2 (OPD) + PAT-A3 (IPD) — PAT-A4 has no OPD/IPD record, so it is not
    // counted as a "treated" patient even though a lab request references it.
    expect(data.totalPatients).toBe(3);
    expect(data.todayOpdCount).toBe(2);
    expect(data.activeIpdCount).toBe(1);
    // Pending: path-a-1 (requestedBy Doctor A). path-b-1 belongs to Doctor B — excluded.
    expect(data.pendingLabCount).toBe(1);
    // Completed today: radio-a-1, for Doctor A's own patient PAT-A1 even though requested by someone else.
    expect(data.labReportsToday).toBe(1);
  });

  test("Doctor B's stats are independent of Doctor A's data", async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.DOCTOR, DOCTOR_B)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.totalPatients).toBe(3);   // PAT-B1, PAT-B2, PAT-B3
    expect(data.todayOpdCount).toBe(1);
    expect(data.activeIpdCount).toBe(2);
    expect(data.pendingLabCount).toBe(1); // path-b-1 only
    expect(data.labReportsToday).toBe(0); // no completed requests for Doctor B
  });

  test('a doctor with no records at all sees all-zero doctor-scoped stats, not the tenant totals', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.DOCTOR, 'doctor-with-nothing')}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.totalPatients).toBe(0);
    expect(data.todayOpdCount).toBe(0);
    expect(data.activeIpdCount).toBe(0);
    expect(data.pendingLabCount).toBe(0);
    expect(data.labReportsToday).toBe(0);
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
