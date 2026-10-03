/**
 * Integration tests — Package-wise Ward allocation (package ↔ ward linking).
 *
 * Uses a single-node replica set: creating a package with an inline new ward
 * runs in a transaction (PackageRepository.saveWithNewWard), which MongoDB
 * only supports against a replica set.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';

jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: {
    log:       jest.fn().mockResolvedValue(undefined),
    queryLogs: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
  },
}));

import app              from '../../../src/app';
import { UserModel }    from '../../../src/modules/user/user.model';
import { TenantModel }  from '../../../src/modules/tenant/tenant.model';
import { PackageModel } from '../../../src/modules/packages/packages.model';
import { WardModel }    from '../../../src/modules/ipd/ward.model';
import { auditService } from '../../../src/shared/services/audit.service';
import { TenantStatus, UserRole, AuditEntityType } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod: MongoMemoryReplSet;
let tenantId:      string;
let otherTenantId: string;
let tokens: Record<'HOSPITAL_ADMIN' | 'ADMIN' | 'RECEPTIONIST' | 'NURSE', string>;

function signToken(userId: string, role: UserRole, tid = tenantId): string {
  return jwt.sign({ userId, tenantId: tid, role, email: 'x@x.com', isFirstLogin: false }, JWT_SECRET);
}

async function seedTenant(name: string) {
  const t = await TenantModel.create({
    name,
    adminEmail: `${name.replace(/\s/g, '').toLowerCase()}@test.com`,
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg', gstNumber: 'GST', panCard: 'PAN',
      addressLine: '1 Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001',
    },
  });
  return (t._id as mongoose.Types.ObjectId).toString();
}

const basePayload = { name: 'Maternity Package', price: 25000, includedServices: ['Delivery', 'Stay'] };

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  // Collections (and the ward's unique index) must exist before any
  // transaction writes to them.
  await Promise.all([WardModel.init(), PackageModel.init()]);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
  (auditService.log as jest.Mock).mockClear();

  tenantId      = await seedTenant('Ward Pkg Hospital');
  otherTenantId = await seedTenant('Other Hospital');

  const roles = ['HOSPITAL_ADMIN', 'ADMIN', 'RECEPTIONIST', 'NURSE'] as const;
  const entries = await Promise.all(roles.map(async (role) => {
    const u = await UserModel.create({
      tenantId, email: `${role.toLowerCase()}@wardpkg.com`, name: role, passwordHash: 'x',
      role: UserRole[role], isActive: true, isFirstLogin: false,
    });
    return [role, signToken((u._id as mongoose.Types.ObjectId).toString(), UserRole[role])] as const;
  }));
  tokens = Object.fromEntries(entries) as typeof tokens;
});

async function seedWard(name = 'Maternity Ward', tid = tenantId) {
  const w = await WardModel.create({ tenantId: tid, name });
  return (w._id as mongoose.Types.ObjectId).toString();
}

describe('POST /api/packages — link an existing ward', () => {
  test.each(['HOSPITAL_ADMIN', 'RECEPTIONIST'] as const)('%s can link an existing ward', async (role) => {
    const wardId = await seedWard();
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens[role]}`)
      .send({ ...basePayload, wardId });

    expect(res.status).toBe(201);
    expect(res.body.data.wardId).toBe(wardId);
    expect(res.body.data.wardName).toBe('Maternity Ward');
    const stored = await PackageModel.findOne({ packageId: res.body.data.packageId }).lean();
    expect(stored?.wardId).toBe(wardId);
  });

  test('a package without a ward is still created (ward is optional)', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send(basePayload);
    expect(res.status).toBe(201);
    expect(res.body.data.wardId).toBeNull();
    expect(res.body.data.wardName).toBeNull();
  });

  test("another tenant's ward is rejected with 404 and no package is created", async () => {
    const foreignWardId = await seedWard('Foreign Ward', otherTenantId);
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, wardId: foreignWardId });
    expect(res.status).toBe(404);
    expect(await PackageModel.countDocuments({ tenantId })).toBe(0);
  });

  test('an invalid ward id is rejected with 404', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, wardId: 'not-an-id' });
    expect(res.status).toBe(404);
  });

  test('sending both wardId and newWard is a 400', async () => {
    const wardId = await seedWard();
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, wardId, newWard: { name: 'Another' } });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/packages — create a new ward inline', () => {
  test('HOSPITAL_ADMIN creates the ward and the package, linked, in one call', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, newWard: { name: 'Package Ward', floor: '3' } });

    expect(res.status).toBe(201);
    const ward = await WardModel.findOne({ tenantId, name: 'Package Ward' }).lean();
    expect(ward).not.toBeNull();
    expect(ward?.floor).toBe('3');
    expect(res.body.data.wardId).toBe(String(ward!._id));
    expect(res.body.data.wardName).toBe('Package Ward');

    // Both the ward and the package creation are audited.
    const calls = (auditService.log as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: String(ward!._id), action: 'CREATE' }),
      expect.objectContaining({
        entityType: AuditEntityType.PACKAGE,
        action:     'CREATE',
        newValue:   expect.objectContaining({ wardId: String(ward!._id) }),
      }),
    ]));
  });

  test.each(['ADMIN', 'RECEPTIONIST'] as const)('%s cannot create a ward inline (403, nothing written)', async (role) => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens[role]}`)
      .send({ ...basePayload, newWard: { name: 'Sneaky Ward' } });
    expect(res.status).toBe(403);
    expect(await WardModel.countDocuments({ tenantId })).toBe(0);
    expect(await PackageModel.countDocuments({ tenantId })).toBe(0);
  });

  test('a duplicate ward name (case-insensitive) is a 409 and no package is created', async () => {
    await seedWard('Maternity Ward');
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, newWard: { name: 'maternity ward' } });
    expect(res.status).toBe(409);
    expect(await WardModel.countDocuments({ tenantId })).toBe(1);
    expect(await PackageModel.countDocuments({ tenantId })).toBe(0);
  });

  test('the same ward name in another tenant does not conflict', async () => {
    await seedWard('Package Ward', otherTenantId);
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, newWard: { name: 'Package Ward' } });
    expect(res.status).toBe(201);
  });

  test('a duplicate package name is a 409 and the new ward is NOT created', async () => {
    await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send(basePayload);
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, newWard: { name: 'Orphan Ward' } });
    expect(res.status).toBe(409);
    expect(await WardModel.countDocuments({ tenantId, name: 'Orphan Ward' })).toBe(0);
  });

  test('the transaction rolls back the ward when the package insert fails', async () => {
    const spy = jest.spyOn(PackageModel, 'create').mockRejectedValueOnce(new Error('boom') as never);
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, newWard: { name: 'Rollback Ward' } });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await WardModel.countDocuments({ tenantId, name: 'Rollback Ward' })).toBe(0);
  });

  test('a blank new ward name is a 400', async () => {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, newWard: { name: '   ' } });
    expect(res.status).toBe(400);
  });

  test('NURSE cannot create a package even with a ward', async () => {
    const wardId = await seedWard();
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.NURSE}`)
      .send({ ...basePayload, wardId });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/packages/:packageId — edit the linked ward', () => {
  async function createPkg(wardId?: string) {
    const res = await request(app)
      .post('/api/packages')
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ ...basePayload, ...(wardId ? { wardId } : {}) });
    return res.body.data.packageId as string;
  }

  test('RECEPTIONIST can link a ward to a legacy (ward-less) package', async () => {
    const packageId = await createPkg();
    const wardId    = await seedWard();
    const res = await request(app)
      .patch(`/api/packages/${packageId}`)
      .set('Authorization', `Bearer ${tokens.RECEPTIONIST}`)
      .send({ wardId });
    expect(res.status).toBe(200);
    expect(res.body.data.wardId).toBe(wardId);
    expect(res.body.data.wardName).toBe('Maternity Ward');
  });

  test('HOSPITAL_ADMIN can unlink the ward with null', async () => {
    const wardId    = await seedWard();
    const packageId = await createPkg(wardId);
    const res = await request(app)
      .patch(`/api/packages/${packageId}`)
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ wardId: null });
    expect(res.status).toBe(200);
    expect(res.body.data.wardId).toBeNull();
  });

  test("relinking to another tenant's ward is a 404 and the link is unchanged", async () => {
    const wardId        = await seedWard();
    const packageId     = await createPkg(wardId);
    const foreignWardId = await seedWard('Foreign', otherTenantId);
    const res = await request(app)
      .patch(`/api/packages/${packageId}`)
      .set('Authorization', `Bearer ${tokens.HOSPITAL_ADMIN}`)
      .send({ wardId: foreignWardId });
    expect(res.status).toBe(404);
    const stored = await PackageModel.findOne({ packageId }).lean();
    expect(stored?.wardId).toBe(wardId);
  });

  test('NURSE cannot edit the linked ward', async () => {
    const packageId = await createPkg();
    const wardId    = await seedWard();
    const res = await request(app)
      .patch(`/api/packages/${packageId}`)
      .set('Authorization', `Bearer ${tokens.NURSE}`)
      .send({ wardId });
    expect(res.status).toBe(403);
  });

  test("a package is invisible to another tenant's user", async () => {
    const packageId = await createPkg(await seedWard());
    const u = await UserModel.create({
      tenantId: otherTenantId, email: 'admin@other.com', name: 'Other', passwordHash: 'x',
      role: UserRole.HOSPITAL_ADMIN, isActive: true, isFirstLogin: false,
    });
    const otherToken = signToken((u._id as mongoose.Types.ObjectId).toString(), UserRole.HOSPITAL_ADMIN, otherTenantId);
    const res = await request(app)
      .get(`/api/packages/${packageId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });
});
