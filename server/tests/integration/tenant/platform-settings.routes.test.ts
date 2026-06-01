import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';

jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: {
    sendInviteEmail:        jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail:       jest.fn().mockResolvedValue(undefined),
    sendAccountLockEmail:   jest.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendTemplatedEmail:     jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn().mockResolvedValue('platform/logo.png'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.test/presigned'),
    deleteFile:      jest.fn().mockResolvedValue(undefined),
  },
}));

import app from '../../../src/app';
import { UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

let mongod: MongoMemoryServer;

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
});

function superAdminToken(userId = 'sa-1') {
  return jwt.sign(
    { userId, tenantId: null, role: UserRole.SUPER_ADMIN, email: 'sa@hms.com', isFirstLogin: false },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function hospitalAdminToken(tenantId = 'tid-1') {
  return jwt.sign(
    { userId: 'ha-1', tenantId, role: UserRole.HOSPITAL_ADMIN, email: 'ha@h.com', isFirstLogin: false },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

// ─── GET /api/tenants/platform-settings (public) ──────────────────────────

describe('GET /api/tenants/platform-settings', () => {
  it('returns 200 with defaults — no token required', async () => {
    const res = await request(app).get('/api/tenants/platform-settings');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toMatchObject({
      logoUrl:       null,
      faviconUrl:    null,
      platformTitle: 'MediCore HMS',
    });
  });

  it('returns presigned URLs after logo has been set', async () => {
    // Upload logo first
    const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00,
                                 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    await request(app)
      .post('/api/tenants/platform-settings/logo')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .attach('logo', pngBuf, { filename: 'logo.png', contentType: 'image/png' });

    const res = await request(app).get('/api/tenants/platform-settings');
    expect(res.status).toBe(200);
    expect(res.body.data.logoUrl).toBe('https://s3.test/presigned');
  });
});

// ─── PATCH /api/tenants/platform-settings (super admin auth) ──────────────

describe('PATCH /api/tenants/platform-settings', () => {
  it('returns 401 without token', async () => {
    const res = await request(app)
      .patch('/api/tenants/platform-settings')
      .send({ platformTitle: 'New Title' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-super-admin token', async () => {
    const res = await request(app)
      .patch('/api/tenants/platform-settings')
      .set('Authorization', `Bearer ${hospitalAdminToken()}`)
      .send({ platformTitle: 'New Title' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for blank platformTitle', async () => {
    const res = await request(app)
      .patch('/api/tenants/platform-settings')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .send({ platformTitle: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for platformTitle > 100 chars', async () => {
    const res = await request(app)
      .patch('/api/tenants/platform-settings')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .send({ platformTitle: 'A'.repeat(101) });
    expect(res.status).toBe(400);
  });

  it('updates platformTitle and returns 200', async () => {
    const res = await request(app)
      .patch('/api/tenants/platform-settings')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .send({ platformTitle: 'Sunrise Hospital Suite' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const get = await request(app).get('/api/tenants/platform-settings');
    expect(get.body.data.platformTitle).toBe('Sunrise Hospital Suite');
  });

  it('HTML-escapes the title', async () => {
    const res = await request(app)
      .patch('/api/tenants/platform-settings')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .send({ platformTitle: '<b>Bold</b>' });
    expect(res.status).toBe(200);

    const get = await request(app).get('/api/tenants/platform-settings');
    expect(get.body.data.platformTitle).toBe('&lt;b&gt;Bold&lt;/b&gt;');
  });
});

// ─── POST /api/tenants/platform-settings/logo ─────────────────────────────

describe('POST /api/tenants/platform-settings/logo', () => {
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00,
                                 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/tenants/platform-settings/logo')
      .attach('logo', validPng, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-super-admin', async () => {
    const res = await request(app)
      .post('/api/tenants/platform-settings/logo')
      .set('Authorization', `Bearer ${hospitalAdminToken()}`)
      .attach('logo', validPng, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for wrong MIME (GIF magic bytes)', async () => {
    const gifBuf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const res = await request(app)
      .post('/api/tenants/platform-settings/logo')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .attach('logo', gifBuf, { filename: 'logo.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app)
      .post('/api/tenants/platform-settings/logo')
      .set('Authorization', `Bearer ${superAdminToken()}`);
    expect(res.status).toBe(400);
  });

  it('uploads a valid PNG logo and returns 200', async () => {
    const res = await request(app)
      .post('/api/tenants/platform-settings/logo')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .attach('logo', validPng, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });
});

// ─── POST /api/tenants/platform-settings/favicon ──────────────────────────

describe('POST /api/tenants/platform-settings/favicon', () => {
  const validIco = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]);

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/tenants/platform-settings/favicon')
      .attach('favicon', validIco, { filename: 'favicon.ico', contentType: 'image/x-icon' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-super-admin', async () => {
    const res = await request(app)
      .post('/api/tenants/platform-settings/favicon')
      .set('Authorization', `Bearer ${hospitalAdminToken()}`)
      .attach('favicon', validIco, { filename: 'favicon.ico', contentType: 'image/x-icon' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for wrong MIME (JPEG magic bytes)', async () => {
    const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const res = await request(app)
      .post('/api/tenants/platform-settings/favicon')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .attach('favicon', jpegBuf, { filename: 'fav.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no file attached', async () => {
    const res = await request(app)
      .post('/api/tenants/platform-settings/favicon')
      .set('Authorization', `Bearer ${superAdminToken()}`);
    expect(res.status).toBe(400);
  });

  it('uploads a valid ICO favicon and returns 200', async () => {
    const res = await request(app)
      .post('/api/tenants/platform-settings/favicon')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .attach('favicon', validIco, { filename: 'favicon.ico', contentType: 'image/x-icon' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('uploads a valid PNG favicon and returns 200', async () => {
    const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00,
                                  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const res = await request(app)
      .post('/api/tenants/platform-settings/favicon')
      .set('Authorization', `Bearer ${superAdminToken()}`)
      .attach('favicon', pngBuf, { filename: 'favicon.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
  });
});
