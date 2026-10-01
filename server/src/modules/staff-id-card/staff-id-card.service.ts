import { v4 as uuidv4 } from 'uuid';
import { staffIdCardRepository } from './staff-id-card.repository';
import { buildStaffIdCardPdf, buildS3Key, computeExpiryDate } from './staff-id-card.pdf';
import {
  generateVerificationToken,
  hashVerificationToken,
  isWellFormedVerificationToken,
  resolveStaffVerifyBaseUrl,
  buildVerificationUrl,
} from './staff-id-card.token';
import { userRepository }   from '../user/user.repository';
import { TenantModel }       from '../tenant/tenant.model';
import { s3Service }         from '../../shared/services/s3.service';
import { auditService }      from '../../shared/services/audit.service';
import { AuditEntityType, TenantStatus } from '../../shared/types/common.types';
import { NotFoundError, AppError } from '../../shared/middleware/error-handler';
import config from '../../shared/config/env';

const ID_CARD_URL_EXPIRY = 86400; // 24 hours

export interface StaffIdCardResult {
  userId:       string;
  s3Key:        string;
  issuedAt:     string;
  cardExpiresAt: string;
  presignedUrl: string;
  isNew:        boolean;
}

// Public verification response. This is an allow-list: nothing outside these
// fields may ever be added from the user/tenant/card documents.
export type StaffVerificationResult =
  | {
      valid:        true;
      status:       'ACTIVE';
      name:         string;
      employeeId:   string;
      role:         string;
      hospitalName: string;
      issuedAt:     string;
      expiresAt:    string;
    }
  | { valid: false; status: 'INACTIVE' };

// Every non-valid outcome (unknown/malformed token, rotated, expired, inactive
// user, inactive tenant) returns this exact shape — no staff details, and no
// signal as to which check failed.
const NOT_VALID: StaffVerificationResult = Object.freeze({ valid: false, status: 'INACTIVE' });

/**
 * The printed Employee ID is the user's Mongo _id. The public page shows only
 * its last 6 characters — enough for a guard to match against the physical
 * card without publishing the internal identifier.
 */
export function maskEmployeeId(id: string): string {
  return `••••${id.slice(-6)}`;
}

class StaffIdCardService {
  computeIssuedAt(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  async generate(
    tenantId:    string,
    userId:      string,
    requesterId: string,
  ): Promise<StaffIdCardResult> {
    const baseUrl = resolveStaffVerifyBaseUrl(config.staffVerification.baseUrl, config.nodeEnv);
    if (!baseUrl) {
      throw new AppError('Staff ID card verification is not configured (STAFF_VERIFY_BASE_URL).', 500);
    }

    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    const tenant = await TenantModel.findById(tenantId);

    const issuedAt  = this.computeIssuedAt();
    const expiresAt = computeExpiryDate(issuedAt);
    const s3Key     = buildS3Key(tenantId, userId, uuidv4());

    // A fresh token on every generate/regenerate: storing its new hash below
    // is what invalidates the previously printed QR.
    const token = generateVerificationToken();

    const logoUrl = tenant?.branding?.logoUrl
      ? await s3Service.getPresignedUrl(tenant.branding.logoUrl, 300).catch(() => null)
      : null;

    const profileImageUrl = user.profileImageUrl
      ? await s3Service.getPresignedUrl(user.profileImageUrl, 300).catch(() => null)
      : null;

    const pdfBuffer = await buildStaffIdCardPdf({
      name:            user.name,
      role:            user.role,
      employeeId:      (user._id as { toString(): string }).toString(),
      issuedAt,
      expiresAt,
      primaryColor:    tenant?.branding?.primaryColor ?? '#2563EB',
      verificationUrl: buildVerificationUrl(baseUrl, token),
      logoUrl,
      profileImageUrl,
    });

    try {
      await s3Service.uploadFile(s3Key, pdfBuffer, 'application/pdf');
    } catch {
      throw new AppError('File storage operation failed.', 502);
    }

    // PDF is uploaded under its own unique key BEFORE the record points at it,
    // and s3Key + token hash are swapped in a single atomic write.
    let previous;
    try {
      previous = await staffIdCardRepository.replaceIssuedCard(tenantId, userId, {
        s3Key,
        issuedAt,
        expiresAt,
        verificationTokenHash: hashVerificationToken(token),
      });
    } catch (err) {
      await s3Service.deleteFile(s3Key).catch(() => {/* orphan cleanup — non-fatal */});
      throw err;
    }

    if (previous?.s3Key && previous.s3Key !== s3Key) {
      await s3Service.deleteFile(previous.s3Key).catch(() => {/* orphan cleanup — non-fatal */});
    }

    const isNew = !previous;

    await auditService.log({
      entityType: AuditEntityType.STAFF_ID_CARD,
      entityId:   userId,
      action:     isNew ? 'CREATE' : 'UPDATE',
      userId:     requesterId,
      tenantId,
      newValue:   { userId, s3Key, issuedAt: issuedAt.toISOString() },
    });

    const presignedUrl = await s3Service.getPresignedUrl(s3Key, ID_CARD_URL_EXPIRY);

    return {
      userId,
      s3Key,
      issuedAt:     issuedAt.toISOString(),
      cardExpiresAt: expiresAt.toISOString(),
      presignedUrl,
      isNew,
    };
  }

  /** Public, unauthenticated QR verification. Token-only lookup; never by userId. */
  async verify(token: unknown): Promise<StaffVerificationResult> {
    if (!isWellFormedVerificationToken(token)) return NOT_VALID;

    const card = await staffIdCardRepository.findByVerificationTokenHash(hashVerificationToken(token));
    if (!card) return NOT_VALID;
    if (!(card.expiresAt instanceof Date) || card.expiresAt.getTime() <= Date.now()) return NOT_VALID;

    // Tenant isolation: every follow-up read is scoped by the card's own tenantId.
    const [user, tenant] = await Promise.all([
      userRepository.findById(card.tenantId, card.userId),
      TenantModel.findById(card.tenantId).select({ name: 1, status: 1, 'branding.displayName': 1 }).lean(),
    ]);

    if (!user || !user.isActive || user.tenantId !== card.tenantId) return NOT_VALID;
    if (!tenant || tenant.status !== TenantStatus.ACTIVE) return NOT_VALID;

    return {
      valid:        true,
      status:       'ACTIVE',
      name:         user.name,
      employeeId:   maskEmployeeId((user._id as { toString(): string }).toString()),
      role:         user.role,
      hospitalName: tenant.branding?.displayName || tenant.name,
      issuedAt:     card.issuedAt.toISOString().slice(0, 10),
      expiresAt:    card.expiresAt.toISOString().slice(0, 10),
    };
  }
}

export const staffIdCardService = new StaffIdCardService();
