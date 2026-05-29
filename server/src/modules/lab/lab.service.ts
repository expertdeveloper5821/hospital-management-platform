import { v4 as uuidv4 } from 'uuid';
import { labRepository } from './lab.repository';
import { IPathologyRequest, IRadiologyRequest } from './lab.model';
import {
  LabRequestStatus,
  CreatePathologyRequestInput,
  CreateRadiologyRequestInput,
  EditPathologyRequestInput,
  EditRadiologyRequestInput,
  ListLabRequestsQuery,
  PathologyRequestResponse,
  RadiologyRequestResponse,
  PATHOLOGY_REPORT_MAX_BYTES,
  RADIOLOGY_REPORT_MAX_BYTES,
} from './lab.types';
import { patientRepository }   from '../patient/patient.repository';
import { notificationService } from '../notification/notification.service';
import { s3Service }           from '../../shared/services/s3.service';
import { auditService }        from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import { AppError, NotFoundError, ForbiddenError } from '../../shared/middleware/error-handler';

// Pre-signed URL expiry: 1 hour (3600 s) — short-lived per security baseline.
const REPORT_URL_EXPIRY_SECONDS = 3600;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveReportUrl(s3Key: string | null): Promise<string | null> {
  if (!s3Key) return null;
  return s3Service.getPresignedUrl(s3Key, REPORT_URL_EXPIRY_SECONDS);
}

async function getPatientFullName(tenantId: string, patientId: string): Promise<string | undefined> {
  const patient = await patientRepository.findByPatientId(tenantId, patientId);
  return patient?.fullName;
}

async function toPathologyResponse(
  doc: IPathologyRequest,
  fullName?: string,
): Promise<PathologyRequestResponse> {
  return {
    requestId:   doc.requestId,
    patientId:   doc.patientId,
    fullName:    fullName ?? await getPatientFullName(doc.tenantId, doc.patientId),
    tenantId:    doc.tenantId,
    requestedBy: doc.requestedBy,
    testType:    doc.testType,
    status:      doc.status,
    priority:    doc.priority,
    notes:       doc.notes,
    reportUrl:   await resolveReportUrl(doc.reportS3Key),
    requestedAt: doc.requestedAt.toISOString(),
    updatedAt:   doc.updatedAt.toISOString(),
  };
}

async function toRadiologyResponse(
  doc: IRadiologyRequest,
  fullName?: string,
): Promise<RadiologyRequestResponse> {
  return {
    requestId:   doc.requestId,
    patientId:   doc.patientId,
    fullName:    fullName ?? await getPatientFullName(doc.tenantId, doc.patientId),
    tenantId:    doc.tenantId,
    requestedBy: doc.requestedBy,
    imagingType: doc.imagingType,
    status:      doc.status,
    priority:    doc.priority,
    notes:       doc.notes,
    reportUrl:   await resolveReportUrl(doc.reportS3Key),
    requestedAt: doc.requestedAt.toISOString(),
    updatedAt:   doc.updatedAt.toISOString(),
  };
}

// ─── LabService ───────────────────────────────────────────────────────────────

export class LabService {

  // ─── Pathology ─────────────────────────────────────────────────────────────

  async createPathologyRequest(
    input:    CreatePathologyRequestInput,
    tenantId: string,
    userId:   string,
  ): Promise<PathologyRequestResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const doc = await labRepository.savePathology({
      requestId:   uuidv4(),
      patientId:   input.patientId,
      tenantId,
      requestedBy: userId,
      testType:    input.testType,
      status:      LabRequestStatus.PENDING,
      notes:       input.notes ?? null,
      reportS3Key: null,
      requestedAt: new Date(),
    });

    try {
      await notificationService.sendToRole(
        UserRole.PATHOLOGIST, tenantId,
        'New Pathology Request',
        `A new pathology test has been requested: ${input.testType}`,
        'PATHOLOGY_REQUEST', doc.requestId,
      );
    } catch { /* swallow */ }

    try {
      await auditService.log({
        entityType: AuditEntityType.PATHOLOGY_REQUEST,
        entityId:   doc.requestId,
        action:     'CREATE',
        userId,
        tenantId,
        newValue:   { patientId: input.patientId, testType: input.testType },
      });
    } catch { /* swallow */ }

    return toPathologyResponse(doc);
  }

  async uploadPathologyReport(
    requestId:  string,
    tenantId:   string,
    userId:     string,
    fileBuffer: Buffer,
    mimeType:   string,
  ): Promise<PathologyRequestResponse> {
    if (fileBuffer.length > PATHOLOGY_REPORT_MAX_BYTES) {
      throw new AppError(
        `Pathology report exceeds the 10 MB size limit (received ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`,
        413,
      );
    }

    const request = await labRepository.findPathologyById(requestId, tenantId);
    if (!request) throw new NotFoundError('Pathology request not found');

    if (request.status === LabRequestStatus.COMPLETED) {
      throw new AppError('Report has already been uploaded for this request', 409);
    }

    // Upload to S3; store the key as the permanent reference in the DB.
    const ext   = mimeType.split('/')[1] ?? 'bin';
    const s3Key = `org/${tenantId}/lab/pathology/${requestId}/report.${ext}`;
    await s3Service.uploadFile(s3Key, fileBuffer, mimeType);

    const updated = await labRepository.updatePathology(requestId, tenantId, {
      status:      LabRequestStatus.COMPLETED,
      reportS3Key: s3Key,
    });
    if (!updated) throw new NotFoundError('Pathology request not found');

    try {
      await notificationService.sendNotification(
        request.requestedBy, tenantId,
        'Pathology Report Ready',
        `The pathology report for test "${request.testType}" is now available.`,
        'PATHOLOGY_REQUEST', requestId,
      );
    } catch { /* swallow */ }

    try {
      await auditService.log({
        entityType:    AuditEntityType.PATHOLOGY_REQUEST,
        entityId:      requestId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: { status: request.status },
        newValue:      { status: LabRequestStatus.COMPLETED, reportS3Key: s3Key },
      });
    } catch { /* swallow */ }

    // Response includes a fresh pre-signed URL so the caller can immediately download.
    return toPathologyResponse(updated);
  }

  async getPathologyRequest(requestId: string, tenantId: string): Promise<PathologyRequestResponse> {
    const doc = await labRepository.findPathologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Pathology request not found');
    return toPathologyResponse(doc);
  }

  async listPathologyRequests(
    tenantId: string,
    query:    ListLabRequestsQuery,
  ): Promise<PaginatedResult<PathologyRequestResponse>> {
    const result = await labRepository.findPathologyByPatient(tenantId, query);
    const patientIds = [...new Set(result.data.map((doc) => doc.patientId))];
    const nameMap = await patientRepository.findNamesByPatientIds(tenantId, patientIds);
    const data = await Promise.all(
      result.data.map((doc) => toPathologyResponse(doc, nameMap.get(doc.patientId))),
    );
    return { ...result, data };
  }

  // ─── Radiology ─────────────────────────────────────────────────────────────

  async createRadiologyRequest(
    input:    CreateRadiologyRequestInput,
    tenantId: string,
    userId:   string,
  ): Promise<RadiologyRequestResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const doc = await labRepository.saveRadiology({
      requestId:   uuidv4(),
      patientId:   input.patientId,
      tenantId,
      requestedBy: userId,
      imagingType: input.imagingType,
      status:      LabRequestStatus.PENDING,
      notes:       input.notes ?? null,
      reportS3Key: null,
      requestedAt: new Date(),
    });

    try {
      await notificationService.sendToRole(
        UserRole.RADIOLOGIST, tenantId,
        'New Radiology Request',
        `A new radiology imaging has been requested: ${input.imagingType}`,
        'RADIOLOGY_REQUEST', doc.requestId,
      );
    } catch { /* swallow */ }

    try {
      await auditService.log({
        entityType: AuditEntityType.RADIOLOGY_REQUEST,
        entityId:   doc.requestId,
        action:     'CREATE',
        userId,
        tenantId,
        newValue:   { patientId: input.patientId, imagingType: input.imagingType },
      });
    } catch { /* swallow */ }

    return toRadiologyResponse(doc);
  }

  async uploadRadiologyReport(
    requestId:  string,
    tenantId:   string,
    userId:     string,
    fileBuffer: Buffer,
    mimeType:   string,
  ): Promise<RadiologyRequestResponse> {
    if (fileBuffer.length > RADIOLOGY_REPORT_MAX_BYTES) {
      throw new AppError(
        `Radiology report exceeds the 20 MB size limit (received ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`,
        413,
      );
    }

    const request = await labRepository.findRadiologyById(requestId, tenantId);
    if (!request) throw new NotFoundError('Radiology request not found');

    if (request.status === LabRequestStatus.COMPLETED) {
      throw new AppError('Report has already been uploaded for this request', 409);
    }

    const ext   = mimeType.split('/')[1] ?? 'bin';
    const s3Key = `org/${tenantId}/lab/radiology/${requestId}/report.${ext}`;
    await s3Service.uploadFile(s3Key, fileBuffer, mimeType);

    const updated = await labRepository.updateRadiology(requestId, tenantId, {
      status:      LabRequestStatus.COMPLETED,
      reportS3Key: s3Key,
    });
    if (!updated) throw new NotFoundError('Radiology request not found');

    try {
      await notificationService.sendNotification(
        request.requestedBy, tenantId,
        'Radiology Report Ready',
        `The radiology report for "${request.imagingType}" is now available.`,
        'RADIOLOGY_REQUEST', requestId,
      );
    } catch { /* swallow */ }

    try {
      await auditService.log({
        entityType:    AuditEntityType.RADIOLOGY_REQUEST,
        entityId:      requestId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: { status: request.status },
        newValue:      { status: LabRequestStatus.COMPLETED, reportS3Key: s3Key },
      });
    } catch { /* swallow */ }

    return toRadiologyResponse(updated);
  }

  async getRadiologyRequest(requestId: string, tenantId: string): Promise<RadiologyRequestResponse> {
    const doc = await labRepository.findRadiologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Radiology request not found');
    return toRadiologyResponse(doc);
  }

  async listRadiologyRequests(
    tenantId: string,
    query:    ListLabRequestsQuery,
  ): Promise<PaginatedResult<RadiologyRequestResponse>> {
    const result = await labRepository.findRadiologyByPatient(tenantId, query);
    const patientIds = [...new Set(result.data.map((doc) => doc.patientId))];
    const nameMap = await patientRepository.findNamesByPatientIds(tenantId, patientIds);
    const data = await Promise.all(
      result.data.map((doc) => toRadiologyResponse(doc, nameMap.get(doc.patientId))),
    );
    return { ...result, data };
  }

  // ─── Edit & Delete — Pathology ────────────────────────────────────────────

  async editPathologyRequest(
    requestId: string,
    tenantId:  string,
    userId:    string,
    input:     EditPathologyRequestInput,
  ): Promise<PathologyRequestResponse> {
    const doc = await labRepository.findPathologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Pathology request not found');
    if (doc.status === LabRequestStatus.COMPLETED) {
      throw new AppError('Cannot edit a completed pathology request', 409);
    }

    const editableKeys = ['testType', 'notes', 'priority', 'status'] as const;
    const previousValue: Record<string, unknown> = {};
    const updatePayload: Partial<Pick<typeof doc, 'testType' | 'notes' | 'priority' | 'status'>> = {};
    for (const key of editableKeys) {
      if (key in input) {
        previousValue[key] = doc[key];
        (updatePayload as Record<string, unknown>)[key] = (input as Record<string, unknown>)[key];
      }
    }

    const updated = await labRepository.updatePathology(requestId, tenantId, updatePayload);
    if (!updated) throw new NotFoundError('Pathology request not found');

    try {
      await auditService.log({
        entityType:    AuditEntityType.PATHOLOGY_REQUEST,
        entityId:      requestId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue,
        newValue:      updatePayload as Record<string, unknown>,
      });
    } catch { /* swallow */ }

    return toPathologyResponse(updated);
  }

  async deletePathologyRequest(
    requestId: string,
    tenantId:  string,
    userId:    string,
    userRole:  UserRole,
  ): Promise<void> {
    const doc = await labRepository.findPathologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Pathology request not found');

    if (doc.status === LabRequestStatus.COMPLETED) {
      if (userRole !== UserRole.HOSPITAL_ADMIN && userRole !== UserRole.MANAGER) {
        throw new ForbiddenError('Only Hospital Admin or Manager can delete a completed pathology request');
      }
    }

    const deleted = await labRepository.softDeletePathology(requestId, tenantId);
    if (!deleted) throw new NotFoundError('Pathology request not found');

    try {
      await auditService.log({
        entityType:    AuditEntityType.PATHOLOGY_REQUEST,
        entityId:      requestId,
        action:        'DELETE',
        userId,
        tenantId,
        previousValue: { requestId, testType: doc.testType, status: doc.status, patientId: doc.patientId },
      });
    } catch { /* swallow */ }
  }

  // ─── Edit & Delete — Radiology ────────────────────────────────────────────

  async editRadiologyRequest(
    requestId: string,
    tenantId:  string,
    userId:    string,
    input:     EditRadiologyRequestInput,
  ): Promise<RadiologyRequestResponse> {
    const doc = await labRepository.findRadiologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Radiology request not found');
    if (doc.status === LabRequestStatus.COMPLETED) {
      throw new AppError('Cannot edit a completed radiology request', 409);
    }

    const editableKeys = ['imagingType', 'notes', 'priority', 'status'] as const;
    const previousValue: Record<string, unknown> = {};
    const updatePayload: Partial<Pick<typeof doc, 'imagingType' | 'notes' | 'priority' | 'status'>> = {};
    for (const key of editableKeys) {
      if (key in input) {
        previousValue[key] = doc[key];
        (updatePayload as Record<string, unknown>)[key] = (input as Record<string, unknown>)[key];
      }
    }

    const updated = await labRepository.updateRadiology(requestId, tenantId, updatePayload);
    if (!updated) throw new NotFoundError('Radiology request not found');

    try {
      await auditService.log({
        entityType:    AuditEntityType.RADIOLOGY_REQUEST,
        entityId:      requestId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue,
        newValue:      updatePayload as Record<string, unknown>,
      });
    } catch { /* swallow */ }

    return toRadiologyResponse(updated);
  }

  async deleteRadiologyRequest(
    requestId: string,
    tenantId:  string,
    userId:    string,
    userRole:  UserRole,
  ): Promise<void> {
    const doc = await labRepository.findRadiologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Radiology request not found');

    if (doc.status === LabRequestStatus.COMPLETED) {
      if (userRole !== UserRole.HOSPITAL_ADMIN && userRole !== UserRole.MANAGER) {
        throw new ForbiddenError('Only Hospital Admin or Manager can delete a completed radiology request');
      }
    }

    const deleted = await labRepository.softDeleteRadiology(requestId, tenantId);
    if (!deleted) throw new NotFoundError('Radiology request not found');

    try {
      await auditService.log({
        entityType:    AuditEntityType.RADIOLOGY_REQUEST,
        entityId:      requestId,
        action:        'DELETE',
        userId,
        tenantId,
        previousValue: { requestId, imagingType: doc.imagingType, status: doc.status, patientId: doc.patientId },
      });
    } catch { /* swallow */ }
  }
}

export const labService = new LabService();
