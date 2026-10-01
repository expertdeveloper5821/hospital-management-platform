import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';
import bcrypt                 from 'bcryptjs';

// In-memory S3 so tests can read back exactly what PDF sits under each key.
const mockBucket = new Map<string, Buffer>();
const mockUploadDelays: number[] = [];
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile: jest.fn(async (key: string, body: Buffer) => {
      const delay = mockUploadDelays.shift() ?? 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      mockBucket.set(key, body);
      return `https://s3.test/${key}`;
    }),
    getPresignedUrl: jest.fn(async (key: string) => `https://s3.test/presigned/${key}`),
    deleteFile:      jest.fn(async (key: string) => { mockBucket.delete(key); }),
  },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) }),
}));
// Swap the PDF body for the QR URL it would encode, so a test can recover the
// token from whatever object is in the bucket. The real renderer is covered
// by tests/unit/staff-id-card/staff-id-card.pdf.test.ts (and one test below).
jest.mock('../../../src/modules/staff-id-card/staff-id-card.pdf', () => {
  const actual = jest.requireActual('../../../src/modules/staff-id-card/staff-id-card.pdf');
  return {
    ...actual,
    buildStaffIdCardPdf: jest.fn(async (o: { verificationUrl: string }) => Buffer.from(o.verificationUrl)),
  };
});

import app                   from '../../../src/app';
import { UserModel }         from '../../../src/modules/user/user.model';
import { TenantModel }       from '../../../src/modules/tenant/tenant.model';
import { StaffIdCardModel }  from '../../../src/modules/staff-id-card/staff-id-card.model';
import { staffVerifyRateLimiter } from '../../../src/modules/staff-id-card/staff-id-card.public.routes';
import { staffIdCardService } from '../../../src/modules/staff-id-card/staff-id-card.service';
import { buildStaffIdCardPdf } from '../../../src/modules/staff-id-card/staff-id-card.pdf';
import {
  generateVerificationToken,
  hashVerificationToken,
} from '../../../src/modules/staff-id-card/staff-id-card.token';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET  = process.env.JWT_SECRET!;
const VERIFY_BASE = '/api/public/staff-verification';
const RATE_MAX    = 30; // STAFF_VERIFY_RATE_LIMIT_MAX default

let mongod: MongoMemoryServer;
let ipCounter = 0;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await StaffIdCardModel.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  mockBucket.clear();
  mockUploadDelays.length = 0;
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function seedTenant(name = 'Test Hospital', status: TenantStatus = TenantStatus.ACTIVE) {
  return TenantModel.create({
    name: `${name} Pvt Ltd`,
    adminEmail: `admin@${name.toLowerCase().replace(/\s/g, '')}.com`,
    status,
    onboardingDocuments: {
      registrationCertificate: 'k1', gstNumber: 'GST1', panCard: 'k2',
      addressLine: '1 Road', city: 'Pune', state: 'MH', pincode: '411001',
    },
    branding: { displayName: name, primaryColor: '#1A73E8' },
  });
}

async function seedUser(tenantId: string, email: string, role: UserRole, extra: Record<string, unknown> = {}) {
  return UserModel.create({
    tenantId, email, name: `Staff ${email.split('@')[0]}`, role,
    passwordHash: await bcrypt.hash('TestPass123!', 1),
    phone: '9876543210', departmentIds: ['dept-secret-1'],
    profileImageUrl: 'tenants/x/profile/secret.png',
    isActive: true, isFirstLogin: false, ...extra,
  });
}

function bearer(userId: string, tenantId: string, role: UserRole) {
  const token = jwt.sign({ userId, tenantId, role, email: 'a@t.com', isFirstLogin: false }, JWT_SECRET, { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

/** Token as printed in the QR of the PDF currently stored under `s3Key`. */
function tokenInBucket(s3Key: string): string {
  const url = mockBucket.get(s3Key)!.toString();
  return url.split('#')[1];
}

// Distinct client IP per call (trust proxy = 1) so functional tests don't
// consume each other's rate-limit budget.
function verify(token: string, ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`) {
  return request(app).get(`${VERIFY_BASE}/${token}`).set('X-Forwarded-For', ip);
}

async function setup() {
  const tenant = await seedTenant();
  const tId    = tenant._id.toString();
  const admin  = await seedUser(tId, 'admin@t.com', UserRole.HOSPITAL_ADMIN);
  const staff  = await seedUser(tId, 'nurse@t.com', UserRole.NURSE);
  return { tenant, tId, admin, staff, sId: staff._id.toString(), auth: bearer(admin._id.toString(), tId, UserRole.HOSPITAL_ADMIN) };
}

async function generateViaApi(ctx: Awaited<ReturnType<typeof setup>>) {
  const res = await request(app).post(`/api/staff-id-cards/${ctx.sId}/generate`).set(ctx.auth);
  expect([200, 201]).toContain(res.status);
  const card = await StaffIdCardModel.findOne({ tenantId: ctx.tId, userId: ctx.sId }).select('+verificationTokenHash');
  return { res, card: card!, token: tokenInBucket(card!.s3Key) };
}

const ALLOWED_KEYS = ['valid', 'status', 'name', 'employeeId', 'role', 'hospitalName', 'issuedAt', 'expiresAt'].sort();
const NOT_VALID    = { valid: false, status: 'INACTIVE' };

// ─── Generation & storage ─────────────────────────────────────────────────────
describe('POST /api/staff-id-cards/:userId/generate — token storage', () => {
  test('stores only the SHA-256 hash; token lives only in the PDF', async () => {
    const ctx = await setup();
    const { res, card, token } = await generateViaApi(ctx);

    expect(res.status).toBe(201);
    expect(card.verificationTokenHash).toBe(hashVerificationToken(token));
    expect(card.verificationTokenHash).toMatch(/^[0-9a-f]{64}$/);

    const raw = await mongoose.connection.collection('staff_id_cards').findOne({});
    expect(JSON.stringify(raw)).not.toContain(token);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(token);
    expect(body).not.toContain(card.verificationTokenHash!);
  });

  test('hash is excluded from default reads (select: false)', async () => {
    const ctx = await setup();
    await generateViaApi(ctx);
    const card = await StaffIdCardModel.findOne({ userId: ctx.sId }).lean();
    expect(card).not.toHaveProperty('verificationTokenHash');
  });

  test('QR payload is only the verify URL — no userId/tenantId/PII', async () => {
    const ctx = await setup();
    const { card } = await generateViaApi(ctx);
    const url = mockBucket.get(card.s3Key)!.toString();
    expect(url).toMatch(/^https:\/\/verify\.test\.example\.com\/verify-staff#[A-Za-z0-9_-]{43}$/);
    for (const secret of [ctx.sId, ctx.tId, 'nurse@t.com', '9876543210', 'Staff nurse']) {
      expect(url).not.toContain(secret);
    }
  });

  test('regenerate rotates the token: old QR invalid, new QR valid, old PDF removed', async () => {
    const ctx = await setup();
    const first  = await generateViaApi(ctx);
    const second = await generateViaApi(ctx);

    expect(second.res.status).toBe(200);
    expect(second.token).not.toBe(first.token);
    expect(second.card.verificationTokenHash).not.toBe(first.card.verificationTokenHash);
    expect(mockBucket.has(first.card.s3Key)).toBe(false);
    expect(mockBucket.has(second.card.s3Key)).toBe(true);

    expect((await verify(first.token)).body.data).toEqual(NOT_VALID);
    expect((await verify(second.token)).body.data.valid).toBe(true);
  });

  test('legacy cards with a null hash coexist; duplicate hashes are rejected', async () => {
    const base = { s3Key: 'k', issuedAt: new Date(), expiresAt: new Date(), verificationTokenHash: null };
    await StaffIdCardModel.create({ ...base, tenantId: 't1', userId: 'u1' });
    await StaffIdCardModel.create({ ...base, tenantId: 't1', userId: 'u2' });

    const hash = hashVerificationToken(generateVerificationToken());
    await StaffIdCardModel.create({ ...base, tenantId: 't1', userId: 'u3', verificationTokenHash: hash });
    await expect(StaffIdCardModel.create({ ...base, tenantId: 't2', userId: 'u4', verificationTokenHash: hash }))
      .rejects.toMatchObject({ code: 11000 });
  });

  test('real PDF renderer produces a PDF upload', async () => {
    const ctx = await setup();
    const actual = jest.requireActual('../../../src/modules/staff-id-card/staff-id-card.pdf');
    (buildStaffIdCardPdf as jest.Mock).mockImplementationOnce(actual.buildStaffIdCardPdf);
    await request(app).post(`/api/staff-id-cards/${ctx.sId}/generate`).set(ctx.auth).expect(201);
    const card = await StaffIdCardModel.findOne({ userId: ctx.sId });
    expect(mockBucket.get(card!.s3Key)!.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────────
describe('concurrent Generate/Regenerate', () => {
  async function assertConsistent(ctx: Awaited<ReturnType<typeof setup>>) {
    const cards = await StaffIdCardModel.find({ tenantId: ctx.tId, userId: ctx.sId }).select('+verificationTokenHash');
    expect(cards).toHaveLength(1);
    const card = cards[0];
    // The PDF the record points at encodes exactly the token whose hash is stored.
    expect(mockBucket.has(card.s3Key)).toBe(true);
    const token = tokenInBucket(card.s3Key);
    expect(hashVerificationToken(token)).toBe(card.verificationTokenHash);
    expect((await verify(token)).body.data.valid).toBe(true);
    return { card, token };
  }

  test.each([
    ['earlier request finishes upload last', [60, 0]],
    ['earlier request finishes upload first', [0, 60]],
  ])('two regenerates — %s — leave PDF and hash matched', async (_l, delays) => {
    const ctx = await setup();
    await generateViaApi(ctx);
    mockUploadDelays.push(...delays);

    await Promise.all([
      staffIdCardService.generate(ctx.tId, ctx.sId, ctx.admin._id.toString()),
      staffIdCardService.generate(ctx.tId, ctx.sId, ctx.admin._id.toString()),
    ]);

    const { token } = await assertConsistent(ctx);
    // Every other issued token is dead, and superseded PDFs were cleaned up.
    const allUploaded = (jest.requireMock('../../../src/shared/services/s3.service').s3Service.uploadFile as jest.Mock)
      .mock.results.length;
    expect(allUploaded).toBeGreaterThan(0);
    expect(mockBucket.size).toBe(1);
    expect(tokenInBucket([...mockBucket.keys()][0])).toBe(token);
  });

  test('5 concurrent first-time generates for a new user stay consistent', async () => {
    const ctx = await setup();
    mockUploadDelays.push(30, 0, 15, 5, 0);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => staffIdCardService.generate(ctx.tId, ctx.sId, ctx.admin._id.toString())),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    await assertConsistent(ctx);
    expect(mockBucket.size).toBe(1);
  });
});

// ─── Public verification ──────────────────────────────────────────────────────
describe('GET /api/public/staff-verification/:token', () => {
  test('valid card → 200 with ONLY the allow-listed fields, no auth needed', async () => {
    const ctx = await setup();
    const { token } = await generateViaApi(ctx);

    const res = await verify(token);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(ALLOWED_KEYS);
    expect(res.body.data).toMatchObject({
      valid: true, status: 'ACTIVE', name: 'Staff nurse', role: 'NURSE', hospitalName: 'Test Hospital',
      employeeId: `••••${ctx.sId.slice(-6)}`,
    });
    expect(res.body.data.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.data.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('response never contains email, phone, ids, departments, S3 keys, presigned URLs or hashes', async () => {
    const ctx = await setup();
    const { card, token } = await generateViaApi(ctx);
    const raw = JSON.stringify((await verify(token)).body);

    for (const leaked of [
      ctx.sId, ctx.tId, 'nurse@t.com', '9876543210', 'dept-secret-1', 'secret.png',
      card.s3Key, 'presigned', 's3.test', card.verificationTokenHash!, token,
    ]) {
      expect(raw).not.toContain(leaked);
    }
    for (const key of ['_id', 'userId', 'tenantId', 'email', 'phone', 'departmentIds', 's3Key', 'profileImageUrl', 'presignedUrl', 'verificationTokenHash']) {
      expect(raw).not.toContain(`"${key}"`);
    }
  });

  test('sets no-store, noindex and no-referrer headers', async () => {
    const ctx = await setup();
    const { token } = await generateViaApi(ctx);
    const res = await verify(token);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  test('an invalid bearer token is irrelevant — route never runs JWT auth', async () => {
    const ctx = await setup();
    const { token } = await generateViaApi(ctx);
    const res = await verify(token).set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
  });

  test.each([
    ['unknown well-formed token', () => generateVerificationToken()],
    ['malformed token',           () => 'not-a-token'],
    ['token with operator chars', () => encodeURIComponent('{"$ne":null}')],
  ])('%s → identical NOT_VALID body with 200', async (_l, make) => {
    await setup();
    const res = await verify(make());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(NOT_VALID);
  });

  test('userId (the printed Employee ID) is never accepted as a lookup key', async () => {
    const ctx = await setup();
    await generateViaApi(ctx);
    expect((await verify(ctx.sId)).body.data).toEqual(NOT_VALID);
  });

  test('legacy card with no hash cannot be verified', async () => {
    const ctx = await setup();
    await StaffIdCardModel.create({
      tenantId: ctx.tId, userId: ctx.sId, s3Key: 'legacy.pdf',
      issuedAt: new Date(), expiresAt: new Date(Date.now() + 1e9), verificationTokenHash: null,
    });
    expect((await verify(generateVerificationToken())).body.data).toEqual(NOT_VALID);
  });

  test('expired card → NOT_VALID with no staff details', async () => {
    const ctx = await setup();
    const { token } = await generateViaApi(ctx);
    await StaffIdCardModel.updateOne({ userId: ctx.sId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verify(token);
    expect(res.body.data).toEqual(NOT_VALID);
    expect(JSON.stringify(res.body)).not.toContain('Staff nurse');
  });

  test('inactive user → NOT_VALID; reactivation restores validity', async () => {
    const ctx = await setup();
    const { token } = await generateViaApi(ctx);

    await UserModel.updateOne({ _id: ctx.sId }, { $set: { isActive: false } });
    const res = await verify(token);
    expect(res.body.data).toEqual(NOT_VALID);
    expect(JSON.stringify(res.body)).not.toContain('Staff nurse');

    await UserModel.updateOne({ _id: ctx.sId }, { $set: { isActive: true } });
    expect((await verify(token)).body.data.valid).toBe(true);
  });

  test('deactivation through the real API invalidates the card', async () => {
    const ctx = await setup();
    const { token } = await generateViaApi(ctx);
    await request(app).patch(`/api/users/${ctx.sId}/deactivate`).set(ctx.auth).expect(200);
    expect((await verify(token)).body.data).toEqual(NOT_VALID);
  });

  test.each([TenantStatus.INACTIVE, TenantStatus.PENDING_VERIFICATION])(
    'tenant status %s → NOT_VALID', async (status) => {
      const ctx = await setup();
      const { token } = await generateViaApi(ctx);
      await TenantModel.updateOne({ _id: ctx.tId }, { $set: { status } });
      expect((await verify(token)).body.data).toEqual(NOT_VALID);
    },
  );

  test('tenant isolation: a card record pointing at another tenant\'s user never verifies', async () => {
    const ctx = await setup();
    const { token } = await generateViaApi(ctx);
    const other = await seedTenant('Other Hospital');
    // Tamper: card claims a different tenant than the one the user belongs to.
    await StaffIdCardModel.updateOne({ userId: ctx.sId }, { $set: { tenantId: other._id.toString() } });
    const res = await verify(token);
    expect(res.body.data).toEqual(NOT_VALID);
    expect(JSON.stringify(res.body)).not.toContain('Other Hospital');
  });

  test('cards from two tenants each resolve to their own hospital', async () => {
    const a = await setup();
    const tB = await seedTenant('Beta Hospital');
    const adminB = await seedUser(tB._id.toString(), 'admin@b.com', UserRole.HOSPITAL_ADMIN);
    const staffB = await seedUser(tB._id.toString(), 'doc@b.com', UserRole.DOCTOR);
    const ctxB = {
      ...a, tenant: tB, tId: tB._id.toString(), admin: adminB, staff: staffB, sId: staffB._id.toString(),
      auth: bearer(adminB._id.toString(), tB._id.toString(), UserRole.HOSPITAL_ADMIN),
    };

    const cardA = await generateViaApi(a);
    const cardB = await generateViaApi(ctxB);

    expect((await verify(cardA.token)).body.data).toMatchObject({ hospitalName: 'Test Hospital', role: 'NURSE' });
    expect((await verify(cardB.token)).body.data).toMatchObject({ hospitalName: 'Beta Hospital', role: 'DOCTOR' });
  });
});

// ─── Rate limiting & logging ──────────────────────────────────────────────────
describe('public route security', () => {
  test(`rate limit: ${RATE_MAX} requests per IP, then 429; other IPs unaffected`, async () => {
    await setup();
    const ip = '203.0.113.7';
    staffVerifyRateLimiter.resetKey(ip);

    for (let i = 0; i < RATE_MAX; i++) {
      await verify(generateVerificationToken(), ip).expect(200);
    }
    const blocked = await verify(generateVerificationToken(), ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ status: 'error', message: 'Too many requests - please try again later' });
    expect(blocked.headers['cache-control']).toContain('no-store');

    await verify(generateVerificationToken(), '203.0.113.8').expect(200);
  });

  test('rate limit also counts malformed paths and other methods under the mount', async () => {
    const ip = '203.0.113.9';
    staffVerifyRateLimiter.resetKey(ip);
    for (let i = 0; i < RATE_MAX; i++) {
      await request(app).post(`${VERIFY_BASE}/x`).set('X-Forwarded-For', ip);
    }
    const res = await request(app).get(`${VERIFY_BASE}/`).set('X-Forwarded-For', ip);
    expect(res.status).toBe(429);
  });

  test('only GET is routed — POST falls through to 404', async () => {
    const res = await request(app).post(`${VERIFY_BASE}/${generateVerificationToken()}`).set('X-Forwarded-For', '198.51.100.1');
    expect(res.status).toBe(404);
  });

  test('request log redacts the token', async () => {
    const ctx = await setup();
    const { token } = await generateViaApi(ctx);

    const lines: string[] = [];
    const capture = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    const log  = jest.spyOn(console, 'log').mockImplementation(capture);
    const warn = jest.spyOn(console, 'warn').mockImplementation(capture);
    const err  = jest.spyOn(console, 'error').mockImplementation(capture);
    try {
      await verify(token).expect(200);
      await verify(`${token}?x=1`).expect(200);
      await request(app).get(`/API/Public/Staff-Verification/${token}`).set('X-Forwarded-For', '198.51.100.2');
      // 404 path goes through the global error handler, which also logs.
      await request(app).post(`${VERIFY_BASE}/${token}`).set('X-Forwarded-For', '198.51.100.3');
      await new Promise((r) => setImmediate(r));
    } finally {
      log.mockRestore(); warn.mockRestore(); err.mockRestore();
    }

    const requestLines = lines.filter((l) => l.includes('"correlationId"'));
    expect(requestLines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect(line).not.toContain(token);
    expect(requestLines.some((l) => l.includes('/api/public/staff-verification/[REDACTED]'))).toBe(true);
  });
});
