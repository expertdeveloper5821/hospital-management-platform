import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';

jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: {
    log:       jest.fn().mockResolvedValue(undefined),
    queryLogs: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
  },
}));

import app             from '../../../src/app';
import { UserModel }    from '../../../src/modules/user/user.model';
import { TenantModel }  from '../../../src/modules/tenant/tenant.model';
import { PackageModel } from '../../../src/modules/packages/packages.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:           MongoMemoryServer;
let tenantId:         string;
let adminToken:       string;
let receptionistToken: string;
let nurseToken:       string;

function signToken(userId: string, role: UserRole): string {
  return jwt.sign(
    { userId, tenantId, role, email: 'x@x.com', isFirstLogin: false },
    JWT_SECRET,
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

  const tenant = await TenantModel.create({
    name:       'Packages Test Hospital',
    adminEmail: 'admin@pkgtest.com',
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg-cert-001',
      gstNumber:               'GST001',
      panCard:                 'PAN001',
      addressLine:            '555 Package Avenue',
      city:                    'Mumbai',
      state:                   'Maharashtra',
      pincode:                 '400001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const admin = await UserModel.create({
    tenantId, email: 'admin@pkg.com', name: 'Pkg Admin', passwordHash: 'x',
    role: UserRole.HOSPITAL_ADMIN, isActive: true, isFirstLogin: false,
  });
  adminToken = signToken((admin._id as mongoose.Types.ObjectId).toString(), UserRole.HOSPITAL_ADMIN);

  const receptionist = await UserModel.create({
    tenantId, email: 'reception@pkg.com', name: 'Pkg Receptionist', passwordHash: 'x',
    role: UserRole.RECEPTIONIST, isActive: true, isFirstLogin: false,
  });
  receptionistToken = signToken((receptionist._id as mongoose.Types.ObjectId).toString(), UserRole.RECEPTIONIST);

  const nurse = await UserModel.create({
    tenantId, email: 'nurse@pkg.com', name: 'Pkg Nurse', passwordHash: 'x',
    role: UserRole.NURSE, isActive: true, isFirstLogin: false,
  });
  nurseToken = signToken((nurse._id as mongoose.Types.ObjectId).toString(), UserRole.NURSE);
});

describe('POST /api/packages — description validation', () => {
  const validPayload = {
    name:             'Basic Health Checkup',
    price:            999,
    includedServices: ['CBC', 'Lipid Profile'],
  };

  test('creates a package with no description (optional field left empty)', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.description ?? null).toBeNull();
  });

  test('Idempotency-Key replay: retrying the same offline-queued create does not create a second package or hit the duplicate-name conflict', async () => {
    const idempotencyKey = 'temp-client-op-pkg-001';

    const first = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(validPayload);
    expect(first.status).toBe(201);

    // Without idempotency replay, a second identical create would normally
    // 409 here (createPackage rejects a duplicate name) — a real risk for a
    // retried offline sync attempt of uncertain outcome. The guard must
    // intercept before the handler ever runs, so this replays 201 instead.
    const second = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(validPayload);

    expect(second.status).toBe(201);
    expect(second.body.data.packageId).toBe(first.body.data.packageId);

    const packages = await PackageModel.find({ tenantId, name: validPayload.name });
    expect(packages).toHaveLength(1);
  });

  test('returns 400 for description exceeding maximum length', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, description: 'A'.repeat(501) });

    expect(res.status).toBe(400);
  });

  test('accepts description at exactly maximum length', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, description: 'A'.repeat(500) });

    expect(res.status).toBe(201);
  });

  test('trims leading/trailing whitespace from description', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, description: '  Comprehensive annual checkup  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBe('Comprehensive annual checkup');
  });
});

describe('POST /api/packages — role authorization', () => {
  const validPayload = {
    name:             'Full Body Checkup',
    price:            1499,
    includedServices: ['CBC', 'X-Ray', 'ECG'],
  };

  test('RECEPTIONIST can create a package and select included services', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe(validPayload.name);
    expect(res.body.data.includedServices).toEqual(validPayload.includedServices);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  test('HOSPITAL_ADMIN can still create a package (unchanged)', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
  });

  test('NURSE cannot create a package (unchanged)', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send(validPayload);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request cannot create a package', async () => {
    const res = await request(app)
      .post('/api/packages')
      .send(validPayload);

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/packages/:packageId — role authorization', () => {
  test('RECEPTIONIST can update a package (package-wise ward allocation)', async () => {
    const created = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cardiac Screening', price: 2499, includedServices: ['ECG', 'Echo'] });

    const res = await request(app)
      .patch(`/api/packages/${created.body.data.packageId}`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ price: 2999 });

    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe(2999);
  });

  test('NURSE cannot update a package', async () => {
    const created = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cardiac Screening', price: 2499, includedServices: ['ECG', 'Echo'] });

    const res = await request(app)
      .patch(`/api/packages/${created.body.data.packageId}`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ price: 2999 });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/packages — read access', () => {
  test('RECEPTIONIST lists packages; a ward-less package serialises with null ward fields', async () => {
    await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Maternity', price: 15000, includedServices: ['Delivery'] });

    const list = await request(app)
      .get('/api/packages?status=ACTIVE')
      .set('Authorization', `Bearer ${receptionistToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.data).toHaveLength(1);
    expect(list.body.data.data[0].wardId).toBeNull();
    expect(list.body.data.data[0].wardName).toBeNull();
  });

  test('NURSE still cannot read packages (Nurse does not create admissions in the UI)', async () => {
    const res = await request(app)
      .get('/api/packages')
      .set('Authorization', `Bearer ${nurseToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/packages — search and pagination', () => {
  const get = (qs: string) =>
    request(app).get(`/api/packages${qs}`).set('Authorization', `Bearer ${adminToken}`);

  beforeEach(async () => {
    // 23 "Cardiac" packages (2 INACTIVE) + 2 others + 1 soft-deleted Cardiac.
    const base = Date.UTC(2026, 0, 1);
    const docs = Array.from({ length: 23 }, (_, i) => ({
      packageId: `PKG-C${i}`, tenantId, name: `Cardiac Care ${i}`, price: 1000,
      includedServices: ['ECG'], status: i < 2 ? 'INACTIVE' : 'ACTIVE',
      // Every package shares one createdAt so ordering relies on the tie-breaker.
      createdAt: new Date(base),
    }));
    await PackageModel.create([
      ...docs,
      { packageId: 'PKG-M', tenantId, name: 'Maternity',     price: 1, includedServices: ['x'] },
      { packageId: 'PKG-O', tenantId, name: 'Orthopedic',    price: 1, includedServices: ['x'] },
      { packageId: 'PKG-D', tenantId, name: 'Cardiac Old',   price: 1, includedServices: ['x'], isDeleted: true },
    ]);
  });

  test('search matches name case-insensitively and excludes soft-deleted packages', async () => {
    const res = await get('?search=CARDIAC');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(23);
    expect(res.body.data.totalPages).toBe(2);
    expect(res.body.data.data).toHaveLength(20);
  });

  test('search is treated as a literal substring, not a regex', async () => {
    const res = await get('?search=' + encodeURIComponent('.*'));
    expect(res.body.data.total).toBe(0);
  });

  test('search combines with the status filter', async () => {
    const res = await get('?search=cardiac&status=INACTIVE');
    expect(res.body.data.total).toBe(2);
  });

  test('pages through results with a partial last page and no repeats despite equal createdAt', async () => {
    const p1 = await get('?search=cardiac&page=1');
    const p2 = await get('?search=cardiac&page=2');
    expect(p2.body.data).toMatchObject({ total: 23, page: 2, limit: 20, totalPages: 2 });
    expect(p2.body.data.data).toHaveLength(3);
    const ids = [...p1.body.data.data, ...p2.body.data.data].map((p: { packageId: string }) => p.packageId);
    expect(new Set(ids).size).toBe(23);
  });

  test('a page past the end returns no rows but still the real total', async () => {
    const res = await get('?page=5');
    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
    expect(res.body.data.total).toBe(25);
  });

  test('negative/garbage page and limit fall back to safe defaults; limit stays capped at 20', async () => {
    const neg = await get('?page=-3&limit=-1');
    expect(neg.status).toBe(200);
    expect(neg.body.data).toMatchObject({ page: 1, limit: 1 });

    const junk = await get('?page=abc&limit=500');
    expect(junk.status).toBe(200);
    expect(junk.body.data).toMatchObject({ page: 1, limit: 20, total: 25, totalPages: 2 });
  });
});
