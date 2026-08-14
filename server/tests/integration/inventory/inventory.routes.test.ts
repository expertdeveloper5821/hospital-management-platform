import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';
import { v4 as uuidv4 }      from 'uuid';

jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: { sendInviteEmail: jest.fn(), sendWelcomeEmail: jest.fn() },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: {
    log:       jest.fn().mockResolvedValue(undefined),
    queryLogs: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
  },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn(),
    getPresignedUrl: jest.fn(),
  },
}));
jest.mock('../../../src/modules/notification/notification.service', () => ({
  notificationService: {
    sendNotification: jest.fn().mockResolvedValue(undefined),
    sendToRole:       jest.fn().mockResolvedValue(undefined),
  },
}));

import app                   from '../../../src/app';
import { UserModel }         from '../../../src/modules/user/user.model';
import { TenantModel }       from '../../../src/modules/tenant/tenant.model';
import { InventoryItemModel } from '../../../src/modules/inventory/inventory.model';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod:         MongoMemoryServer;
let tenantId:       string;
let adminToken:     string;
let adminRoleToken: string;
let managerToken:   string;
let doctorToken:    string;
let nurseToken:     string;
let receptionistToken: string;

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
    name:        'Inventory Test Hospital',
    adminEmail:  'admin@invtest.com',
    status:      TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg-cert-001',
      gstNumber:               'GST001',
      panCard:                 'PAN001',
      addressLine:            '456 Inventory Lane',
      city:                    'Mumbai',
      state:                   'Maharashtra',
      pincode:                 '400001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const admin = await UserModel.create({
    tenantId, email: 'admin@inv.com', name: 'Inv Admin', passwordHash: 'x',
    role: UserRole.HOSPITAL_ADMIN, isActive: true, isFirstLogin: false,
  });
  const adminRole = await UserModel.create({
    tenantId, email: 'adminrole@inv.com', name: 'Inv Admin Role', passwordHash: 'x',
    role: UserRole.ADMIN, isActive: true, isFirstLogin: false,
  });
  const manager = await UserModel.create({
    tenantId, email: 'manager@inv.com', name: 'Inv Manager', passwordHash: 'x',
    role: UserRole.MANAGER, isActive: true, isFirstLogin: false,
  });
  const doctor = await UserModel.create({
    tenantId, email: 'doctor@inv.com', name: 'Inv Doctor', passwordHash: 'x',
    role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
  });
  const nurse = await UserModel.create({
    tenantId, email: 'nurse@inv.com', name: 'Inv Nurse', passwordHash: 'x',
    role: UserRole.NURSE, isActive: true, isFirstLogin: false,
  });
  const receptionist = await UserModel.create({
    tenantId, email: 'receptionist@inv.com', name: 'Inv Receptionist', passwordHash: 'x',
    role: UserRole.RECEPTIONIST, isActive: true, isFirstLogin: false,
  });

  const sign = (id: string, role: UserRole) =>
    jwt.sign(
      { userId: id.toString(), tenantId, role, email: 'x@x.com', isFirstLogin: false },
      JWT_SECRET,
    );

  adminToken     = sign((admin._id as mongoose.Types.ObjectId).toString(), UserRole.HOSPITAL_ADMIN);
  adminRoleToken = sign((adminRole._id as mongoose.Types.ObjectId).toString(), UserRole.ADMIN);
  managerToken   = sign((manager._id as mongoose.Types.ObjectId).toString(), UserRole.MANAGER);
  doctorToken    = sign((doctor._id as mongoose.Types.ObjectId).toString(), UserRole.DOCTOR);
  nurseToken     = sign((nurse._id as mongoose.Types.ObjectId).toString(), UserRole.NURSE);
  receptionistToken = sign((receptionist._id as mongoose.Types.ObjectId).toString(), UserRole.RECEPTIONIST);
});

// ─── Create ───────────────────────────────────────────────────────────────────

describe('POST /api/inventory', () => {
  const validPayload = {
    name:              'Paracetamol 500mg',
    category:          'Medication',
    unit:              'tablets',
    quantity:          200,
    lowStockThreshold: 50,
  };

  test('creates an inventory item (201)', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Paracetamol 500mg');
    expect(res.body.data.quantity).toBe(200);
    expect(res.body.data.isLowStock).toBe(false);
  });

  test('creates item with manager role (201)', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${managerToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
  });

  test('returns 403 for doctor role', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send(validPayload);

    expect(res.status).toBe(403);
  });

  test('returns 403 for nurse role (cannot create/modify inventory)', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send(validPayload);

    expect(res.status).toBe(403);
  });

  test('returns 403 for receptionist role (cannot create/modify inventory)', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send(validPayload);

    expect(res.status).toBe(403);
  });

  test('returns 400 for negative initial quantity', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, quantity: -1 });

    expect(res.status).toBe(400);
  });

  test.each(['Equipment', 'Consumable', 'Medication', 'PPE', 'Fluids', 'Medical Supplies', 'Other'])(
    'accepts predefined category "%s" (201)',
    async (category) => {
      const res = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...validPayload, category });

      expect(res.status).toBe(201);
      expect(res.body.data.category).toBe(category);
    },
  );

  test('returns 400 for a custom/invalid category', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, category: 'Not A Real Category' });

    expect(res.status).toBe(400);
  });

  test('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Item without category' });

    expect(res.status).toBe(400);
  });

  test('creates an item with no description (optional field left empty)', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.description ?? null).toBeNull();
  });

  test('returns 400 for description exceeding maximum length', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, description: 'A'.repeat(1001) });

    expect(res.status).toBe(400);
  });

  test('trims leading/trailing whitespace from description', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, description: '  Sterile packaging  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBe('Sterile packaging');
  });
});

// ─── List ─────────────────────────────────────────────────────────────────────

describe('GET /api/inventory', () => {
  beforeEach(async () => {
    await InventoryItemModel.create([
      { itemId: uuidv4(), tenantId, name: 'Saline Solution', category: 'Fluids', unit: 'bags', quantity: 5, lowStockThreshold: 20 },
      { itemId: uuidv4(), tenantId, name: 'Syringes 5ml',   category: 'Equipment', unit: 'pcs', quantity: 500, lowStockThreshold: 50 },
    ]);
  });

  test('returns paginated list (200)', async () => {
    const res = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
  });

  test('filters by category', async () => {
    const res = await request(app)
      .get('/api/inventory?category=Fluids')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].category).toBe('Fluids');
  });

  test('doctor can read inventory (200)', async () => {
    const res = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
  });

  test('nurse can read inventory (view-only) (200)', async () => {
    const res = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${nurseToken}`);

    expect(res.status).toBe(200);
  });

  test('receptionist can read inventory (view-only) (200)', async () => {
    const res = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
  });
});

// ─── Category search: case-insensitive partial match ─────────────────────────

describe('GET /api/inventory — category search', () => {
  beforeEach(async () => {
    await InventoryItemModel.create([
      { itemId: uuidv4(), tenantId, name: 'Surgical Gloves', category: 'PPE',              unit: 'pairs', quantity: 100, lowStockThreshold: 20 },
      { itemId: uuidv4(), tenantId, name: 'Gauze Rolls',     category: 'Medical Supplies', unit: 'rolls', quantity: 40,  lowStockThreshold: 10 },
      { itemId: uuidv4(), tenantId, name: 'Paracetamol',     category: 'Medication',       unit: 'strips', quantity: 200, lowStockThreshold: 30 },
    ]);
  });

  test('exact match still works', async () => {
    const res = await request(app)
      .get('/api/inventory?category=PPE')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].category).toBe('PPE');
  });

  test('partial match returns items whose category contains the text', async () => {
    const res = await request(app)
      .get('/api/inventory?category=Supplies')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].category).toBe('Medical Supplies');
  });

  test('mixed-case input matches regardless of case', async () => {
    const lower = await request(app).get('/api/inventory?category=medical').set('Authorization', `Bearer ${adminToken}`);
    const upper = await request(app).get('/api/inventory?category=MEDICAL').set('Authorization', `Bearer ${adminToken}`);
    const mixed = await request(app).get('/api/inventory?category=MeDiCaL').set('Authorization', `Bearer ${adminToken}`);

    for (const res of [lower, upper, mixed]) {
      expect(res.status).toBe(200);
      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.data[0].category).toBe('Medical Supplies');
    }
  });

  test('leading/trailing spaces are trimmed before matching', async () => {
    const res = await request(app)
      .get('/api/inventory?category=' + encodeURIComponent('  ppe  '))
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].category).toBe('PPE');
  });

  test('no-match input returns an empty list, not an error', async () => {
    const res = await request(app)
      .get('/api/inventory?category=nonexistentcategory')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  test('category search input is treated as a literal substring, not a regex', async () => {
    const res = await request(app)
      .get('/api/inventory?category=' + encodeURIComponent('.*'))
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
  });

  test('pagination still works correctly together with the category filter', async () => {
    await InventoryItemModel.create([
      { itemId: uuidv4(), tenantId, name: 'Nitrile Gloves', category: 'PPE', unit: 'pairs', quantity: 60, lowStockThreshold: 15 },
      { itemId: uuidv4(), tenantId, name: 'Face Masks',     category: 'PPE', unit: 'boxes', quantity: 80, lowStockThreshold: 10 },
    ]);

    const res = await request(app)
      .get('/api/inventory?category=ppe&page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.totalPages).toBe(2);

    const page2 = await request(app)
      .get('/api/inventory?category=ppe&page=2&limit=2')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(page2.body.data.data).toHaveLength(1);
  });
});

// ─── Get by ID ────────────────────────────────────────────────────────────────

describe('GET /api/inventory/:itemId', () => {
  test('returns an item by ID (200)', async () => {
    const itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Gloves', category: 'PPE', unit: 'pairs',
      quantity: 100, lowStockThreshold: 10,
    });

    const res = await request(app)
      .get(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.itemId).toBe(itemId);
  });

  test('returns 404 for unknown item', async () => {
    const res = await request(app)
      .get(`/api/inventory/${uuidv4()}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── Update Stock ─────────────────────────────────────────────────────────────

describe('PATCH /api/inventory/:itemId/stock', () => {
  let itemId: string;

  beforeEach(async () => {
    itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Paracetamol', category: 'Medication',
      unit: 'tablets', quantity: 100, lowStockThreshold: 10,
    });
  });

  test('decreases stock (200)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/stock`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ quantityChange: -20, reason: 'dispense to ward' });

    expect(res.status).toBe(200);
    expect(res.body.data.quantity).toBe(80);
  });

  test('increases stock (200)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/stock`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ quantityChange: 50, reason: 'new delivery' });

    expect(res.status).toBe(200);
    expect(res.body.data.quantity).toBe(150);
  });

  test('rejects negative stock (400)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/stock`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ quantityChange: -999, reason: 'overdispense attempt' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/negative/i);
  });

  test('returns 400 for zero quantityChange', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/stock`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ quantityChange: 0, reason: 'no-op' });

    expect(res.status).toBe(400);
  });

  test('returns 403 for doctor', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/stock`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ quantityChange: -5, reason: 'x' });

    expect(res.status).toBe(403);
  });

  test('returns 403 for nurse (cannot modify stock)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/stock`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ quantityChange: -5, reason: 'x' });

    expect(res.status).toBe(403);
  });

  test('returns 403 for receptionist (cannot modify stock)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/stock`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ quantityChange: -5, reason: 'x' });

    expect(res.status).toBe(403);
  });
});

// ─── Update Threshold ─────────────────────────────────────────────────────────

describe('PATCH /api/inventory/:itemId/threshold', () => {
  let itemId: string;

  beforeEach(async () => {
    itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Gloves', category: 'PPE',
      unit: 'pairs', quantity: 100, lowStockThreshold: 10,
    });
  });

  test('updates the low-stock threshold (200)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/threshold`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lowStockThreshold: 25 });

    expect(res.status).toBe(200);
    expect(res.body.data.lowStockThreshold).toBe(25);
  });

  test('returns 400 for negative threshold', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/threshold`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lowStockThreshold: -1 });

    expect(res.status).toBe(400);
  });

  test('returns 403 for nurse (cannot modify threshold)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/threshold`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ lowStockThreshold: 25 });

    expect(res.status).toBe(403);
  });

  test('returns 403 for receptionist (cannot modify threshold)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}/threshold`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ lowStockThreshold: 25 });

    expect(res.status).toBe(403);
  });
});

// ─── Edit Item Metadata ───────────────────────────────────────────────────────

describe('PATCH /api/inventory/:itemId (metadata)', () => {
  let itemId: string;

  beforeEach(async () => {
    itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Bandages', category: 'Consumable',
      unit: 'rolls', quantity: 200, lowStockThreshold: 20,
    });
  });

  test('updates name and category (200)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Premium Bandages', category: 'Medical Supplies' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Premium Bandages');
    expect(res.body.data.category).toBe('Medical Supplies');
    expect(res.body.data.quantity).toBe(200); // unchanged
  });

  test('returns 400 for a custom/invalid category on update', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'Not A Real Category' });

    expect(res.status).toBe(400);
  });

  test('manager can edit item (200)', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
  });

  test('returns 403 for doctor role', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ name: 'Should Fail' });

    expect(res.status).toBe(403);
  });

  test('returns 400 when quantity is included in body', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantity: 500 });

    expect(res.status).toBe(400);
  });

  test('returns 400 when no editable field is provided', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('returns 404 for unknown item', async () => {
    const res = await request(app)
      .patch(`/api/inventory/${uuidv4()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ─── Delete Item ──────────────────────────────────────────────────────────────

describe('DELETE /api/inventory/:itemId', () => {
  let itemId: string;

  beforeEach(async () => {
    itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Expired Stock', category: 'Medication',
      unit: 'bottles', quantity: 10, lowStockThreshold: 5,
    });
  });

  test('soft-deletes an item (200)', async () => {
    const res = await request(app)
      .delete(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/deleted/i);

    // Item should no longer appear in list
    const listRes = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`);
    const ids = listRes.body.data.data.map((i: { itemId: string }) => i.itemId);
    expect(ids).not.toContain(itemId);
  });

  test('returns 404 when deleting an already-deleted item', async () => {
    await request(app)
      .delete(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const res = await request(app)
      .delete(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for doctor role', async () => {
    const res = await request(app)
      .delete(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
  });

  test('returns 404 for unknown item', async () => {
    const res = await request(app)
      .delete(`/api/inventory/${uuidv4()}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── Stock History ────────────────────────────────────────────────────────────

describe('GET /api/inventory/:itemId/stock-history', () => {
  let itemId: string;

  beforeEach(async () => {
    itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Saline Bags', category: 'Fluids',
      unit: 'bags', quantity: 100, lowStockThreshold: 10,
    });
  });

  test('returns paginated stock history (200)', async () => {
    const res = await request(app)
      .get(`/api/inventory/${itemId}/stock-history`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('page');
    expect(res.body.data).toHaveProperty('limit');
    expect(res.body.data).toHaveProperty('totalPages');
  });

  test('manager can access stock history (200)', async () => {
    const res = await request(app)
      .get(`/api/inventory/${itemId}/stock-history`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
  });

  test('returns 403 for doctor role', async () => {
    const res = await request(app)
      .get(`/api/inventory/${itemId}/stock-history`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
  });

  test('returns 404 for unknown item', async () => {
    const res = await request(app)
      .get(`/api/inventory/${uuidv4()}/stock-history`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── ADMIN role access (parity with HOSPITAL_ADMIN) ───────────────────────────

describe('ADMIN role — inventory access', () => {
  test('ADMIN can create an inventory item (201)', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminRoleToken}`)
      .send({
        name: 'Paracetamol 500mg', category: 'Medication', unit: 'tablets',
        quantity: 200, lowStockThreshold: 50,
      });

    expect(res.status).toBe(201);
  });

  test('ADMIN can list inventory items (200)', async () => {
    const res = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${adminRoleToken}`);

    expect(res.status).toBe(200);
  });

  test('ADMIN can get an inventory item by ID (200)', async () => {
    const itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Gloves', category: 'PPE', unit: 'pairs',
      quantity: 100, lowStockThreshold: 10,
    });

    const res = await request(app)
      .get(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminRoleToken}`);

    expect(res.status).toBe(200);
  });

  test('ADMIN can update stock (200)', async () => {
    const itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Paracetamol', category: 'Medication',
      unit: 'tablets', quantity: 100, lowStockThreshold: 10,
    });

    const res = await request(app)
      .patch(`/api/inventory/${itemId}/stock`)
      .set('Authorization', `Bearer ${adminRoleToken}`)
      .send({ quantityChange: -20, reason: 'dispense to ward' });

    expect(res.status).toBe(200);
    expect(res.body.data.quantity).toBe(80);
  });

  test('ADMIN can update the low-stock threshold (200)', async () => {
    const itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Gloves', category: 'PPE',
      unit: 'pairs', quantity: 100, lowStockThreshold: 10,
    });

    const res = await request(app)
      .patch(`/api/inventory/${itemId}/threshold`)
      .set('Authorization', `Bearer ${adminRoleToken}`)
      .send({ lowStockThreshold: 25 });

    expect(res.status).toBe(200);
    expect(res.body.data.lowStockThreshold).toBe(25);
  });

  test('ADMIN can edit item metadata (200)', async () => {
    const itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Bandages', category: 'Consumable',
      unit: 'rolls', quantity: 200, lowStockThreshold: 20,
    });

    const res = await request(app)
      .patch(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminRoleToken}`)
      .send({ name: 'Premium Bandages' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Premium Bandages');
  });

  test('ADMIN can access stock history (200)', async () => {
    const itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Saline Bags', category: 'Fluids',
      unit: 'bags', quantity: 100, lowStockThreshold: 10,
    });

    const res = await request(app)
      .get(`/api/inventory/${itemId}/stock-history`)
      .set('Authorization', `Bearer ${adminRoleToken}`);

    expect(res.status).toBe(200);
  });

  test('ADMIN can delete an item (200)', async () => {
    const itemId = uuidv4();
    await InventoryItemModel.create({
      itemId, tenantId, name: 'Expired Stock', category: 'Medication',
      unit: 'bottles', quantity: 10, lowStockThreshold: 5,
    });

    const res = await request(app)
      .delete(`/api/inventory/${itemId}`)
      .set('Authorization', `Bearer ${adminRoleToken}`);

    expect(res.status).toBe(200);
  });
});
