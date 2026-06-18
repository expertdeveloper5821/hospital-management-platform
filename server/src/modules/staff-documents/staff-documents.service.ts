import { v4 as uuidv4 } from 'uuid';
import { staffDocumentRepository } from './staff-documents.repository';
import { DocumentCategory, IStaffDocument } from './staff-documents.model';
import { detectMimeFromBuffer, buildS3Key } from './staff-documents.utils';
import { userRepository } from '../user/user.repository';
import { s3Service }      from '../../shared/services/s3.service';
import { auditService }   from '../../shared/services/audit.service';
import { AuditEntityType } from '../../shared/types/common.types';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  AppError,
} from '../../shared/middleware/error-handler';

const DOC_URL_EXPIRY = 3600; // 1 hour

export interface UploadDocumentInput {
  category:     DocumentCategory;
  documentName: string;
}

export interface ChecklistItem {
  category: DocumentCategory;
  status:   'complete' | 'missing';
}

class StaffDocumentService {
  async uploadDocument(
    tenantId:   string,
    userId:     string,
    file:       Express.Multer.File,
    data:       UploadDocumentInput,
    uploadedBy: string,
  ): Promise<{ document: IStaffDocument; presignedUrl: string }> {
    // Verify user belongs to this tenant
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new ForbiddenError('User not found in this tenant');

    // Category document count limit (max 20)
    const count = await staffDocumentRepository.countByCategory(tenantId, userId, data.category);
    if (count >= 20) {
      throw new ValidationError(
        `Maximum of 20 documents per category reached for category: ${data.category}`,
        { category: data.category },
      );
    }

    // File size check
    if (file.size > 10_485_760) {
      throw new AppError('File exceeds 10 MB limit.', 413);
    }

    // MIME type check from buffer
    const mimeType = detectMimeFromBuffer(file.buffer);
    if (!mimeType) {
      throw new ValidationError('Unsupported file type. Only PDF, JPEG, and PNG are allowed.');
    }

    const documentId = uuidv4();
    const s3Key      = buildS3Key(tenantId, userId, documentId, mimeType);

    // Upload to S3
    try {
      await s3Service.uploadFile(s3Key, file.buffer, mimeType);
    } catch {
      throw new AppError('File storage operation failed.', 502);
    }

    // Req 5 AC-9: audit first — if it fails, nothing is persisted to DB
    try {
      await auditService.log({
        entityType: AuditEntityType.STAFF_DOCUMENT,
        entityId:   documentId,
        action:     'CREATE',
        userId:     uploadedBy,
        tenantId,
        newValue:   { documentId, category: data.category, documentName: data.documentName },
      });
    } catch {
      throw new AppError('Failed to log audit entry; document not saved.', 500);
    }

    let document: IStaffDocument;
    try {
      document = await staffDocumentRepository.save({
        documentId,
        tenantId,
        userId,
        category:     data.category,
        documentName: data.documentName,
        s3Key,
        uploadedBy,
        isDeleted:    false,
      });
    } catch {
      throw new AppError('Failed to save document record.', 500);
    }

    const presignedUrl = await s3Service.getPresignedUrl(s3Key, DOC_URL_EXPIRY);
    return { document, presignedUrl };
  }

  async listDocuments(
    tenantId:    string,
    userId:      string,
    requesterId: string,
  ): Promise<Array<IStaffDocument & { presignedUrl: string }>> {
    const requester = await userRepository.findById(tenantId, requesterId);
    if (!requester) throw new ForbiddenError('Requester not found in this tenant');

    const docs = await staffDocumentRepository.findByUser(tenantId, userId);

    return Promise.all(
      docs.map(async (doc) => {
        const presignedUrl = await s3Service.getPresignedUrl(doc.s3Key, DOC_URL_EXPIRY).catch(() => '');
        return { ...doc, presignedUrl } as IStaffDocument & { presignedUrl: string };
      }),
    );
  }

  async softDeleteDocument(
    tenantId:   string,
    documentId: string,
    deletedBy:  string,
  ): Promise<IStaffDocument> {
    const doc = await staffDocumentRepository.findById(tenantId, documentId);
    if (!doc) throw new NotFoundError('Document not found');

    if (doc.isDeleted) {
      throw new ConflictError(`Document ${documentId} has already been deleted.`);
    }

    // Req 5 AC-9: audit must succeed before persisting the soft-delete
    try {
      await auditService.log({
        entityType: AuditEntityType.STAFF_DOCUMENT,
        entityId:   documentId,
        action:     'UPDATE',
        userId:     deletedBy,
        tenantId,
        previousValue: { isDeleted: false },
        newValue:      { isDeleted: true, deletedBy },
      });
    } catch {
      throw new AppError('Failed to log audit entry; document not deleted.', 500);
    }

    const updated = await staffDocumentRepository.softDelete(tenantId, documentId, deletedBy);
    return updated!;
  }

  async getOnboardingChecklist(tenantId: string, userId: string): Promise<ChecklistItem[]> {
    const categories = Object.values(DocumentCategory);
    return Promise.all(
      categories.map(async (category) => {
        const count = await staffDocumentRepository.countByCategory(tenantId, userId, category);
        return { category, status: count > 0 ? 'complete' : 'missing' } as ChecklistItem;
      }),
    );
  }
}

export const staffDocumentService = new StaffDocumentService();
