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
  LabTestTypeResponse,
  LAB_REFERRED_BY_SELF,
  CollectLabPaymentInput,
  LabPaymentSummary,
} from './lab.types';
import { patientRepository }   from '../patient/patient.repository';
import { userRepository }      from '../user/user.repository';
import { notificationService } from '../notification/notification.service';
import { s3Service }           from '../../shared/services/s3.service';
import { auditService }        from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import { AppError, NotFoundError, ForbiddenError, ConflictError } from '../../shared/middleware/error-handler';
import { PatientModel } from '../patient/patient.model';
import { tenantRepository }  from '../tenant/tenant.repository';
import { paymentRepository } from '../payment/payment.repository';
import { paymentService }    from '../payment/payment.service';
import { IPayment }          from '../payment/payment.model';
import { IPatient }          from '../patient/patient.model';
import { PaymentReferenceType, PaymentResponse } from '../payment/payment.types';
import { pdfService }        from '../../shared/services/pdf.service';
import { resolveReceiptHospitalDetails, resolvePatientAge } from '../../shared/utils/receipt-details';

// Pre-signed URL expiry: 1 hour (3600 s) — short-lived per security baseline.
const REPORT_URL_EXPIRY_SECONDS = 3600;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// `notes` is encrypted at rest on the request itself (see lab.model.ts). Audit
// log entries are stored in plain form and rendered in the Audit UI, so the
// note's value must never carry into one — the trail records *that* it changed,
// not what it changed to/from. Applied to both previousValue and newValue.
const REDACTED_AUDIT_MARKER = '[redacted]';

function redactNotes(values: Record<string, unknown>): Record<string, unknown> {
  if (values.notes === undefined || values.notes === null) return values;
  return { ...values, notes: REDACTED_AUDIT_MARKER };
}

async function resolveReportUrl(s3Key: string | null): Promise<string | null> {
  if (!s3Key) return null;
  return s3Service.getPresignedUrl(s3Key, REPORT_URL_EXPIRY_SECONDS);
}

async function resolvePatientIdsBySearch(tenantId: string, search: string): Promise<string[]> {
  const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re   = new RegExp(safe, 'i');
  const patients = await PatientModel.find(
    { tenantId, $or: [{ fullName: re }, { patientId: re }] },
    { patientId: 1 },
  ).lean();
  return patients.map((p) => p.patientId);
}

// Combines an optional search-derived patientId filter with an optional
// doctor-scoping patientId filter (intersection when both are present, so a
// Doctor's search results never include another doctor's patients).
function combinePatientIdFilters(
  searchIds?: string[],
  scopeIds?:  string[],
): string[] | undefined {
  if (searchIds && scopeIds) return searchIds.filter((id) => scopeIds.includes(id));
  return searchIds ?? scopeIds;
}

async function getPatientFullName(tenantId: string, patientId: string): Promise<string | undefined> {
  const patient = await patientRepository.findByPatientId(tenantId, patientId);
  return patient?.fullName;
}

async function getRequesterName(tenantId: string, userId: string): Promise<string | undefined> {
  const user = await userRepository.findById(tenantId, userId);
  return user?.name ?? user?.email;
}

// 'SELF' displays as "Self"; any other value is a referring doctor's userId,
// resolved to their display name.
async function getReferredByName(tenantId: string, referredBy: string): Promise<string> {
  if (referredBy === LAB_REFERRED_BY_SELF) return 'Self';
  const doctor = await userRepository.findById(tenantId, referredBy);
  return doctor?.name ?? doctor?.email ?? 'Self';
}

export type LabKind = 'pathology' | 'radiology';
type LabPaymentReferenceType =
  | typeof PaymentReferenceType.PATHOLOGY_REQUEST
  | typeof PaymentReferenceType.RADIOLOGY_REQUEST;

function labReferenceType(kind: LabKind): LabPaymentReferenceType {
  return kind === 'pathology' ? PaymentReferenceType.PATHOLOGY_REQUEST : PaymentReferenceType.RADIOLOGY_REQUEST;
}

function toPaymentSummary(p: IPayment): LabPaymentSummary {
  // A Billing charge's Payment is created PENDING with the charge and settled
  // later, so its settle time (updatedAt) is when it was actually paid.
  const paidAt = p.referenceType === PaymentReferenceType.CHARGE && p.updatedAt ? p.updatedAt : p.createdAt;
  return {
    paymentId:        p.paymentId,
    amount:           p.amount,
    paymentMethod:    p.paymentMethod,
    paidAt:           paidAt.toISOString(),
    receiptAvailable: !!p.receiptS3Key,
  };
}

type LabPaymentLink = { requestId: string; chargeId?: string | null };

// A request created from a Billing LAB_TEST charge is paid through that
// charge's Payment (referenceType CHARGE); every other request through a Lab
// collect (referenceType PATHOLOGY_/RADIOLOGY_REQUEST). Exactly one source
// applies per request, so a request can never count two payments.
async function findCompletedPayment(tenantId: string, kind: LabKind, doc: LabPaymentLink): Promise<IPayment | null> {
  return doc.chargeId
    ? paymentRepository.findCompletedByReference(tenantId, PaymentReferenceType.CHARGE, doc.chargeId)
    : paymentRepository.findCompletedByReference(tenantId, labReferenceType(kind), doc.requestId);
}

async function getPaymentSummary(tenantId: string, kind: LabKind, doc: LabPaymentLink): Promise<LabPaymentSummary | null> {
  const p = await findCompletedPayment(tenantId, kind, doc);
  return p ? toPaymentSummary(p) : null;
}

// One query per payment source per list page, keyed by requestId.
async function getPaymentSummaryMap(
  tenantId: string, kind: LabKind, docs: LabPaymentLink[],
): Promise<Map<string, LabPaymentSummary>> {
  const charged = docs.filter((d) => !!d.chargeId);
  const [labRows, chargeRows] = await Promise.all([
    paymentRepository.findCompletedByReferences(
      tenantId, labReferenceType(kind), docs.filter((d) => !d.chargeId).map((d) => d.requestId),
    ),
    charged.length > 0
      ? paymentRepository.findCompletedByReferences(
        tenantId, PaymentReferenceType.CHARGE, charged.map((d) => d.chargeId as string),
      )
      : Promise.resolve([] as IPayment[]),
  ]);
  const map = new Map(labRows.map((p) => [p.referenceId as string, toPaymentSummary(p)]));
  const byCharge = new Map(chargeRows.map((p) => [p.referenceId as string, p]));
  for (const d of charged) {
    const p = byCharge.get(d.chargeId as string);
    if (p) map.set(d.requestId, toPaymentSummary(p));
  }
  return map;
}

// Lab-specific A5 receipt — shared by the Lab collect endpoint and the Payment
// of a Billing-created request (charges.service.ts). A ₹0 (free) test prints
// "Free" as its payment method.
async function renderLabReceipt(input: {
  kind:          LabKind;
  labRequest:    IPathologyRequest | IRadiologyRequest;
  patient:       IPatient;
  tenantId:      string;
  paymentId:     string;
  paymentDate:   Date;
  amount:        number;
  paymentMethod: string;
  transactionId: string | null;
  collectedBy:   string;
}): Promise<Buffer> {
  const { kind, labRequest, patient, tenantId } = input;
  const testName = kind === 'pathology'
    ? (labRequest as IPathologyRequest).testType
    : (labRequest as IRadiologyRequest).imagingType;
  const [tenant, collector, referredByName] = await Promise.all([
    tenantRepository.findById(tenantId),
    userRepository.findById(tenantId, input.collectedBy),
    getReferredByName(tenantId, labRequest.referredBy),
  ]);
  return pdfService.generateLabReceipt({
    receiptNumber:              input.paymentId,
    paymentDate:                input.paymentDate,
    ...resolveReceiptHospitalDetails(tenant),
    patientName:                patient.fullName,
    patientId:                  patient.patientId,
    patientAge:                 resolvePatientAge(patient),
    patientGender:              patient.gender ?? null,
    patientMobile:              patient.mobileNumber ?? null,
    labCategory:                kind === 'pathology' ? 'PATHOLOGY' : 'RADIOLOGY',
    labRequestId:               labRequest.requestId,
    testName,
    referredBy:                 referredByName,
    createdBy:                  collector?.name ?? collector?.email ?? 'Staff',
    amountInr:                  input.amount,
    paymentMethod:              input.amount === 0 ? 'FREE' : input.paymentMethod,
    transactionId:              input.transactionId,
  });
}

async function toPathologyResponse(
  doc: IPathologyRequest,
  fullName?: string,
  payment?: LabPaymentSummary | null,
): Promise<PathologyRequestResponse> {
  const [patientName, requesterName, referredByName, reportUrl, paymentSummary] = await Promise.all([
    fullName !== undefined ? Promise.resolve(fullName) : getPatientFullName(doc.tenantId, doc.patientId),
    getRequesterName(doc.tenantId, doc.requestedBy),
    getReferredByName(doc.tenantId, doc.referredBy),
    resolveReportUrl(doc.reportS3Key),
    payment !== undefined ? Promise.resolve(payment) : getPaymentSummary(doc.tenantId, 'pathology', doc),
  ]);
  return {
    requestId:        doc.requestId,
    patientId:        doc.patientId,
    fullName:         patientName,
    tenantId:         doc.tenantId,
    requestedBy:      doc.requestedBy,
    requestedByName:  requesterName,
    testType:         doc.testType,
    referredBy:       doc.referredBy,
    referredByName,
    status:           doc.status,
    priority:         doc.priority,
    notes:            doc.notes,
    reportUrl,
    requestedAt:      doc.requestedAt.toISOString(),
    updatedAt:        doc.updatedAt.toISOString(),
    payment:          paymentSummary,
    chargeId:         doc.chargeId ?? null,
  };
}

async function toRadiologyResponse(
  doc: IRadiologyRequest,
  fullName?: string,
  payment?: LabPaymentSummary | null,
): Promise<RadiologyRequestResponse> {
  const [patientName, requesterName, referredByName, reportUrl, paymentSummary] = await Promise.all([
    fullName !== undefined ? Promise.resolve(fullName) : getPatientFullName(doc.tenantId, doc.patientId),
    getRequesterName(doc.tenantId, doc.requestedBy),
    getReferredByName(doc.tenantId, doc.referredBy),
    resolveReportUrl(doc.reportS3Key),
    payment !== undefined ? Promise.resolve(payment) : getPaymentSummary(doc.tenantId, 'radiology', doc),
  ]);
  return {
    requestId:        doc.requestId,
    patientId:        doc.patientId,
    fullName:         patientName,
    tenantId:         doc.tenantId,
    requestedBy:      doc.requestedBy,
    requestedByName:  requesterName,
    imagingType:      doc.imagingType,
    referredBy:       doc.referredBy,
    referredByName,
    status:           doc.status,
    priority:         doc.priority,
    notes:            doc.notes,
    reportUrl,
    requestedAt:      doc.requestedAt.toISOString(),
    updatedAt:        doc.updatedAt.toISOString(),
    payment:          paymentSummary,
    chargeId:         doc.chargeId ?? null,
  };
}

// ─── LabService ───────────────────────────────────────────────────────────────

export class LabService {

  // Rejects a referredBy value that isn't 'SELF' and isn't a real Doctor in
  // this tenant — keeps the stored value trustworthy for display/reporting.
  private async assertValidReferredBy(tenantId: string, referredBy: string): Promise<void> {
    if (referredBy === LAB_REFERRED_BY_SELF) return;
    const doctor = await userRepository.findById(tenantId, referredBy);
    if (!doctor || doctor.role !== UserRole.DOCTOR) {
      throw new AppError('Invalid referredBy: doctor not found', 400);
    }
  }

  // ─── Pathology ─────────────────────────────────────────────────────────────

  // `billing` is set only by charges.service.ts when a Billing LAB_TEST charge
  // creates its linked request (pre-generated requestId + the charge's id).
  async createPathologyRequest(
    input:              CreatePathologyRequestInput,
    tenantId:           string,
    userId:             string,
    allowedPatientIds?: string[],
    billing?:           { requestId: string; chargeId: string },
  ): Promise<PathologyRequestResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    if (allowedPatientIds && !allowedPatientIds.includes(input.patientId)) {
      throw new NotFoundError('Patient not found');
    }

    const requester = await userRepository.findById(tenantId, userId);
    await this.assertValidReferredBy(tenantId, input.referredBy);

    const doc = await labRepository.savePathology({
      requestId:    billing?.requestId ?? uuidv4(),
      patientId:    input.patientId,
      tenantId,
      requestedBy:  userId,
      testType:     input.testType,
      referredBy:   input.referredBy,
      departmentId: requester?.departmentIds?.[0] ?? null,
      status:       LabRequestStatus.PENDING,
      notes:        input.notes ?? null,
      reportS3Key:  null,
      chargeId:     billing?.chargeId ?? null,
      requestedAt:  new Date(),
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

    return toPathologyResponse(doc, undefined, null);
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

    await this.assertPaidForUpload(tenantId, 'pathology', request);

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

  async getPathologyRequest(
    requestId:           string,
    tenantId:            string,
    allowedPatientIds?:  string[],
    referredByDoctorId?: string,
  ): Promise<PathologyRequestResponse> {
    const doc = await labRepository.findPathologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Pathology request not found');
    const isReferredDoctor = !!referredByDoctorId && doc.referredBy === referredByDoctorId;
    if (allowedPatientIds && !isReferredDoctor && !allowedPatientIds.includes(doc.patientId)) {
      throw new NotFoundError('Pathology request not found');
    }
    return toPathologyResponse(doc);
  }

  async listPathologyRequests(
    tenantId:           string,
    query:              ListLabRequestsQuery,
    doctorPatientIds?:  string[],
    referredByDoctorId?: string,
  ): Promise<PaginatedResult<PathologyRequestResponse>> {
    const searchPatientIds = query.search
      ? await resolvePatientIdsBySearch(tenantId, query.search)
      : undefined;
    const scopedPatientIds = combinePatientIdFilters(searchPatientIds, doctorPatientIds);
    const referral = referredByDoctorId && doctorPatientIds
      ? { doctorId: referredByDoctorId, patientIds: searchPatientIds }
      : undefined;
    const result = await labRepository.findPathologyByPatient(tenantId, query, scopedPatientIds, referral);
    const patientIds = [...new Set(result.data.map((doc) => doc.patientId))];
    const [nameMap, paymentMap] = await Promise.all([
      patientRepository.findNamesByPatientIds(tenantId, patientIds),
      getPaymentSummaryMap(tenantId, 'pathology', result.data),
    ]);
    const data = await Promise.all(
      result.data.map((doc) => toPathologyResponse(doc, nameMap.get(doc.patientId), paymentMap.get(doc.requestId) ?? null)),
    );
    return { ...result, data };
  }

  // ─── Radiology ─────────────────────────────────────────────────────────────

  // `billing` is set only by charges.service.ts when a Billing LAB_TEST charge
  // creates its linked request (pre-generated requestId + the charge's id).
  async createRadiologyRequest(
    input:              CreateRadiologyRequestInput,
    tenantId:           string,
    userId:             string,
    allowedPatientIds?: string[],
    billing?:           { requestId: string; chargeId: string },
  ): Promise<RadiologyRequestResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    if (allowedPatientIds && !allowedPatientIds.includes(input.patientId)) {
      throw new NotFoundError('Patient not found');
    }

    const requester = await userRepository.findById(tenantId, userId);
    await this.assertValidReferredBy(tenantId, input.referredBy);

    const doc = await labRepository.saveRadiology({
      requestId:    billing?.requestId ?? uuidv4(),
      patientId:    input.patientId,
      tenantId,
      requestedBy:  userId,
      imagingType:  input.imagingType,
      referredBy:   input.referredBy,
      departmentId: requester?.departmentIds?.[0] ?? null,
      status:       LabRequestStatus.PENDING,
      notes:        input.notes ?? null,
      reportS3Key:  null,
      chargeId:     billing?.chargeId ?? null,
      requestedAt:  new Date(),
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

    return toRadiologyResponse(doc, undefined, null);
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

    await this.assertPaidForUpload(tenantId, 'radiology', request);

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

  async getRadiologyRequest(
    requestId:           string,
    tenantId:            string,
    allowedPatientIds?:  string[],
    referredByDoctorId?: string,
  ): Promise<RadiologyRequestResponse> {
    const doc = await labRepository.findRadiologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Radiology request not found');
    const isReferredDoctor = !!referredByDoctorId && doc.referredBy === referredByDoctorId;
    if (allowedPatientIds && !isReferredDoctor && !allowedPatientIds.includes(doc.patientId)) {
      throw new NotFoundError('Radiology request not found');
    }
    return toRadiologyResponse(doc);
  }

  async listRadiologyRequests(
    tenantId:          string,
    query:             ListLabRequestsQuery,
    doctorPatientIds?: string[],
    referredByDoctorId?: string,
  ): Promise<PaginatedResult<RadiologyRequestResponse>> {
    const searchPatientIds = query.search
      ? await resolvePatientIdsBySearch(tenantId, query.search)
      : undefined;
    const scopedPatientIds = combinePatientIdFilters(searchPatientIds, doctorPatientIds);
    const referral = referredByDoctorId && doctorPatientIds
      ? { doctorId: referredByDoctorId, patientIds: searchPatientIds }
      : undefined;
    const result = await labRepository.findRadiologyByPatient(tenantId, query, scopedPatientIds, referral);
    const patientIds = [...new Set(result.data.map((doc) => doc.patientId))];
    const [nameMap, paymentMap] = await Promise.all([
      patientRepository.findNamesByPatientIds(tenantId, patientIds),
      getPaymentSummaryMap(tenantId, 'radiology', result.data),
    ]);
    const data = await Promise.all(
      result.data.map((doc) => toRadiologyResponse(doc, nameMap.get(doc.patientId), paymentMap.get(doc.requestId) ?? null)),
    );
    return { ...result, data };
  }

  // ─── Edit & Delete — Pathology ────────────────────────────────────────────

  async editPathologyRequest(
    requestId:          string,
    tenantId:           string,
    userId:             string,
    input:              EditPathologyRequestInput,
    allowedPatientIds?: string[],
    userRole?:          UserRole,
  ): Promise<PathologyRequestResponse> {
    const doc = await labRepository.findPathologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Pathology request not found');
    if (allowedPatientIds && !allowedPatientIds.includes(doc.patientId)) {
      throw new NotFoundError('Pathology request not found');
    }
    if (doc.status === LabRequestStatus.COMPLETED) {
      throw new AppError('Cannot edit a completed pathology request', 409);
    }
    if (
      userRole !== undefined &&
      input.status !== undefined &&
      input.status !== doc.status &&
      userRole !== UserRole.HOSPITAL_ADMIN &&
      userRole !== UserRole.PATHOLOGIST
    ) {
      throw new ForbiddenError('Only Hospital Admin or Pathologist can change the status of a pathology request');
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

    const updated = await labRepository.updatePathology(requestId, tenantId, updatePayload, allowedPatientIds);
    if (!updated) throw new NotFoundError('Pathology request not found');

    try {
      await auditService.log({
        entityType:    AuditEntityType.PATHOLOGY_REQUEST,
        entityId:      requestId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: redactNotes(previousValue),
        newValue:      redactNotes(updatePayload as Record<string, unknown>),
      });
    } catch { /* swallow */ }

    return toPathologyResponse(updated);
  }

  async deletePathologyRequest(
    requestId:          string,
    tenantId:           string,
    userId:             string,
    userRole:           UserRole,
    allowedPatientIds?: string[],
  ): Promise<void> {
    const doc = await labRepository.findPathologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Pathology request not found');
    if (allowedPatientIds && !allowedPatientIds.includes(doc.patientId)) {
      throw new NotFoundError('Pathology request not found');
    }

    await this.assertNotPaid(tenantId, 'pathology', doc);

    if (doc.status === LabRequestStatus.COMPLETED) {
      if (userRole !== UserRole.HOSPITAL_ADMIN && userRole !== UserRole.MANAGER) {
        throw new ForbiddenError('Only Hospital Admin or Manager can delete a completed pathology request');
      }
    }

    const deleted = await labRepository.softDeletePathology(requestId, tenantId, allowedPatientIds);
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
    requestId:          string,
    tenantId:           string,
    userId:             string,
    input:              EditRadiologyRequestInput,
    allowedPatientIds?: string[],
    userRole?:          UserRole,
  ): Promise<RadiologyRequestResponse> {
    const doc = await labRepository.findRadiologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Radiology request not found');
    if (allowedPatientIds && !allowedPatientIds.includes(doc.patientId)) {
      throw new NotFoundError('Radiology request not found');
    }
    if (doc.status === LabRequestStatus.COMPLETED) {
      throw new AppError('Cannot edit a completed radiology request', 409);
    }
    if (
      userRole !== undefined &&
      input.status !== undefined &&
      input.status !== doc.status &&
      userRole !== UserRole.HOSPITAL_ADMIN &&
      userRole !== UserRole.RADIOLOGIST
    ) {
      throw new ForbiddenError('Only Hospital Admin or Radiologist can change the status of a radiology request');
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

    const updated = await labRepository.updateRadiology(requestId, tenantId, updatePayload, allowedPatientIds);
    if (!updated) throw new NotFoundError('Radiology request not found');

    try {
      await auditService.log({
        entityType:    AuditEntityType.RADIOLOGY_REQUEST,
        entityId:      requestId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: redactNotes(previousValue),
        newValue:      redactNotes(updatePayload as Record<string, unknown>),
      });
    } catch { /* swallow */ }

    return toRadiologyResponse(updated);
  }

  async deleteRadiologyRequest(
    requestId:          string,
    tenantId:           string,
    userId:             string,
    userRole:           UserRole,
    allowedPatientIds?: string[],
  ): Promise<void> {
    const doc = await labRepository.findRadiologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Radiology request not found');
    if (allowedPatientIds && !allowedPatientIds.includes(doc.patientId)) {
      throw new NotFoundError('Radiology request not found');
    }

    await this.assertNotPaid(tenantId, 'radiology', doc);

    if (doc.status === LabRequestStatus.COMPLETED) {
      if (userRole !== UserRole.HOSPITAL_ADMIN && userRole !== UserRole.MANAGER) {
        throw new ForbiddenError('Only Hospital Admin or Manager can delete a completed radiology request');
      }
    }

    const deleted = await labRepository.softDeleteRadiology(requestId, tenantId, allowedPatientIds);
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

  // ─── Payment collection ────────────────────────────────────────────────────

  // A paid lab request is part of the billing record and cannot be deleted.
  // A Billing-created request is owned by its charge: cancelling the charge in
  // Billing removes it, so deleting it here would orphan the charge.
  private async assertNotPaid(tenantId: string, kind: LabKind, doc: LabPaymentLink): Promise<void> {
    const paid = await findCompletedPayment(tenantId, kind, doc);
    if (paid) {
      throw new ConflictError(`Cannot delete a paid ${kind} request.`);
    }
    if (doc.chargeId) {
      throw new ConflictError(
        `This ${kind} request was created from Billing charge ${doc.chargeId}. Cancel the charge in Billing instead.`,
      );
    }
  }

  // A report may only be uploaded once the request's payment has been
  // collected (in Lab, or in Billing for a Billing-created request). Checked
  // before the S3 write so an unpaid upload stores nothing.
  private async assertPaidForUpload(tenantId: string, kind: LabKind, doc: LabPaymentLink): Promise<void> {
    const paid = await findCompletedPayment(tenantId, kind, doc);
    if (!paid) {
      throw new ConflictError('Payment must be collected before the report can be uploaded.');
    }
  }

  // Records the lab charge as a COMPLETED manual payment linked to the
  // request (referenceType/referenceId) and its patient, with a Lab-specific
  // A5 receipt. Patient, description and reference all come from the stored
  // request — never from the client. Duplicate/concurrent collects are
  // rejected with 409 by PaymentService (pre-check + partial unique index).
  async collectPayment(
    kind:      LabKind,
    requestId: string,
    tenantId:  string,
    userId:    string,
    input:     CollectLabPaymentInput,
  ): Promise<PaymentResponse> {
    const labRequest = kind === 'pathology'
      ? await labRepository.findPathologyById(requestId, tenantId)
      : await labRepository.findRadiologyById(requestId, tenantId);
    if (!labRequest) {
      throw new NotFoundError(`${kind === 'pathology' ? 'Pathology' : 'Radiology'} request not found`);
    }

    // A Billing-created request's payment belongs to its charge — collecting
    // here too would charge the patient twice.
    if (labRequest.chargeId) {
      const paid = await findCompletedPayment(tenantId, kind, labRequest);
      throw new ConflictError(paid
        ? 'Payment has already been collected for this lab request.'
        : `This test is billed under Billing charge ${labRequest.chargeId}. Collect the payment from Billing.`);
    }

    const patient = await patientRepository.findByPatientId(tenantId, labRequest.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const testName = kind === 'pathology'
      ? (labRequest as IPathologyRequest).testType
      : (labRequest as IRadiologyRequest).imagingType;

    const transactionId = input.transactionId || undefined;

    return paymentService.createManualPayment(
      {
        patientId:     labRequest.patientId,
        amount:        input.amount,
        paymentMethod: input.paymentMethod,
        description:   `${kind === 'pathology' ? 'Pathology' : 'Radiology'} – ${testName}`,
        referenceType: labReferenceType(kind),
        referenceId:   requestId,
        transactionId,
      },
      tenantId,
      userId,
      {
        buildReceipt: ({ paymentId, paymentDate }) => renderLabReceipt({
          kind,
          labRequest,
          patient,
          tenantId,
          paymentId,
          paymentDate,
          amount:        input.amount,
          paymentMethod: input.paymentMethod,
          transactionId: transactionId ?? null,
          collectedBy:   userId,
        }),
      },
    );
  }

  // Builds the Lab receipt for the Payment of a Billing-created request (the
  // charge's Payment), so Billing and Lab show the same Lab-style receipt.
  async buildChargeLabReceipt(
    kind:      LabKind,
    requestId: string,
    tenantId:  string,
    ctx:       { paymentId: string; paymentDate: Date; amount: number; paymentMethod: string; collectedBy: string },
  ): Promise<Buffer> {
    const labRequest = kind === 'pathology'
      ? await labRepository.findPathologyById(requestId, tenantId)
      : await labRepository.findRadiologyById(requestId, tenantId);
    if (!labRequest) throw new NotFoundError('Lab request not found');
    const patient = await patientRepository.findByPatientId(tenantId, labRequest.patientId);
    if (!patient) throw new NotFoundError('Patient not found');
    return renderLabReceipt({ kind, labRequest, patient, tenantId, ...ctx, transactionId: null });
  }

  // ─── Test types ────────────────────────────────────────────────────────────

  async listTestTypes(tenantId: string): Promise<LabTestTypeResponse[]> {
    const rows = await labRepository.listDistinctTestTypes(tenantId);
    return rows
      .map((r) => ({ id: `${r.category}:${r.name}`, name: r.name, category: r.category }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.category.localeCompare(b.category));
  }
}

export const labService = new LabService();
