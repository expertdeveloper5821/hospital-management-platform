import { v4 as uuidv4 } from 'uuid';
import { staffIdCardRepository } from './staff-id-card.repository';
import { buildStaffIdCardPdf, buildS3Key, computeExpiryDate } from './staff-id-card.pdf';
import { userRepository }   from '../user/user.repository';
import { TenantModel }       from '../tenant/tenant.model';
import { s3Service }         from '../../shared/services/s3.service';
import { auditService }      from '../../shared/services/audit.service';
import { AuditEntityType }   from '../../shared/types/common.types';
import { NotFoundError, AppError } from '../../shared/middleware/error-handler';

const ID_CARD_URL_EXPIRY = 86400; // 24 hours

export interface StaffIdCardResult {
  userId:       string;
  s3Key:        string;
  issuedAt:     string;
  cardExpiresAt: string;
  presignedUrl: string;
  isNew:        boolean;
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
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    const tenant = await TenantModel.findById(tenantId);

    const existing = await staffIdCardRepository.findByUserId(tenantId, userId);
    const isNew    = !existing;
    const auditAction = isNew ? 'CREATE' : 'UPDATE';

    const issuedAt  = this.computeIssuedAt();
    const expiresAt = computeExpiryDate(issuedAt);
    const s3Key     = buildS3Key(tenantId, userId);

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
      logoUrl,
      profileImageUrl,
    });

    try {
      await s3Service.uploadFile(s3Key, pdfBuffer, 'application/pdf');
    } catch {
      throw new AppError('File storage operation failed.', 502);
    }

    await staffIdCardRepository.upsert(tenantId, userId, { s3Key, issuedAt, expiresAt });

    await auditService.log({
      entityType: AuditEntityType.STAFF_ID_CARD,
      entityId:   userId,
      action:     auditAction,
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
}

export const staffIdCardService = new StaffIdCardService();
