/** @jest-environment node */
import 'fake-indexeddb/auto';
import { openOfflineDb } from './db';
import { getOrCreateClientKey, decryptClientField, isClientEncryptedField } from './crypto';
import {
  cacheQueryResult,
  readCachedQueryResult,
  QUERY_CACHE_POLICIES,
  isSingletonCacheEndpoint,
  cacheSingletonQueryResult,
  readCachedSingletonQueryResult,
  wrapForCacheWrite,
  CACHE_STORE_BY_ENTITY,
  CACHE_STORE_KEY_PREFIX_BY_ENTITY,
} from './query-cache';

const TENANT = () => crypto.randomUUID();
const USER = () => crypto.randomUUID();

describe('cacheQueryResult — write', () => {
  test('writes a single-entity result (getPatientById) with sensitive fields encrypted', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('getPatientById', {
      patientId: 'PAT-1', fullName: 'Jane Doe', mobileNumber: '9998887777',
      aadhaarNumber: '123456789012', dateOfBirth: '1990-01-01',
    }, { tenantId, userId });

    const db = await openOfflineDb(tenantId, userId);
    const record = await db.get('cache_patients', 'PAT-1');

    expect(record).toBeDefined();
    expect(record?.plaintextFields).toEqual({ patientId: 'PAT-1', fullName: 'Jane Doe', mobileNumber: '9998887777' });
    expect(record?.plaintextFields).not.toHaveProperty('aadhaarNumber');
    expect(record?.plaintextFields).not.toHaveProperty('dateOfBirth');
    expect(record?.encryptedFieldsCiphertext).not.toBeNull();
    expect(isClientEncryptedField(record!.encryptedFieldsCiphertext!)).toBe(true);
  });

  test('the encrypted blob actually contains the sensitive fields, decryptable with this tenant/user\'s key', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('getPatientById', {
      patientId: 'PAT-1', fullName: 'Jane Doe', aadhaarNumber: '123456789012',
    }, { tenantId, userId });

    const db = await openOfflineDb(tenantId, userId);
    const record = await db.get('cache_patients', 'PAT-1');
    const key = await getOrCreateClientKey(tenantId, userId);

    const decrypted = JSON.parse(await decryptClientField(record!.encryptedFieldsCiphertext!, key));
    expect(decrypted).toEqual({ aadhaarNumber: '123456789012' });
  });

  test('writes a bare-array result (getOPDQueue), one row per visit', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('getOPDQueue', [
      { visitId: 'OPD-1', status: 'OPEN', diagnosis: null },
      { visitId: 'OPD-2', status: 'COMPLETED', diagnosis: 'flu' },
    ], { tenantId, userId });

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.get('cache_opd_visits', 'OPD-1')).toBeDefined();
    const second = await db.get('cache_opd_visits', 'OPD-2');
    expect(second?.plaintextFields).toEqual({ visitId: 'OPD-2', status: 'COMPLETED' });
  });

  test('writes a paginated/wrapped result (listAdmissions), one row per admission', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listAdmissions', {
      data: [
        { admissionId: 'IPD-1', status: 'ADMITTED', vitals: { weight: 70 } },
        { admissionId: 'IPD-2', status: 'DISCHARGED', vitals: { weight: 65 } },
      ],
      total: 2, page: 1, limit: 20, totalPages: 1,
    }, { tenantId, userId });

    const db = await openOfflineDb(tenantId, userId);
    const record = await db.get('cache_ipd_admissions', 'IPD-1');
    expect(record?.plaintextFields).toEqual({ admissionId: 'IPD-1', status: 'ADMITTED' });
    expect(record?.encryptedFieldsCiphertext).not.toBeNull();
  });

  test('a non-cacheable endpoint is silently ignored (no arbitrary caching)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('getDashboardStats', { totalPatients: 500 }, { tenantId, userId });

    const db = await openOfflineDb(tenantId, userId);
    // No store corresponds to this endpoint — just assert nothing throws and
    // the known clinical stores stay empty.
    expect(await db.getAll('cache_patients')).toEqual([]);
  });

  test('an entity missing its id field is skipped rather than written under a bad key', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('getOPDQueue', [{ status: 'OPEN' }], { tenantId, userId });

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('cache_opd_visits')).toEqual([]);
  });
});

describe('readCachedQueryResult — fallback read', () => {
  test('single-entity fallback returns the requested id, decrypted', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('getPatientById', {
      patientId: 'PAT-1', fullName: 'Jane Doe', aadhaarNumber: '123456789012',
    }, { tenantId, userId });

    const result = await readCachedQueryResult('getPatientById', { url: '/api/patients/PAT-1' }, { tenantId, userId });

    expect(result).toEqual({ patientId: 'PAT-1', fullName: 'Jane Doe', aadhaarNumber: '123456789012' });
  });

  test('single-entity fallback returns null when that specific id was never cached', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('getPatientById', { patientId: 'PAT-1', fullName: 'Jane' }, { tenantId, userId });

    const result = await readCachedQueryResult('getPatientById', { url: '/api/patients/PAT-999' }, { tenantId, userId });
    expect(result).toBeNull();
  });

  test('array-shaped fallback (getOPDQueue) returns every cached visit, decrypted', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('getOPDQueue', [
      { visitId: 'OPD-1', diagnosis: 'flu' },
      { visitId: 'OPD-2', diagnosis: null },
    ], { tenantId, userId });

    const result = await readCachedQueryResult('getOPDQueue', { url: '/api/opd/visits' }, { tenantId, userId });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ visitId: 'OPD-1', diagnosis: 'flu' }),
      expect.objectContaining({ visitId: 'OPD-2', diagnosis: null }),
    ]));
  });

  test('wrapped fallback (searchPatients) reconstructs { data, total, page, limit }', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('searchPatients', {
      data: [{ patientId: 'PAT-1', fullName: 'Jane' }], total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    const result = await readCachedQueryResult('searchPatients', { url: '/api/patients' }, { tenantId, userId }) as {
      data: unknown[]; total: number; page: number; limit: number;
    };

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  test('returns null (not an empty shape) when nothing has ever been cached for this store', async () => {
    const tenantId = TENANT();
    const userId = USER();

    const result = await readCachedQueryResult('searchPatients', { url: '/api/patients' }, { tenantId, userId });
    expect(result).toBeNull();
  });

  test('returns null for an endpoint outside the cacheable allowlist', async () => {
    const tenantId = TENANT();
    const userId = USER();

    const result = await readCachedQueryResult('getDashboardStats', { url: '/api/dashboard' }, { tenantId, userId });
    expect(result).toBeNull();
  });

  test('tenant/user isolation: one tenant\'s cache is invisible to another', async () => {
    const tenantA = { tenantId: TENANT(), userId: USER() };
    const tenantB = { tenantId: TENANT(), userId: USER() };

    await cacheQueryResult('getPatientById', { patientId: 'PAT-1', fullName: 'Tenant A Patient' }, tenantA);

    const seenByB = await readCachedQueryResult('getPatientById', { url: '/api/patients/PAT-1' }, tenantB);
    expect(seenByB).toBeNull();

    const seenByA = await readCachedQueryResult('getPatientById', { url: '/api/patients/PAT-1' }, tenantA);
    expect(seenByA).not.toBeNull();
  });
});

describe('QUERY_CACHE_POLICIES — coverage of the stated safe offline scope', () => {
  test('covers Patients, OPD visits, IPD admissions, Pathology/Radiology requests, the shell lookups, and the remaining dashboard pages\' primary lists', () => {
    expect(Object.keys(QUERY_CACHE_POLICIES).sort()).toEqual([
      'getAdmissionById', 'getOPDQueue', 'getOPDVisitById', 'getPackage', 'getPathologyRequest',
      'getPatientById', 'getRadiologyRequest', 'listAdmissions', 'listAuditLogs', 'listBeds',
      'listCharges', 'listDepartments', 'listEmployeeRoster', 'listInventoryItems', 'listPackages',
      'listPathologyRequests', 'listPayments', 'listRadiologyRequests', 'listUsers', 'listWards',
      'searchPatients',
    ].sort());
  });
});

describe('shell-lookup coverage — wards, beds, departments, users', () => {
  test('listWards / listBeds share cache_wards_beds without colliding (storeKeyPrefix)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listWards', [
      { wardId: 'WARD-1', name: 'General' },
    ], { tenantId, userId });
    await cacheQueryResult('listBeds', [
      { bedId: 'BED-1', wardId: 'WARD-1', bedNumber: '101' },
      { bedId: 'BED-2', wardId: 'WARD-1', bedNumber: '102' },
    ], { tenantId, userId });

    const wards = await readCachedQueryResult('listWards', { url: '/api/ipd/wards' }, { tenantId, userId });
    expect(wards).toEqual([{ wardId: 'WARD-1', name: 'General' }]);

    const beds = await readCachedQueryResult(
      'listBeds', { url: '/api/ipd/wards/WARD-1/beds' }, { tenantId, userId },
    );
    expect(beds).toEqual(expect.arrayContaining([
      { bedId: 'BED-1', wardId: 'WARD-1', bedNumber: '101' },
      { bedId: 'BED-2', wardId: 'WARD-1', bedNumber: '102' },
    ]));
    expect((beds as unknown[]).length).toBe(2);
  });

  test('listBeds is scoped to the ward in the URL — another ward\'s beds never leak in', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listBeds', [
      { bedId: 'BED-1', wardId: 'WARD-1', bedNumber: '101' },
      { bedId: 'BED-2', wardId: 'WARD-2', bedNumber: '201' },
    ], { tenantId, userId });

    const result = await readCachedQueryResult(
      'listBeds', { url: '/api/ipd/wards/WARD-1/beds' }, { tenantId, userId },
    ) as Array<{ bedId: string }>;

    expect(result).toHaveLength(1);
    expect(result[0].bedId).toBe('BED-1');
  });

  test('listDepartments round-trips (own store, no PHI to encrypt)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listDepartments', [
      { departmentId: 'DEPT-1', name: 'Cardiology' },
    ], { tenantId, userId });

    const result = await readCachedQueryResult('listDepartments', { url: '/api/departments' }, { tenantId, userId });
    expect(result).toEqual([{ departmentId: 'DEPT-1', name: 'Cardiology' }]);
  });

  test('listUsers (wrapped) round-trips', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listUsers', {
      data: [{ userId: 'USR-1', name: 'Dr. Rao', role: 'DOCTOR' }], total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    const result = await readCachedQueryResult('listUsers', { url: '/api/users?role=DOCTOR' }, { tenantId, userId }) as {
      data: unknown[]; total: number;
    };
    expect(result.data).toEqual([{ userId: 'USR-1', name: 'Dr. Rao', role: 'DOCTOR' }]);
    expect(result.total).toBe(1);
  });
});

describe('singleton cache — getDashboardStats', () => {
  test('isSingletonCacheEndpoint recognises the singleton endpoints, not the entity-list ones', () => {
    expect(isSingletonCacheEndpoint('getDashboardStats')).toBe(true);
    expect(isSingletonCacheEndpoint('getMyProfile')).toBe(true);
    expect(isSingletonCacheEndpoint('getOccupancySummary')).toBe(true);
    expect(isSingletonCacheEndpoint('getMyAttendance')).toBe(true);
    expect(isSingletonCacheEndpoint('listAttendance')).toBe(true);
    expect(isSingletonCacheEndpoint('getPaymentSummary')).toBe(true);
    expect(isSingletonCacheEndpoint('getDepartmentRevenue')).toBe(true);
    expect(isSingletonCacheEndpoint('searchPatients')).toBe(false);
  });

  test('round-trips the whole stats object, unencrypted', async () => {
    const tenantId = TENANT();
    const userId = USER();
    const stats = { lastUpdated: '2026-09-22T00:00:00.000Z', totalPatients: 500, totalBeds: 40 };

    await cacheSingletonQueryResult('getDashboardStats', stats, { tenantId, userId });
    const result = await readCachedSingletonQueryResult('getDashboardStats', { tenantId, userId });

    expect(result).toEqual(stats);
  });

  test('returns null before anything has been cached', async () => {
    const tenantId = TENANT();
    const userId = USER();

    const result = await readCachedSingletonQueryResult('getDashboardStats', { tenantId, userId });
    expect(result).toBeNull();
  });

  test('ignores a non-singleton endpoint (no accidental write/read)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheSingletonQueryResult('searchPatients', { data: [] }, { tenantId, userId });
    const result = await readCachedSingletonQueryResult('searchPatients', { tenantId, userId });
    expect(result).toBeNull();
  });

  test('tenant/user isolation applies to the singleton store too', async () => {
    const tenantA = { tenantId: TENANT(), userId: USER() };
    const tenantB = { tenantId: TENANT(), userId: USER() };

    await cacheSingletonQueryResult('getDashboardStats', { totalPatients: 10 }, tenantA);

    expect(await readCachedSingletonQueryResult('getDashboardStats', tenantB)).toBeNull();
    expect(await readCachedSingletonQueryResult('getDashboardStats', tenantA)).toEqual({ totalPatients: 10 });
  });
});

describe('keyed singleton cache — getMyAttendance/listAttendance/getPaymentSummary/getDepartmentRevenue', () => {
  test('getMyAttendance caches separately per month/year — switching months offline never shows the wrong one', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheSingletonQueryResult(
      'getMyAttendance',
      { summary: { presentDays: 20 }, records: [] },
      { tenantId, userId },
      '/api/attendance/my-attendance?month=3&year=2026',
    );
    await cacheSingletonQueryResult(
      'getMyAttendance',
      { summary: { presentDays: 5 }, records: [] },
      { tenantId, userId },
      '/api/attendance/my-attendance?month=4&year=2026',
    );

    const march = await readCachedSingletonQueryResult(
      'getMyAttendance', { tenantId, userId }, '/api/attendance/my-attendance?month=3&year=2026',
    );
    const april = await readCachedSingletonQueryResult(
      'getMyAttendance', { tenantId, userId }, '/api/attendance/my-attendance?month=4&year=2026',
    );

    expect(march).toEqual({ summary: { presentDays: 20 }, records: [] });
    expect(april).toEqual({ summary: { presentDays: 5 }, records: [] });
  });

  test('listAttendance caches separately per employee — one employee\'s cache never leaks into another\'s read', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheSingletonQueryResult(
      'listAttendance', { summary: {}, records: [{ userId: 'USR-1' }] }, { tenantId, userId },
      '/api/attendance?userId=USR-1&month=3&year=2026',
    );
    await cacheSingletonQueryResult(
      'listAttendance', { summary: {}, records: [{ userId: 'USR-2' }] }, { tenantId, userId },
      '/api/attendance?userId=USR-2&month=3&year=2026',
    );

    const forUser1 = await readCachedSingletonQueryResult(
      'listAttendance', { tenantId, userId }, '/api/attendance?userId=USR-1&month=3&year=2026',
    ) as { records: Array<{ userId: string }> };

    expect(forUser1.records).toEqual([{ userId: 'USR-1' }]);
  });

  test('getPaymentSummary and getDepartmentRevenue cache separately per date range', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheSingletonQueryResult(
      'getPaymentSummary', { CASH: 100, CHEQUE: 0, UPI: 0, CARD: 0, total: 100 }, { tenantId, userId },
      '/api/payments/summary?dateFrom=2026-01-01T00%3A00%3A00.000Z&dateTo=2026-01-31T23%3A59%3A59.999Z',
    );
    await cacheSingletonQueryResult(
      'getPaymentSummary', { CASH: 0, CHEQUE: 0, UPI: 500, CARD: 0, total: 500 }, { tenantId, userId },
      '/api/payments/summary?dateFrom=2026-02-01T00%3A00%3A00.000Z&dateTo=2026-02-28T23%3A59%3A59.999Z',
    );

    const jan = await readCachedSingletonQueryResult(
      'getPaymentSummary', { tenantId, userId },
      '/api/payments/summary?dateFrom=2026-01-01T00%3A00%3A00.000Z&dateTo=2026-01-31T23%3A59%3A59.999Z',
    );
    expect(jan).toEqual({ CASH: 100, CHEQUE: 0, UPI: 0, CARD: 0, total: 100 });

    await cacheSingletonQueryResult(
      'getDepartmentRevenue', { departments: [], other: { opdRevenue: 0, ipdRevenue: 0, directPayment: 0, total: 0 }, grandTotal: 0 },
      { tenantId, userId }, '/api/payments/summary/by-department?dateFrom=2026-01-01&dateTo=2026-01-31',
    );
    const revenue = await readCachedSingletonQueryResult(
      'getDepartmentRevenue', { tenantId, userId }, '/api/payments/summary/by-department?dateFrom=2026-01-01&dateTo=2026-01-31',
    );
    expect(revenue).toEqual({ departments: [], other: { opdRevenue: 0, ipdRevenue: 0, directPayment: 0, total: 0 }, grandTotal: 0 });
  });

  test('getMyProfile and getOccupancySummary ignore args — one shared cache entry, matching getDashboardStats', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheSingletonQueryResult('getMyProfile', { userId: 'U-1', name: 'Jane' }, { tenantId, userId }, '/api/users/me');
    expect(await readCachedSingletonQueryResult('getMyProfile', { tenantId, userId }, '/api/users/me'))
      .toEqual({ userId: 'U-1', name: 'Jane' });

    await cacheSingletonQueryResult('getOccupancySummary', [{ wardId: 'W-1', total: 10, occupied: 4 }], { tenantId, userId }, '/api/ipd/occupancy');
    expect(await readCachedSingletonQueryResult('getOccupancySummary', { tenantId, userId }, '/api/ipd/occupancy'))
      .toEqual([{ wardId: 'W-1', total: 10, occupied: 4 }]);
  });
});

describe('entity-list policies — Inventory, Packages, Payments, Billing, Audit Logs, Attendance roster', () => {
  test('listInventoryItems (wrapped) round-trips, no encryption', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listInventoryItems', {
      data: [{ itemId: 'ITEM-1', name: 'Gloves', quantity: 50 }], total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    const result = await readCachedQueryResult('listInventoryItems', { url: '/api/inventory' }, { tenantId, userId }) as { data: unknown[] };
    expect(result.data).toEqual([{ itemId: 'ITEM-1', name: 'Gloves', quantity: 50 }]);
  });

  test('listPackages (wrapped) round-trips, no encryption', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listPackages', {
      data: [{ packageId: 'PKG-1', name: 'Basic Checkup' }], total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    const result = await readCachedQueryResult('listPackages', { url: '/api/packages' }, { tenantId, userId }) as { data: unknown[] };
    expect(result.data).toEqual([{ packageId: 'PKG-1', name: 'Basic Checkup' }]);
  });

  test('listPayments (wrapped) encrypts description/transactionId, leaves amount/status/method plaintext', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listPayments', {
      data: [{ paymentId: 'PAY-1', amount: 500, status: 'COMPLETED', description: 'OPD Consultation', transactionId: 'TXN-1' }],
      total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    const db = await openOfflineDb(tenantId, userId);
    const record = await db.get('cache_payments', 'PAY-1');
    expect(record?.plaintextFields).toEqual({ paymentId: 'PAY-1', amount: 500, status: 'COMPLETED' });
    expect(record?.encryptedFieldsCiphertext).not.toBeNull();

    const result = await readCachedQueryResult('listPayments', { url: '/api/payments' }, { tenantId, userId }) as { data: unknown[] };
    expect(result.data).toEqual([
      { paymentId: 'PAY-1', amount: 500, status: 'COMPLETED', description: 'OPD Consultation', transactionId: 'TXN-1' },
    ]);
  });

  test('listCharges (wrapped) encrypts description only', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listCharges', {
      data: [{ chargeId: 'CHG-1', amount: 200, status: 'PENDING', description: 'Consultation fee' }],
      total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    const db = await openOfflineDb(tenantId, userId);
    const record = await db.get('cache_charges', 'CHG-1');
    expect(record?.plaintextFields).toEqual({ chargeId: 'CHG-1', amount: 200, status: 'PENDING' });
    expect(record?.encryptedFieldsCiphertext).not.toBeNull();
  });

  test('listAuditLogs (wrapped) round-trips, no encryption (already redacted server-side)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listAuditLogs', {
      data: [{ auditId: 'AUD-1', entityType: 'Patient', action: 'UPDATE', userId: 'U-1', timestamp: '2026-01-01T00:00:00.000Z' }],
      total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    const result = await readCachedQueryResult('listAuditLogs', { url: '/api/audit' }, { tenantId, userId }) as { data: unknown[] };
    expect(result.data).toEqual([
      { auditId: 'AUD-1', entityType: 'Patient', action: 'UPDATE', userId: 'U-1', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  test('listEmployeeRoster has its own store — never overwrites or is shadowed by listUsers\'s fuller profile', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listUsers', {
      data: [{ userId: 'USR-1', name: 'Dr. Rao', role: 'DOCTOR', departmentIds: ['D-1'] }], total: 1, page: 1, limit: 20,
    }, { tenantId, userId });
    await cacheQueryResult('listEmployeeRoster', [{ userId: 'USR-1', name: 'Dr. Rao', email: 'rao@h.com' }], { tenantId, userId });

    const fullProfile = await readCachedQueryResult('listUsers', { url: '/api/users' }, { tenantId, userId }) as { data: unknown[] };
    expect(fullProfile.data).toEqual([{ userId: 'USR-1', name: 'Dr. Rao', role: 'DOCTOR', departmentIds: ['D-1'] }]);

    const roster = await readCachedQueryResult('listEmployeeRoster', { url: '/api/attendance/employees' }, { tenantId, userId });
    expect(roster).toEqual([{ userId: 'USR-1', name: 'Dr. Rao', email: 'rao@h.com' }]);
  });
});

describe('filterFromUrl — offline filters replicate the live query\'s own filter params', () => {
  test('searchPatients (contains): narrows to matching fullName/mobileNumber/patientId, isolated per search term', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('searchPatients', {
      data: [
        { patientId: 'PAT-1', fullName: 'Jane Doe', mobileNumber: '9998887777' },
        { patientId: 'PAT-2', fullName: 'John Smith', mobileNumber: '8887776666' },
      ], total: 2, page: 1, limit: 20,
    }, { tenantId, userId });

    const byName = await readCachedQueryResult('searchPatients', { url: '/api/patients?q=jane' }, { tenantId, userId }) as { data: unknown[] };
    expect(byName.data).toEqual([{ patientId: 'PAT-1', fullName: 'Jane Doe', mobileNumber: '9998887777' }]);

    const byMobile = await readCachedQueryResult('searchPatients', { url: '/api/patients?q=888777' }, { tenantId, userId }) as { data: unknown[] };
    expect(byMobile.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ patientId: 'PAT-1' }), expect.objectContaining({ patientId: 'PAT-2' }),
    ]));

    const noMatch = await readCachedQueryResult('searchPatients', { url: '/api/patients?q=nobody' }, { tenantId, userId }) as { data: unknown[] };
    expect(noMatch.data).toEqual([]);

    const unfiltered = await readCachedQueryResult('searchPatients', { url: '/api/patients' }, { tenantId, userId }) as { data: unknown[] };
    expect(unfiltered.data).toHaveLength(2);
  });

  test('getOPDQueue (sameDay + arrayIncludes + contains): date/doctor/search all narrow correctly and compose', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('getOPDQueue', [
      { visitId: 'OPD-1', fullName: 'Jane', patientId: 'PAT-1', doctorIds: ['DOC-1'], visitDate: '2026-03-10T09:00:00.000Z' },
      { visitId: 'OPD-2', fullName: 'John', patientId: 'PAT-2', doctorIds: ['DOC-2'], visitDate: '2026-03-11T09:00:00.000Z' },
      { visitId: 'OPD-3', fullName: 'Jane', patientId: 'PAT-3', doctorIds: ['DOC-2'], visitDate: '2026-03-10T09:00:00.000Z' },
    ], { tenantId, userId });

    const byDate = await readCachedQueryResult('getOPDQueue', { url: '/api/opd/visits?date=2026-03-10' }, { tenantId, userId }) as unknown[];
    expect(byDate).toHaveLength(2);
    expect(byDate.map((v) => (v as { visitId: string }).visitId).sort()).toEqual(['OPD-1', 'OPD-3']);

    const byDoctor = await readCachedQueryResult(
      'getOPDQueue', { url: '/api/opd/visits?date=2026-03-10&doctorId=DOC-2' }, { tenantId, userId },
    ) as unknown[];
    expect(byDoctor).toEqual([expect.objectContaining({ visitId: 'OPD-3' })]);

    const bySearch = await readCachedQueryResult(
      'getOPDQueue', { url: '/api/opd/visits?date=2026-03-11&search=john' }, { tenantId, userId },
    ) as unknown[];
    expect(bySearch).toEqual([expect.objectContaining({ visitId: 'OPD-2' })]);

    const wrongDay = await readCachedQueryResult('getOPDQueue', { url: '/api/opd/visits?date=2026-03-12' }, { tenantId, userId }) as unknown[];
    expect(wrongDay).toEqual([]);
  });

  test('getOPDQueue date filter buckets by IST calendar day, not the raw UTC date string (mirrors opd.repository.ts\'s findByDate)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    // 20:00 UTC on the 9th = 01:30 IST on the 10th — an OPD visit created
    // just after midnight, hospital-local time.
    await cacheQueryResult('getOPDQueue', [
      { visitId: 'OPD-1', visitDate: '2026-03-09T20:00:00.000Z' },
    ], { tenantId, userId });

    const istToday = await readCachedQueryResult('getOPDQueue', { url: '/api/opd/visits?date=2026-03-10' }, { tenantId, userId }) as unknown[];
    expect(istToday).toEqual([expect.objectContaining({ visitId: 'OPD-1' })]);

    const utcDateString = await readCachedQueryResult('getOPDQueue', { url: '/api/opd/visits?date=2026-03-09' }, { tenantId, userId }) as unknown[];
    expect(utcDateString).toEqual([]);
  });

  test('listAdmissions (exact status/wardId + contains search): each filter narrows independently and composes', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listAdmissions', {
      data: [
        { admissionId: 'IPD-1', fullName: 'Jane', patientId: 'PAT-1', status: 'ADMITTED',   wardId: 'W-1' },
        { admissionId: 'IPD-2', fullName: 'John', patientId: 'PAT-2', status: 'DISCHARGED', wardId: 'W-1' },
        { admissionId: 'IPD-3', fullName: 'Jane', patientId: 'PAT-3', status: 'ADMITTED',   wardId: 'W-2' },
      ], total: 3, page: 1, limit: 20,
    }, { tenantId, userId });

    const admitted = await readCachedQueryResult(
      'listAdmissions', { url: '/api/ipd/admissions?status=ADMITTED' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(admitted.data.map((a) => (a as { admissionId: string }).admissionId).sort()).toEqual(['IPD-1', 'IPD-3']);

    const ward1Admitted = await readCachedQueryResult(
      'listAdmissions', { url: '/api/ipd/admissions?status=ADMITTED&wardId=W-1' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(ward1Admitted.data).toEqual([expect.objectContaining({ admissionId: 'IPD-1' })]);

    const discharged = await readCachedQueryResult(
      'listAdmissions', { url: '/api/ipd/admissions?status=DISCHARGED' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(discharged.data).toEqual([expect.objectContaining({ admissionId: 'IPD-2' })]);
  });

  test('Pathology and Radiology requests no longer leak into each other\'s cache (storeKeyPrefix isolation)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listPathologyRequests', {
      data: [{ requestId: 'REQ-1', fullName: 'Jane', patientId: 'PAT-1', status: 'PENDING', testType: 'CBC' }],
      total: 1, page: 1, limit: 20,
    }, { tenantId, userId });
    await cacheQueryResult('listRadiologyRequests', {
      data: [{ requestId: 'REQ-2', fullName: 'John', patientId: 'PAT-2', status: 'PENDING', imagingType: 'X-RAY' }],
      total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    const pathology = await readCachedQueryResult('listPathologyRequests', { url: '/api/lab/pathology' }, { tenantId, userId }) as { data: unknown[] };
    expect(pathology.data).toEqual([expect.objectContaining({ requestId: 'REQ-1', testType: 'CBC' })]);

    const radiology = await readCachedQueryResult('listRadiologyRequests', { url: '/api/lab/radiology' }, { tenantId, userId }) as { data: unknown[] };
    expect(radiology.data).toEqual([expect.objectContaining({ requestId: 'REQ-2', imagingType: 'X-RAY' })]);

    // Single-record ('single' shape) reads are isolated too.
    const singlePathology = await readCachedQueryResult('getPathologyRequest', { url: '/api/lab/pathology/REQ-1' }, { tenantId, userId });
    expect(singlePathology).toMatchObject({ requestId: 'REQ-1', testType: 'CBC' });
    const singleRadiologyLookingForPathologyId = await readCachedQueryResult('getRadiologyRequest', { url: '/api/lab/radiology/REQ-1' }, { tenantId, userId });
    expect(singleRadiologyLookingForPathologyId).toBeNull();
  });

  test('listPathologyRequests: search matches patient fullName/patientId only (mirrors lab.service.ts — not testType), status filters correctly', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listPathologyRequests', {
      data: [
        { requestId: 'REQ-1', fullName: 'Jane', patientId: 'PAT-1', status: 'PENDING', testType: 'CBC' },
        { requestId: 'REQ-2', fullName: 'John', patientId: 'PAT-2', status: 'COMPLETED', testType: 'Lipid Profile' },
      ], total: 2, page: 1, limit: 20,
    }, { tenantId, userId });

    const byPatientName = await readCachedQueryResult(
      'listPathologyRequests', { url: '/api/lab/pathology?search=john' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(byPatientName.data).toEqual([expect.objectContaining({ requestId: 'REQ-2' })]);

    // The backend's `search` param never matches testType — searching "lipid"
    // (a test type, not a patient name/id) must match nothing, not fall back
    // to a broader match than the live query would ever return.
    const byTestTypeText = await readCachedQueryResult(
      'listPathologyRequests', { url: '/api/lab/pathology?search=lipid' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(byTestTypeText.data).toEqual([]);

    const byStatus = await readCachedQueryResult(
      'listPathologyRequests', { url: '/api/lab/pathology?status=PENDING' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(byStatus.data).toEqual([expect.objectContaining({ requestId: 'REQ-1' })]);
  });

  test('listUsers (exact role + activeStatus, both isActive= and status= forms + contains search)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listUsers', {
      data: [
        { userId: 'U-1', name: 'Dr. Rao', email: 'rao@h.com', role: 'DOCTOR', isActive: true },
        { userId: 'U-2', name: 'Nurse Mina', email: 'mina@h.com', role: 'NURSE', isActive: true },
        { userId: 'U-3', name: 'Dr. Old', email: 'old@h.com', role: 'DOCTOR', isActive: false },
      ], total: 3, page: 1, limit: 20,
    }, { tenantId, userId });

    // Doctor-dropdown style query (isActive= boolean form).
    const activeDoctors = await readCachedQueryResult(
      'listUsers', { url: '/api/users?role=DOCTOR&isActive=true' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(activeDoctors.data).toEqual([expect.objectContaining({ userId: 'U-1' })]);

    // Users-page style query (status= string form).
    const inactive = await readCachedQueryResult(
      'listUsers', { url: '/api/users?status=INACTIVE' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(inactive.data).toEqual([expect.objectContaining({ userId: 'U-3' })]);

    const bySearch = await readCachedQueryResult(
      'listUsers', { url: '/api/users?search=mina' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(bySearch.data).toEqual([expect.objectContaining({ userId: 'U-2' })]);
  });

  test('listPayments: exact status/method/reference filters and an inclusive dateFrom/dateTo range', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listPayments', {
      data: [
        { paymentId: 'PAY-1', amount: 100, status: 'COMPLETED', paymentMethod: 'CASH', createdAt: '2026-01-15T10:00:00.000Z' },
        { paymentId: 'PAY-2', amount: 200, status: 'PENDING',   paymentMethod: 'UPI',  createdAt: '2026-01-20T23:30:00.000Z' },
        { paymentId: 'PAY-3', amount: 300, status: 'COMPLETED', paymentMethod: 'UPI',  createdAt: '2026-02-01T08:00:00.000Z' },
      ], total: 3, page: 1, limit: 20,
    }, { tenantId, userId });

    const completed = await readCachedQueryResult(
      'listPayments', { url: '/api/payments?status=COMPLETED' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(completed.data.map((p) => (p as { paymentId: string }).paymentId).sort()).toEqual(['PAY-1', 'PAY-3']);

    const upi = await readCachedQueryResult(
      'listPayments', { url: '/api/payments?paymentMethod=UPI' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(upi.data.map((p) => (p as { paymentId: string }).paymentId).sort()).toEqual(['PAY-2', 'PAY-3']);

    // January range — PAY-2's createdAt (23:30 on the 20th) must still be
    // included: a bare `dateTo` is inclusive of the whole day, not just its
    // first instant.
    const january = await readCachedQueryResult(
      'listPayments',
      { url: '/api/payments?dateFrom=2026-01-01T00%3A00%3A00.000Z&dateTo=2026-01-31T23%3A59%3A59.999Z' },
      { tenantId, userId },
    ) as { data: unknown[] };
    expect(january.data.map((p) => (p as { paymentId: string }).paymentId).sort()).toEqual(['PAY-1', 'PAY-2']);
  });

  test('listCharges: patientId/category/addedByName filters and a bare-date startDate/endDate range (matches charges.repository.ts\'s plain new Date() parsing)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listCharges', {
      data: [
        { chargeId: 'CHG-1', patientId: 'PAT-1', category: 'CONSULTATION', addedByName: 'Reception A', createdAt: '2026-01-09T12:00:00.000Z' },
        // Same calendar day as endDate below, but after its UTC midnight —
        // charges.repository.ts's `$lte: new Date('2026-01-10')` (midnight,
        // not end of day) excludes this online too; this test locks in that
        // the offline filter reproduces that exact behavior rather than a
        // "friendlier" whole-day interpretation that would disagree with it.
        { chargeId: 'CHG-2', patientId: 'PAT-2', category: 'LAB_TEST',     addedByName: 'Reception B', createdAt: '2026-01-10T08:00:00.000Z' },
      ], total: 2, page: 1, limit: 20,
    }, { tenantId, userId });

    const byCategory = await readCachedQueryResult(
      'listCharges', { url: '/api/charges?category=LAB_TEST' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(byCategory.data).toEqual([expect.objectContaining({ chargeId: 'CHG-2' })]);

    const byDateRange = await readCachedQueryResult(
      'listCharges', { url: '/api/charges?startDate=2026-01-09&endDate=2026-01-10' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(byDateRange.data).toEqual([expect.objectContaining({ chargeId: 'CHG-1' })]);

    const byAddedByName = await readCachedQueryResult(
      'listCharges', { url: '/api/charges?addedByName=reception+a' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(byAddedByName.data).toEqual([expect.objectContaining({ chargeId: 'CHG-1' })]);
  });

  test('listInventoryItems: case-insensitive partial category match (mirrors inventory.repository.ts\'s $regex) and lowStock=true, lowStock unset shows everything', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listInventoryItems', {
      data: [
        { itemId: 'ITEM-1', name: 'Gloves', category: 'Consumables', isLowStock: true },
        { itemId: 'ITEM-2', name: 'Syringes', category: 'Consumables', isLowStock: false },
        { itemId: 'ITEM-3', name: 'Stretcher', category: 'Equipment', isLowStock: false },
      ], total: 3, page: 1, limit: 20,
    }, { tenantId, userId });

    const lowStockOnly = await readCachedQueryResult(
      'listInventoryItems', { url: '/api/inventory?lowStock=true' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(lowStockOnly.data).toEqual([expect.objectContaining({ itemId: 'ITEM-1' })]);

    // Partial, case-insensitive — "consum" must match "Consumables", the
    // same as typing a partial category server-side would.
    const consumables = await readCachedQueryResult(
      'listInventoryItems', { url: '/api/inventory?category=consum' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(consumables.data.map((i) => (i as { itemId: string }).itemId).sort()).toEqual(['ITEM-1', 'ITEM-2']);

    const all = await readCachedQueryResult('listInventoryItems', { url: '/api/inventory' }, { tenantId, userId }) as { data: unknown[] };
    expect(all.data).toHaveLength(3);
  });

  test('listPackages: exact status narrows correctly', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listPackages', {
      data: [
        { packageId: 'PKG-1', name: 'Basic', status: 'ACTIVE' },
        { packageId: 'PKG-2', name: 'Old', status: 'INACTIVE' },
      ], total: 2, page: 1, limit: 20,
    }, { tenantId, userId });

    const active = await readCachedQueryResult(
      'listPackages', { url: '/api/packages?status=ACTIVE' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(active.data).toEqual([expect.objectContaining({ packageId: 'PKG-1' })]);
  });

  test('listAuditLogs: exact entityType/userId and a bare-date dateFrom/dateTo range (matches audit.repository.ts\'s plain new Date() parsing)', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listAuditLogs', {
      data: [
        { auditId: 'AUD-1', entityType: 'Patient', userId: 'U-1', timestamp: '2026-01-04T20:00:00.000Z' },
        // Same calendar day as dateTo below, but after its UTC midnight —
        // audit.repository.ts's `$lte: new Date('2026-01-05')` (midnight,
        // not end of day) excludes this online too; the offline filter must
        // reproduce that exact boundary rather than a "friendlier" one.
        { auditId: 'AUD-2', entityType: 'Payment', userId: 'U-1', timestamp: '2026-01-05T20:00:00.000Z' },
        { auditId: 'AUD-3', entityType: 'Patient', userId: 'U-2', timestamp: '2026-01-06T10:00:00.000Z' },
      ], total: 3, page: 1, limit: 20,
    }, { tenantId, userId });

    const byEntityType = await readCachedQueryResult(
      'listAuditLogs', { url: '/api/audit?entityType=Patient' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(byEntityType.data.map((a) => (a as { auditId: string }).auditId).sort()).toEqual(['AUD-1', 'AUD-3']);

    const byDate = await readCachedQueryResult(
      'listAuditLogs', { url: '/api/audit?dateFrom=2026-01-04&dateTo=2026-01-05' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(byDate.data).toEqual([expect.objectContaining({ auditId: 'AUD-1' })]);

    const byUser = await readCachedQueryResult(
      'listAuditLogs', { url: '/api/audit?userId=U-2' }, { tenantId, userId },
    ) as { data: unknown[] };
    expect(byUser.data).toEqual([expect.objectContaining({ auditId: 'AUD-3' })]);
  });

  test('a filter matching nothing returns an empty (not null) result — "no records match", not an error', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listPackages', {
      data: [{ packageId: 'PKG-1', name: 'Basic', status: 'ACTIVE' }], total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    const result = await readCachedQueryResult(
      'listPackages', { url: '/api/packages?status=INACTIVE' }, { tenantId, userId },
    ) as { data: unknown[]; total: number };
    expect(result).not.toBeNull();
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('wrapForCacheWrite — shapes a bare optimistic entity for an offline CREATE\'s cache write', () => {
  test('single-shape policy (getPatientById): returned as-is, no wrapping', () => {
    const entity = { patientId: 'temp-1', fullName: 'Jane' };
    expect(wrapForCacheWrite('getPatientById', entity)).toBe(entity);
  });

  test('array-shape policy (listWards): wrapped in a single-element array', () => {
    const entity = { wardId: 'temp-w1', name: 'General' };
    expect(wrapForCacheWrite('listWards', entity)).toEqual([entity]);
  });

  test('wrapped-shape policy (listPayments/listInventoryItems/listPackages/listCharges): { data: [entity], total: 1, ... }', () => {
    const entity = { paymentId: 'temp-pay1', amount: 500 };
    expect(wrapForCacheWrite('listPayments', entity)).toEqual({
      data: [entity], total: 1, page: 1, limit: 1, totalPages: 1,
    });
  });

  test('an unknown endpoint name is returned as-is (defensive fallback, never throws)', () => {
    const entity = { id: 'x' };
    expect(wrapForCacheWrite('notARealPolicy', entity)).toBe(entity);
  });
});

describe('offline CREATE support — Inventory/Wards/Packages/Charges/Payments appear at the top of their list immediately', () => {
  test('listWards: a pendingSync CREATE sorts before real rows, most-recent first among pending rows', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listWards', [
      { wardId: 'WARD-REAL', name: 'Old Ward', createdAt: '2026-01-01T00:00:00.000Z' },
    ], { tenantId, userId });

    // Simulate base.api.ts's write path: wrapForCacheWrite + pendingSync: true.
    await cacheQueryResult(
      'listWards', wrapForCacheWrite('listWards', { wardId: 'temp-w1', name: 'New Ward', createdAt: '2026-03-01T00:00:00.000Z' }),
      { tenantId, userId }, { pendingSync: true },
    );

    const result = await readCachedQueryResult('listWards', { url: '/api/ipd/wards' }, { tenantId, userId }) as Array<{ wardId: string }>;
    expect(result[0].wardId).toBe('temp-w1');
  });

  test('listInventoryItems: a pendingSync CREATE sorts to the top of the wrapped list', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listInventoryItems', {
      data: [{ itemId: 'ITEM-REAL', name: 'Old Item', createdAt: '2026-01-01T00:00:00.000Z' }],
      total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    await cacheQueryResult(
      'listInventoryItems',
      wrapForCacheWrite('listInventoryItems', { itemId: 'temp-i1', name: 'New Item', createdAt: '2026-03-01T00:00:00.000Z' }),
      { tenantId, userId }, { pendingSync: true },
    );

    const result = await readCachedQueryResult('listInventoryItems', { url: '/api/inventory' }, { tenantId, userId }) as { data: Array<{ itemId: string }> };
    expect(result.data[0].itemId).toBe('temp-i1');
  });

  test('listPackages: a pendingSync CREATE sorts to the top', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listPackages', {
      data: [{ packageId: 'PKG-REAL', name: 'Old Package', createdAt: '2026-01-01T00:00:00.000Z' }],
      total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    await cacheQueryResult(
      'listPackages', wrapForCacheWrite('listPackages', { packageId: 'temp-p1', name: 'New Package', createdAt: '2026-03-01T00:00:00.000Z' }),
      { tenantId, userId }, { pendingSync: true },
    );

    const result = await readCachedQueryResult('listPackages', { url: '/api/packages' }, { tenantId, userId }) as { data: Array<{ packageId: string }> };
    expect(result.data[0].packageId).toBe('temp-p1');
  });

  test('listCharges: a pendingSync CREATE sorts to the top, sensitive description still encrypted', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listCharges', {
      data: [{ chargeId: 'CHG-REAL', patientId: 'PAT-1', description: 'Old charge', createdAt: '2026-01-01T00:00:00.000Z' }],
      total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    await cacheQueryResult(
      'listCharges',
      wrapForCacheWrite('listCharges', { chargeId: 'temp-c1', patientId: 'PAT-2', description: 'New charge', createdAt: '2026-03-01T00:00:00.000Z' }),
      { tenantId, userId }, { pendingSync: true },
    );

    const db = await openOfflineDb(tenantId, userId);
    const record = await db.get('cache_charges', 'temp-c1');
    expect(record?.encryptedFieldsCiphertext).not.toBeNull();
    expect(record?.plaintextFields).not.toHaveProperty('description');

    const result = await readCachedQueryResult('listCharges', { url: '/api/charges' }, { tenantId, userId }) as { data: Array<{ chargeId: string }> };
    expect(result.data[0].chargeId).toBe('temp-c1');
  });

  test('listPayments: a standalone Manual Payment CREATE (MANUAL_PAYMENT entity) sorts to the top of the payments list', async () => {
    const tenantId = TENANT();
    const userId = USER();

    await cacheQueryResult('listPayments', {
      data: [{ paymentId: 'PAY-REAL', amount: 100, createdAt: '2026-01-01T00:00:00.000Z' }],
      total: 1, page: 1, limit: 20,
    }, { tenantId, userId });

    await cacheQueryResult(
      'listPayments',
      wrapForCacheWrite('listPayments', { paymentId: 'temp-pay1', amount: 750, status: 'COMPLETED', createdAt: '2026-03-01T00:00:00.000Z' }),
      { tenantId, userId }, { pendingSync: true },
    );

    const result = await readCachedQueryResult('listPayments', { url: '/api/payments' }, { tenantId, userId }) as { data: Array<{ paymentId: string; amount: number }> };
    expect(result.data[0]).toMatchObject({ paymentId: 'temp-pay1', amount: 750 });
  });
});

describe('CACHE_STORE_BY_ENTITY / CACHE_STORE_KEY_PREFIX_BY_ENTITY — new offline-CREATE entity types', () => {
  test('every new offline-CREATE entity type has a cache store; only WARD needs a key prefix', () => {
    expect(CACHE_STORE_BY_ENTITY.MANUAL_PAYMENT).toBe('cache_payments');
    expect(CACHE_STORE_BY_ENTITY.INVENTORY_ITEM).toBe('cache_inventory');
    expect(CACHE_STORE_BY_ENTITY.WARD).toBe('cache_wards_beds');
    expect(CACHE_STORE_BY_ENTITY.PACKAGE).toBe('cache_packages');
    expect(CACHE_STORE_BY_ENTITY.CHARGE).toBe('cache_charges');

    expect(CACHE_STORE_KEY_PREFIX_BY_ENTITY.WARD).toBe('ward:');
    expect(CACHE_STORE_KEY_PREFIX_BY_ENTITY.INVENTORY_ITEM).toBeUndefined();
    expect(CACHE_STORE_KEY_PREFIX_BY_ENTITY.PACKAGE).toBeUndefined();
    expect(CACHE_STORE_KEY_PREFIX_BY_ENTITY.CHARGE).toBeUndefined();
    expect(CACHE_STORE_KEY_PREFIX_BY_ENTITY.MANUAL_PAYMENT).toBeUndefined();
  });
});
