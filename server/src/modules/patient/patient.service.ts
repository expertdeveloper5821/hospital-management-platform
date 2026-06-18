import { v4 as uuidv4 } from 'uuid';
import { patientRepository } from './patient.repository';
import { IPatient } from './patient.model';
import { tenantRepository } from '../tenant/tenant.repository';
import { ipdRepository } from '../ipd/ipd.repository';
import { buildMedicalCardPdf } from './medical-card.pdf';
import { s3Service }   from '../../shared/services/s3.service';
import { auditService } from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult } from '../../shared/types/common.types';
import { NotFoundError, ConflictError, AppError } from '../../shared/middleware/error-handler';
import { CreatePatientRequest, UpdatePatientRequest } from './patient.types';

// Thrown when a duplicate mobile is detected but forceCreate was not set.
// The controller returns 409 with isDuplicateWarning:true — not a hard error.
export class DuplicateWarningError extends Error {
  readonly statusCode   = 409;
  readonly isDuplicateWarning = true;

  constructor(message: string, public readonly existingPatientId: string) {
    super(message);
    this.name = 'DuplicateWarningError';
  }
}

export class PatientService {
  async createPatient(
    tenantId:  string,
    data:      CreatePatientRequest,
    createdBy: string,
  ): Promise<IPatient> {
    const existing = await patientRepository.findByMobile(tenantId, data.mobileNumber);
    if (existing && !data.forceCreate) {
      throw new DuplicateWarningError(
        `A patient with mobile ${data.mobileNumber} already exists. Send forceCreate:true to proceed.`,
        existing.patientId,
      );
    }

    const patientId = `PAT-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`;

    const patient = await patientRepository.save({
      patientId,
      tenantId,
      fullName:               data.fullName,
      dateOfBirth:            new Date(data.dateOfBirth),
      gender:                 data.gender,
      mobileNumber:           data.mobileNumber,
      address:                data.address,
      aadhaarNumber:          data.aadhaarNumber          ?? null,
      emergencyContactName:   data.emergencyContactName   ?? null,
      emergencyContactMobile: data.emergencyContactMobile ?? null,
      bloodGroup:             data.bloodGroup             ?? null,
    });

    await auditService.log({
      entityType: AuditEntityType.PATIENT,
      entityId:   patient.patientId,
      action:     'CREATE',
      userId:     createdBy,
      tenantId,
      newValue:   { patientId: patient.patientId, fullName: data.fullName, mobileNumber: data.mobileNumber },
    });

    return patient;
  }

  async updatePatient(
    tenantId:  string,
    patientId: string,
    data:      UpdatePatientRequest,
    updatedBy: string,
  ): Promise<IPatient> {
    const patient = await patientRepository.findByPatientId(tenantId, patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    // Build previousValue and newValue for audit (FR-06.7)
    const previousValue: Record<string, unknown> = {};
    const newValue:      Record<string, unknown> = {};
    const updateData:    Partial<IPatient>        = {};

    const fields = [
      'fullName', 'gender', 'mobileNumber', 'address',
      'aadhaarNumber', 'emergencyContactName', 'emergencyContactMobile', 'bloodGroup',
    ] as const;

    for (const key of fields) {
      if (data[key] !== undefined) {
        previousValue[key] = (patient as unknown as Record<string, unknown>)[key];
        newValue[key]      = data[key];
        (updateData as Record<string, unknown>)[key] = data[key];
      }
    }

    if (data.dateOfBirth !== undefined) {
      previousValue.dateOfBirth = patient.dateOfBirth;
      newValue.dateOfBirth      = new Date(data.dateOfBirth);
      updateData.dateOfBirth    = new Date(data.dateOfBirth);
    }

    const updated = await patientRepository.update(tenantId, patientId, updateData);
    if (!updated) throw new NotFoundError('Patient not found');

    await auditService.log({
      entityType:    AuditEntityType.PATIENT,
      entityId:      patientId,
      action:        'UPDATE',
      userId:        updatedBy,
      tenantId,
      previousValue,
      newValue,
    });

    return updated;
  }

  async getPatientById(tenantId: string, patientId: string): Promise<IPatient> {
    const patient = await patientRepository.findByPatientId(tenantId, patientId);
    if (!patient) throw new NotFoundError('Patient not found');
    return patient;
  }

  async deletePatient(
    tenantId:  string,
    patientId: string,
    deletedBy: string,
  ): Promise<void> {
    const patient = await patientRepository.findByPatientId(tenantId, patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const activeAdmission = await ipdRepository.findActiveAdmissionByPatient(patientId, tenantId);
    if (activeAdmission) {
      throw new ConflictError(
        'Patient has an active IPD admission. Discharge the patient before deletion.',
      );
    }

    await patientRepository.softDelete(tenantId, patientId);

    await auditService.log({
      entityType: AuditEntityType.PATIENT,
      entityId:   patientId,
      action:     'DELETE',
      userId:     deletedBy,
      tenantId,
      previousValue: { patientId, fullName: patient.fullName },
    });
  }

  async searchPatients(
    tenantId: string,
    q:        string | undefined,
    page:     number,
    limit:    number,
  ): Promise<PaginatedResult<IPatient>> {
    return patientRepository.search(tenantId, q, page, limit);
  }

  async generateMedicalCard(
    tenantId:    string,
    patientId:   string,
    requesterId?: string,
  ): Promise<Buffer> {
    const [patient, tenant] = await Promise.all([
      patientRepository.findByPatientId(tenantId, patientId),
      tenantRepository.findById(tenantId),
    ]);
    if (!patient) throw new NotFoundError('Patient not found');
    if (!tenant)  throw new NotFoundError('Tenant not found');

    const s3Key = `tenants/${tenantId}/medical-cards/${patientId}.pdf`;

    // Determine CREATE vs UPDATE by checking if S3 object exists
    let auditAction: 'CREATE' | 'UPDATE' = 'CREATE';
    try {
      await s3Service.getPresignedUrl(s3Key, 5);
      auditAction = 'UPDATE';
    } catch {
      auditAction = 'CREATE';
    }

    const pdfBuffer = await buildMedicalCardPdf(patient, {
      displayName:  tenant.branding.displayName || tenant.name,
      primaryColor: tenant.branding.primaryColor,
      logoUrl:      tenant.branding.logoUrl,
    });

    try {
      await s3Service.uploadFile(s3Key, pdfBuffer, 'application/pdf');
    } catch {
      throw new AppError('File storage operation failed.', 502);
    }

    await auditService.log({
      entityType: AuditEntityType.PATIENT,
      entityId:   patientId,
      action:     auditAction,
      userId:     requesterId ?? 'system',
      tenantId,
      newValue:   { patientId, medicalCardGenerated: true },
    });

    return pdfBuffer;
  }
}

export const patientService = new PatientService();
