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
import { PaymentModel }      from '../../../src/modules/payment/payment.model';
import { PaymentMethod, PaymentStatus } from '../../../src/modules/payment/payment.types';
import { InventoryItemModel } from '../../../src/modules/inventory/inventory.model';
import { PatientModel }      from '../../../src/modules/patient/patient.model';
import { Gender }            from '../../../src/modules/patient/patient.types';
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
    // Hospital Overview — This Month / Today counterparts (Today reuses todayOpdCount above).
    expect(data).toHaveProperty('opdCountThisMonth');
    expect(data).toHaveProperty('pendingLabCountToday');
    expect(data).toHaveProperty('pendingLabCountThisMonth');
    expect(data).toHaveProperty('pendingPaymentsCountToday');
    expect(data).toHaveProperty('pendingPaymentsCountThisMonth');
    expect(data).toHaveProperty('lowStockCountToday');
    expect(data).toHaveProperty('lowStockCountThisMonth');
    // Former Key Stats Strip metrics, now folded into Hospital Overview.
    expect(data).toHaveProperty('newRegistrationsThisMonth');
    expect(data).toHaveProperty('activeIpdCountToday');
    expect(data).toHaveProperty('activeIpdCountThisMonth');
    expect(data).toHaveProperty('totalActiveStaffToday');
    expect(data).toHaveProperty('totalActiveStaffThisMonth');
    expect(data).toHaveProperty('labReportsThisMonth');
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
    // RECEPTIONIST sees the OPD/payments This-Month/Today counterparts (mirrors
    // todayOpdCount/pendingPaymentsCount above) but not the lab/inventory ones.
    expect(data).toHaveProperty('opdCountThisMonth');
    expect(data).toHaveProperty('pendingPaymentsCountToday');
    expect(data).toHaveProperty('pendingPaymentsCountThisMonth');
    expect(data).not.toHaveProperty('pendingLabCountToday');
    expect(data).not.toHaveProperty('pendingLabCountThisMonth');
    expect(data).not.toHaveProperty('lowStockCountToday');
    expect(data).not.toHaveProperty('lowStockCountThisMonth');
    // RECEPTIONIST sees the "Total Patients Registered"/"New Registrations"
    // This Month counterpart (mirrors newRegistrationsToday) but no
    // IPD/staff/lab This-Month counterparts.
    expect(data).toHaveProperty('newRegistrationsThisMonth');
    expect(data).not.toHaveProperty('activeIpdCountToday');
    expect(data).not.toHaveProperty('totalActiveStaffToday');
    expect(data).not.toHaveProperty('labReportsThisMonth');
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
    // NURSE sees the Active IPD This-Month/Today counterpart (mirrors
    // activeIpdCount above) but no lab/staff/registration This-Month ones.
    expect(data).toHaveProperty('activeIpdCountToday');
    expect(data).toHaveProperty('activeIpdCountThisMonth');
    expect(data).not.toHaveProperty('labReportsThisMonth');
    expect(data).not.toHaveProperty('totalActiveStaffToday');
    expect(data).not.toHaveProperty('newRegistrationsThisMonth');
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
    // DOCTOR sees the OPD/lab This-Month/Today counterparts (mirrors
    // todayOpdCount/pendingLabCount above) but no payments/inventory ones.
    expect(data).toHaveProperty('opdCountThisMonth');
    expect(data).toHaveProperty('pendingLabCountToday');
    expect(data).toHaveProperty('pendingLabCountThisMonth');
    expect(data).not.toHaveProperty('pendingPaymentsCountToday');
    expect(data).not.toHaveProperty('lowStockCountToday');
    // DOCTOR also sees Active IPD/Lab Reports This-Month counterparts but no
    // staff/registration ones (mirrors activeIpdCount/labReportsToday above).
    expect(data).toHaveProperty('activeIpdCountToday');
    expect(data).toHaveProperty('activeIpdCountThisMonth');
    expect(data).toHaveProperty('labReportsThisMonth');
    expect(data).not.toHaveProperty('totalActiveStaffToday');
    expect(data).not.toHaveProperty('newRegistrationsThisMonth');
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
      { visitId: 'v-a-1', tenantId, patientId: 'PAT-A1', doctorIds: [DOCTOR_A], visitDate: today, queueNumber: 1, status: 'OPEN' },
      { visitId: 'v-a-2', tenantId, patientId: 'PAT-A2', doctorIds: [DOCTOR_A], visitDate: today, queueNumber: 2, status: 'OPEN' },
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
      { visitId: 'v-b-1', tenantId, patientId: 'PAT-B1', doctorIds: [DOCTOR_B], visitDate: today, queueNumber: 3, status: 'OPEN' },
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

// ─── Hospital Overview: Today vs This Month scoping ───────────────────────────

describe('GET /api/dashboard/stats — Hospital Overview Today vs This Month counterparts', () => {
  const now = new Date();
  // A date earlier in the current calendar month but not today, used to prove
  // "This Month" totals include days before today while "Today" totals don't.
  // (Falls back to "today" itself on the 1st of the month, when no such date
  // exists — an acceptably rare, non-flaky edge case.)
  const earlierThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 9, 0, 0);

  test('pendingLabCountToday counts only requests created today; pendingLabCountThisMonth also counts earlier-this-month ones', async () => {
    await PathologyRequestModel.create([
      { requestId: 'path-today', tenantId, patientId: 'PAT-1', requestedBy: 'doc-1', testType: 'CBC', status: 'PENDING', priority: 'NORMAL', requestedAt: now, createdAt: now },
      { requestId: 'path-earlier', tenantId, patientId: 'PAT-2', requestedBy: 'doc-1', testType: 'CBC', status: 'PENDING', priority: 'NORMAL', requestedAt: earlierThisMonth, createdAt: earlierThisMonth },
    ]);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.pendingLabCountToday).toBe(1);
    expect(data.pendingLabCountThisMonth).toBe(now.getDate() > 1 ? 2 : 1);
  });

  test('pendingPaymentsCountToday/ThisMonth scope by createdAt the same way', async () => {
    await PaymentModel.create([
      { paymentId: 'pay-today',   tenantId, patientId: 'PAT-1', amount: 100, paymentMethod: PaymentMethod.CASH, description: 'A', status: PaymentStatus.PENDING, createdBy: 'u', createdAt: now },
      { paymentId: 'pay-earlier', tenantId, patientId: 'PAT-2', amount: 200, paymentMethod: PaymentMethod.CASH, description: 'B', status: PaymentStatus.PENDING, createdBy: 'u', createdAt: earlierThisMonth },
    ]);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.pendingPaymentsCountToday).toBe(1);
    expect(data.pendingPaymentsCountThisMonth).toBe(now.getDate() > 1 ? 2 : 1);
  });

  test('opdCountThisMonth includes visits from earlier this month, not just today (unlike todayOpdCount)', async () => {
    await OPDVisitModel.create([
      { visitId: 'v-today',   tenantId, patientId: 'PAT-1', visitDate: now,             queueNumber: 1, status: 'OPEN' },
      { visitId: 'v-earlier', tenantId, patientId: 'PAT-2', visitDate: earlierThisMonth, queueNumber: 2, status: 'OPEN' },
    ]);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.todayOpdCount).toBe(1);
    expect(data.opdCountThisMonth).toBe(now.getDate() > 1 ? 2 : 1);
  });

  test('lowStockCountToday/ThisMonth only counts items still low-stock, scoped by when they were flagged (lowStockSince)', async () => {
    await InventoryItemModel.create([
      // Flagged today, still low — counted in both.
      { itemId: 'item-flagged-today', tenantId, name: 'Gloves', category: 'PPE', unit: 'boxes', quantity: 2, lowStockThreshold: 10, lowStockSince: now },
      // Flagged earlier this month, still low — counted only in This Month.
      { itemId: 'item-flagged-earlier', tenantId, name: 'Masks', category: 'PPE', unit: 'boxes', quantity: 3, lowStockThreshold: 10, lowStockSince: earlierThisMonth },
      // Flagged today but since restocked above threshold — counted in neither.
      { itemId: 'item-restocked', tenantId, name: 'Syringes', category: 'Medical Supplies', unit: 'units', quantity: 50, lowStockThreshold: 10, lowStockSince: null },
    ]);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.lowStockCountToday).toBe(1);
    expect(data.lowStockCountThisMonth).toBe(now.getDate() > 1 ? 2 : 1);
    // The live, date-unscoped total (used by the Inventory Overview widget) still
    // counts both currently-low items regardless of when they were flagged.
    expect(data.lowStockCount).toBe(2);
  });

  test('activeIpdCountToday/ThisMonth only counts admissions still ADMITTED, scoped by admissionDate', async () => {
    await IPDAdmissionModel.create([
      // Admitted today, still admitted — counted in both.
      { admissionId: 'adm-today', tenantId, patientId: 'PAT-1', wardId: 'w1', bedId: 'b1', bedNumber: '1', wardName: 'General', status: 'ADMITTED', admissionDate: now },
      // Admitted earlier this month, still admitted — counted only in This Month.
      { admissionId: 'adm-earlier', tenantId, patientId: 'PAT-2', wardId: 'w1', bedId: 'b2', bedNumber: '2', wardName: 'General', status: 'ADMITTED', admissionDate: earlierThisMonth },
      // Admitted today but already discharged — counted in neither.
      { admissionId: 'adm-discharged', tenantId, patientId: 'PAT-3', wardId: 'w1', bedId: 'b3', bedNumber: '3', wardName: 'General', status: 'DISCHARGED', admissionDate: now },
    ]);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.activeIpdCountToday).toBe(1);
    expect(data.activeIpdCountThisMonth).toBe(now.getDate() > 1 ? 2 : 1);
    // The live, date-unscoped total still counts every currently-admitted patient.
    expect(data.activeIpdCount).toBe(2);
  });

  test("activeIpdCountToday/ThisMonth for a DOCTOR only counts that doctor's own admissions", async () => {
    const DOCTOR_ID = 'doc-ipd-scope';
    await IPDAdmissionModel.create([
      { admissionId: 'adm-mine', tenantId, patientId: 'PAT-1', wardId: 'w1', bedId: 'b1', bedNumber: '1', wardName: 'General', status: 'ADMITTED', admissionDate: now, assignedDoctorIds: [DOCTOR_ID] },
      { admissionId: 'adm-other', tenantId, patientId: 'PAT-2', wardId: 'w1', bedId: 'b2', bedNumber: '2', wardName: 'General', status: 'ADMITTED', admissionDate: now, assignedDoctorIds: ['some-other-doctor'] },
    ]);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.DOCTOR, DOCTOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.activeIpdCountToday).toBe(1);
  });

  test('totalActiveStaffToday/ThisMonth only counts active staff, scoped by account creation date', async () => {
    await UserModel.create([
      { tenantId, email: 'staff-today@dashtest.com',   name: 'Staff Today',   passwordHash: 'x', role: UserRole.NURSE, isActive: true,  isFirstLogin: false, createdAt: now },
      { tenantId, email: 'staff-earlier@dashtest.com', name: 'Staff Earlier', passwordHash: 'x', role: UserRole.NURSE, isActive: true,  isFirstLogin: false, createdAt: earlierThisMonth },
      { tenantId, email: 'staff-inactive@dashtest.com', name: 'Staff Inactive', passwordHash: 'x', role: UserRole.NURSE, isActive: false, isFirstLogin: false, createdAt: now },
    ]);

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    // +1 for the pre-existing admin user created in beforeEach (created "now").
    expect(data.totalActiveStaffToday).toBe(2);
    expect(data.totalActiveStaffThisMonth).toBe(now.getDate() > 1 ? 3 : 2);
  });

  test('newRegistrationsThisMonth and labReportsThisMonth accumulate from the 1st through today', async () => {
    await PatientModel.create([
      {
        patientId: 'pat-today', tenantId, fullName: 'Today Patient', dateOfBirth: new Date('1990-01-01'),
        gender: Gender.MALE, mobileNumber: '9000000001', address: 'Test Address', createdAt: now,
      },
      {
        patientId: 'pat-earlier', tenantId, fullName: 'Earlier Patient', dateOfBirth: new Date('1990-01-01'),
        gender: Gender.FEMALE, mobileNumber: '9000000002', address: 'Test Address', createdAt: earlierThisMonth,
      },
    ]);
    await PathologyRequestModel.create([
      { requestId: 'path-completed-today',   tenantId, patientId: 'PAT-1', requestedBy: 'doc-1', testType: 'CBC', status: 'COMPLETED', priority: 'NORMAL', requestedAt: now },
      { requestId: 'path-completed-earlier', tenantId, patientId: 'PAT-2', requestedBy: 'doc-1', testType: 'CBC', status: 'COMPLETED', priority: 'NORMAL', requestedAt: earlierThisMonth },
    ]);
    // Mongoose's timestamps plugin always refreshes `updatedAt` to "now" on
    // save (unlike `createdAt`, which it leaves alone when already set) — so
    // backdating the second request's `updatedAt` needs the raw driver,
    // bypassing that plugin entirely.
    await PathologyRequestModel.collection.updateOne(
      { requestId: 'path-completed-earlier' },
      { $set: { updatedAt: earlierThisMonth } },
    );

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(UserRole.ADMIN)}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.newRegistrationsToday).toBe(1);
    expect(data.newRegistrationsThisMonth).toBe(now.getDate() > 1 ? 2 : 1);
    expect(data.labReportsToday).toBe(1);
    expect(data.labReportsThisMonth).toBe(now.getDate() > 1 ? 2 : 1);
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
