jest.mock('../../../src/modules/tenant/platform-settings.repository');
jest.mock('../../../src/shared/services/s3.service');
jest.mock('../../../src/shared/services/audit.service');

import { Request, Response, NextFunction } from 'express';
import { platformSettingsRepository } from '../../../src/modules/tenant/platform-settings.repository';
import { s3Service } from '../../../src/shared/services/s3.service';
import {
  getPlatformSettings,
  updatePlatformTitle,
  uploadPlatformLogo,
  uploadPlatformFavicon,
} from '../../../src/modules/tenant/tenant.controller';

const mockRepo = platformSettingsRepository as jest.Mocked<typeof platformSettingsRepository>;
const mockS3   = s3Service                  as jest.Mocked<typeof s3Service>;

function makeRes() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  return res;
}

function makeNext(): NextFunction { return jest.fn(); }

const DEFAULTS = {
  logoUrl:       null,
  faviconUrl:    null,
  platformTitle: 'MediCore HMS',
  updatedAt:     null,
  updatedBy:     null,
};

beforeEach(() => jest.clearAllMocks());

// ─── getPlatformSettings ──────────────────────────────────────────────────────

describe('getPlatformSettings', () => {
  it('returns defaults when no doc exists', async () => {
    mockRepo.get.mockResolvedValue(DEFAULTS);
    const res  = makeRes();
    const next = makeNext();
    await getPlatformSettings({} as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      data: expect.objectContaining({ logoUrl: null, faviconUrl: null, platformTitle: 'MediCore HMS' }),
    }));
    expect(mockS3.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('generates presigned URLs when keys are present', async () => {
    mockRepo.get.mockResolvedValue({ ...DEFAULTS, logoUrl: 'platform/logo.png', faviconUrl: 'platform/favicon.ico' });
    mockS3.getPresignedUrl.mockResolvedValue('https://s3.example.com/signed');
    const res  = makeRes();
    await getPlatformSettings({} as Request, res, makeNext());
    expect(mockS3.getPresignedUrl).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ logoUrl: 'https://s3.example.com/signed' }),
    }));
  });
});

// ─── updatePlatformTitle ──────────────────────────────────────────────────────

describe('updatePlatformTitle', () => {
  const user = { userId: 'admin-1' };

  it('rejects blank platformTitle with 400 via next', async () => {
    const req  = { body: { platformTitle: '' }, user } as unknown as Request;
    const next = makeNext() as jest.Mock;
    await updatePlatformTitle(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects platformTitle > 100 chars', async () => {
    const req  = { body: { platformTitle: 'A'.repeat(101) }, user } as unknown as Request;
    const next = makeNext() as jest.Mock;
    await updatePlatformTitle(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('HTML-escapes platformTitle and upserts', async () => {
    mockRepo.get.mockResolvedValue(DEFAULTS);
    mockRepo.upsert.mockResolvedValue();
    const req = { body: { platformTitle: '<script>xss</script>' }, user } as unknown as Request;
    const res = makeRes();
    await updatePlatformTitle(req, res, makeNext());
    expect(mockRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ platformTitle: '&lt;script&gt;xss&lt;/script&gt;' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('accepts valid title and returns 200', async () => {
    mockRepo.get.mockResolvedValue(DEFAULTS);
    mockRepo.upsert.mockResolvedValue();
    const req = { body: { platformTitle: 'My Hospital System' }, user } as unknown as Request;
    const res = makeRes();
    await updatePlatformTitle(req, res, makeNext());
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─── uploadPlatformLogo ───────────────────────────────────────────────────────

describe('uploadPlatformLogo', () => {
  const user = { userId: 'admin-1' };

  function pngBuffer(): Buffer {
    const buf = Buffer.alloc(16);
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
    return buf;
  }

  function jpegBuffer(): Buffer {
    const buf = Buffer.alloc(8);
    buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
    return buf;
  }

  it('rejects missing file', async () => {
    const req  = { user } as unknown as Request;
    const next = makeNext() as jest.Mock;
    await uploadPlatformLogo(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects wrong MIME (detected via magic bytes)', async () => {
    const gifBuf = Buffer.from([0x47, 0x49, 0x46, 0x38]);
    const req  = { file: { buffer: gifBuf, mimetype: 'image/gif' }, user } as unknown as Request;
    const next = makeNext() as jest.Mock;
    await uploadPlatformLogo(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects file exceeding 2 MB', async () => {
    const bigPng = Buffer.concat([pngBuffer(), Buffer.alloc(2 * 1024 * 1024 + 1)]);
    const req  = { file: { buffer: bigPng, mimetype: 'image/png' }, user } as unknown as Request;
    const next = makeNext() as jest.Mock;
    await uploadPlatformLogo(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('uploads a valid PNG logo and returns 200', async () => {
    mockRepo.get.mockResolvedValue(DEFAULTS);
    mockRepo.upsert.mockResolvedValue();
    mockS3.uploadFile.mockResolvedValue('platform/logo.png');
    const req = { file: { buffer: pngBuffer(), mimetype: 'image/png' }, user } as unknown as Request;
    const res = makeRes();
    await uploadPlatformLogo(req, res, makeNext());
    expect(mockS3.uploadFile).toHaveBeenCalledWith('platform/logo.png', expect.any(Buffer), 'image/png');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uploads a valid JPEG logo', async () => {
    mockRepo.get.mockResolvedValue(DEFAULTS);
    mockRepo.upsert.mockResolvedValue();
    mockS3.uploadFile.mockResolvedValue('platform/logo.jpg');
    const req = { file: { buffer: jpegBuffer(), mimetype: 'image/jpeg' }, user } as unknown as Request;
    const res = makeRes();
    await uploadPlatformLogo(req, res, makeNext());
    expect(mockS3.uploadFile).toHaveBeenCalledWith('platform/logo.jpg', expect.any(Buffer), 'image/jpeg');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('deletes old logo when key differs', async () => {
    mockRepo.get.mockResolvedValue({ ...DEFAULTS, logoUrl: 'platform/logo.jpg' });
    mockRepo.upsert.mockResolvedValue();
    mockS3.uploadFile.mockResolvedValue('platform/logo.png');
    mockS3.deleteFile.mockResolvedValue();
    const req = { file: { buffer: pngBuffer(), mimetype: 'image/png' }, user } as unknown as Request;
    await uploadPlatformLogo(req, makeRes(), makeNext());
    expect(mockS3.deleteFile).toHaveBeenCalledWith('platform/logo.jpg');
  });
});

// ─── uploadPlatformFavicon ────────────────────────────────────────────────────

describe('uploadPlatformFavicon', () => {
  const user = { userId: 'admin-1' };

  function icoBuffer(): Buffer {
    const buf = Buffer.alloc(8);
    buf[0] = 0x00; buf[1] = 0x00; buf[2] = 0x01; buf[3] = 0x00;
    return buf;
  }

  function pngBuffer(): Buffer {
    const buf = Buffer.alloc(16);
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
    return buf;
  }

  it('rejects missing file', async () => {
    const req  = { user } as unknown as Request;
    const next = makeNext() as jest.Mock;
    await uploadPlatformFavicon(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects wrong MIME for favicon', async () => {
    const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const req  = { file: { buffer: jpegBuf, mimetype: 'image/jpeg' }, user } as unknown as Request;
    const next = makeNext() as jest.Mock;
    await uploadPlatformFavicon(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects file exceeding 500 KB', async () => {
    const bigIco = Buffer.concat([icoBuffer(), Buffer.alloc(500 * 1024 + 1)]);
    const req  = { file: { buffer: bigIco, mimetype: 'image/x-icon' }, user } as unknown as Request;
    const next = makeNext() as jest.Mock;
    await uploadPlatformFavicon(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('uploads a valid ICO favicon and returns 200', async () => {
    mockRepo.get.mockResolvedValue(DEFAULTS);
    mockRepo.upsert.mockResolvedValue();
    mockS3.uploadFile.mockResolvedValue('platform/favicon.ico');
    const req = { file: { buffer: icoBuffer(), mimetype: 'image/x-icon' }, user } as unknown as Request;
    const res = makeRes();
    await uploadPlatformFavicon(req, res, makeNext());
    expect(mockS3.uploadFile).toHaveBeenCalledWith('platform/favicon.ico', expect.any(Buffer), 'image/x-icon');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uploads a valid PNG favicon and returns 200', async () => {
    mockRepo.get.mockResolvedValue(DEFAULTS);
    mockRepo.upsert.mockResolvedValue();
    mockS3.uploadFile.mockResolvedValue('platform/favicon.png');
    const req = { file: { buffer: pngBuffer(), mimetype: 'image/png' }, user } as unknown as Request;
    const res = makeRes();
    await uploadPlatformFavicon(req, res, makeNext());
    expect(mockS3.uploadFile).toHaveBeenCalledWith('platform/favicon.png', expect.any(Buffer), 'image/png');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('deletes old favicon when key differs', async () => {
    mockRepo.get.mockResolvedValue({ ...DEFAULTS, faviconUrl: 'platform/favicon.png' });
    mockRepo.upsert.mockResolvedValue();
    mockS3.uploadFile.mockResolvedValue('platform/favicon.ico');
    mockS3.deleteFile.mockResolvedValue();
    const req = { file: { buffer: icoBuffer(), mimetype: 'image/x-icon' }, user } as unknown as Request;
    await uploadPlatformFavicon(req, makeRes(), makeNext());
    expect(mockS3.deleteFile).toHaveBeenCalledWith('platform/favicon.png');
  });
});
