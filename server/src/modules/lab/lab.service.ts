import { v4 as uuidv4 } from 'uuid';
import { labRepository } from './lab.repository';
import { IPathologyRequest, IPathologyTestReport, IRadiologyRequest } from './lab.model';
import {
  LabRequestStatus,
  CreatePathologyRequestInput,
  CreateRadiologyRequestInput,
  EditPathologyRequestInput,
  EditRadiologyRequestInput,
  ListLabRequestsQuery,
  PathologyRequestResponse,
  RadiologyRequestResponse,
  RADIOLOGY_REPORT_MAX_BYTES,
  LabTestTypeResponse,
  LAB_REFERRED_BY_SELF,
  CollectLabPaymentInput,
  LabPaymentSummary,
  LabEncounterSummary,
  SubmitPathologyTestReportInput,
  PathologyResultValue,
  PathologyTestReportResponse,
} from './lab.types';
import {
  findReportTemplate,
  splitPathologyTests,
  resolveReferenceText,
  computeFlag,
} from './pathology-report-templates';
import { buildPathologyReportPdf } from './pathology-report.pdf';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { fetchImageBuffer } from '../../shared/services/report-letterhead.pdf';
import { patientRepository }   from '../patient/patient.repository';
import { userRepository }      from '../user/user.repository';
import { notificationService } from '../notification/notification.service';
import { s3Service }           from '../../shared/services/s3.service';
import { auditService }        from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import { AppError, NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../../shared/middleware/error-handler';
import { PatientModel } from '../patient/patient.model';
import { tenantRepository }  from '../tenant/tenant.repository';
import { paymentRepository } from '../payment/payment.repository';
import { paymentService }    from '../payment/payment.service';
import { IPayment }          from '../payment/payment.model';
import { IPatient }          from '../patient/patient.model';
import { PaymentReferenceType, PaymentResponse } from '../payment/payment.types';
import { pdfService }        from '../../shared/services/pdf.service';
import { resolveReceiptHospitalDetails, resolvePatientAge, formatHospitalAddress } from '../../shared/utils/receipt-details';
import { opdRepository }        from '../opd/opd.repository';
import { ipdRepository }        from '../ipd/ipd.repository';
import { departmentRepository } from '../department/department.repository';
import { IOPDVisit }            from '../opd/opd.model';
import { IIPDAdmission }        from '../ipd/ipd.model';
import { istMidnightFor }       from '../attendance/attendance.timezone';

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

// ─── Linked OPD/IPD encounter ─────────────────────────────────────────────────

interface LabEncounterLink {
  opdVisitId:     string | null;
  ipdAdmissionId: string | null;
}

type LabEncounterRecord =
  | { type: 'IPD'; admission: IIPDAdmission }
  | { type: 'OPD'; visit: IOPDVisit };

// The encounter the patient was in at `at`. An admission in effect wins (the
// patient is in IPD); otherwise the patient's non-cancelled OPD visit that day.
// Several same-day visits are narrowed to the one naming the referring doctor;
// if that still leaves more than one, nothing is linked rather than guessing.
async function findEncounterAt(
  tenantId:   string,
  patientId:  string,
  at:         Date,
  referredBy: string,
): Promise<LabEncounterRecord | null> {
  const admission = await ipdRepository.findAdmissionCoveringDate(tenantId, patientId, at);
  if (admission) return { type: 'IPD', admission };

  const visits = await opdRepository.findPatientVisitsOnDayAt(tenantId, patientId, at);
  if (visits.length === 1) return { type: 'OPD', visit: visits[0] };
  const referred = visits.filter((v) => (v.doctorIds ?? []).includes(referredBy));
  return referred.length === 1 ? { type: 'OPD', visit: referred[0] } : null;
}

// Stored on the request at creation so the View always shows the encounter the
// request was actually raised during, not whatever the patient is in later.
async function resolveLabEncounterLink(
  tenantId:   string,
  patientId:  string,
  at:         Date,
  referredBy: string,
): Promise<LabEncounterLink> {
  const found = await findEncounterAt(tenantId, patientId, at, referredBy);
  return {
    opdVisitId:     found?.type === 'OPD' ? found.visit.visitId : null,
    ipdAdmissionId: found?.type === 'IPD' ? found.admission.admissionId : null,
  };
}

type LabEncounterSource = Pick<
  IPathologyRequest,
  'tenantId' | 'patientId' | 'referredBy' | 'requestedAt' | 'opdVisitId' | 'ipdAdmissionId'
>;

async function resolveEncounterRecord(doc: LabEncounterSource): Promise<LabEncounterRecord | null> {
  const { tenantId } = doc;
  if (doc.opdVisitId === undefined && doc.ipdAdmissionId === undefined) {
    // Legacy request (created before the link was stored) — resolve against
    // the request's own timestamp, never the patient's latest encounter.
    return findEncounterAt(tenantId, doc.patientId, doc.requestedAt, doc.referredBy);
  }
  if (doc.ipdAdmissionId) {
    const admission = await ipdRepository.findById(doc.ipdAdmissionId, tenantId);
    return admission && admission.patientId === doc.patientId ? { type: 'IPD', admission } : null;
  }
  if (doc.opdVisitId) {
    const visit = await opdRepository.findByVisitId(tenantId, doc.opdVisitId);
    return visit && visit.patientId === doc.patientId ? { type: 'OPD', visit } : null;
  }
  return null;
}

function encounterDoctorIds(record: LabEncounterRecord): string[] {
  return (record.type === 'IPD' ? record.admission.assignedDoctorIds : record.visit.doctorIds) ?? [];
}

async function getEncounterSummary(doc: LabEncounterSource): Promise<LabEncounterSummary | null> {
  const { tenantId } = doc;
  const record = await resolveEncounterRecord(doc);
  if (!record) return null;

  const departmentId = record.type === 'IPD' ? record.admission.departmentId : record.visit.departmentId;
  const doctorIds    = encounterDoctorIds(record);
  const [department, names] = await Promise.all([
    departmentId ? departmentRepository.findById(tenantId, departmentId) : Promise.resolve(null),
    userRepository.findNamesByIds(tenantId, doctorIds),
  ]);
  const common = {
    departmentName: department?.name ?? null,
    doctorNames:    doctorIds.map((id) => names.get(id)).filter((n): n is string => !!n),
  };

  if (record.type === 'IPD') {
    return {
      type:        'IPD',
      encounterId: record.admission.admissionId,
      date:        record.admission.admissionDate.toISOString(),
      wardName:    record.admission.wardName ?? null,
      bedNumber:   record.admission.bedNumber ?? null,
      ...common,
    };
  }
  return {
    type:        'OPD',
    encounterId: record.visit.visitId,
    date:        record.visit.visitDate.toISOString(),
    wardName:    null,
    bedNumber:   null,
    ...common,
  };
}

// ─── Linked-encounter list filters ────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// [00:00 IST, next 00:00 IST) of a YYYY-MM-DD hospital-local date.
function istDayRange(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split('-').map(Number);
  const start = istMidnightFor(y, m, d);
  return { start, end: new Date(start.getTime() + MS_PER_DAY) };
}

// Mirrors ipdRepository.findAdmissionCoveringDate's in-effect test.
function admissionCovers(
  a:  Pick<IIPDAdmission, 'admissionDate' | 'dischargeDate' | 'status'>,
  at: Date,
): boolean {
  if (a.admissionDate > at) return false;
  return a.status === 'ADMITTED' || (!!a.dischargeDate && a.dischargeDate > at);
}

// Turns the Date / Visit Date / Admission Date / Ward / Bed filters into
// conditions on the request's OWN linked encounter (opdVisitId /
// ipdAdmissionId), never the patient's latest one. Legacy rows with no stored
// link are resolved from their requestedAt exactly as getEncounterSummary
// does, so the list filter and the View always agree. `date` matches the
// encounter's own date — the OPD visit date or the IPD admission date.
// Returns undefined when no encounter filter is set.
async function resolveEncounterConditions(
  type:     'pathology' | 'radiology',
  tenantId: string,
  query:    ListLabRequestsQuery,
): Promise<Record<string, unknown>[] | undefined> {
  // Requests linked to an OPD visit on the given IST day.
  async function opdOnDay(day: string): Promise<Record<string, unknown>> {
    const { start, end } = istDayRange(day);
    // A legacy request resolves to an OPD visit on its own requestedAt day, so
    // only that day's unlinked requests can match.
    const [visitIds, legacy] = await Promise.all([
      opdRepository.findVisitIdsInRange(tenantId, start, end),
      labRepository.findUnlinked(type, tenantId, { requestedAt: { $gte: start, $lt: end } }),
    ]);
    const resolved = await Promise.all(legacy.map(async (doc) => {
      const found = await findEncounterAt(tenantId, doc.patientId, doc.requestedAt, doc.referredBy);
      return found?.type === 'OPD' ? doc.requestId : null;
    }));
    return { $or: [
      { opdVisitId: { $in: visitIds } },
      { requestId:  { $in: resolved.filter((id): id is string => !!id) } },
    ] };
  }

  // Requests linked to an IPD admission matching the given criteria.
  async function ipdMatching(
    admissionDay: string | undefined, wardName: string | undefined, bedNumber: string | undefined,
  ): Promise<Record<string, unknown>> {
    const admissions = await ipdRepository.findForLabFilter(tenantId, {
      admissionDateRange: admissionDay ? istDayRange(admissionDay) : undefined,
      wardName,
      bedNumber,
    });
    const byPatient = new Map<string, typeof admissions>();
    for (const a of admissions) byPatient.set(a.patientId, [...(byPatient.get(a.patientId) ?? []), a]);
    // A legacy request resolves to the admission in effect at its requestedAt.
    const legacy = byPatient.size
      ? await labRepository.findUnlinked(type, tenantId, { patientId: { $in: [...byPatient.keys()] } })
      : [];
    const legacyIds = legacy
      .filter((doc) => byPatient.get(doc.patientId)!.some((a) => admissionCovers(a, doc.requestedAt)))
      .map((doc) => doc.requestId);
    return { $or: [
      { ipdAdmissionId: { $in: admissions.map((a) => a.admissionId) } },
      { requestId:      { $in: legacyIds } },
    ] };
  }

  const conds: Record<string, unknown>[] = [];
  const wardName  = query.wardName  || undefined;
  const bedNumber = query.bedNumber || undefined;

  if (query.visitDate) conds.push(await opdOnDay(query.visitDate));

  if (query.admissionDate || wardName || bedNumber) {
    conds.push(await ipdMatching(query.admissionDate, wardName, bedNumber));
  }

  if (query.date) {
    // Ward / Bed only exist on IPD admissions — with either set, the date can
    // only match an admission in that ward/bed.
    const [opd, ipd] = await Promise.all([
      wardName || bedNumber ? Promise.resolve(null) : opdOnDay(query.date),
      ipdMatching(query.date, wardName, bedNumber),
    ]);
    conds.push(opd ? { $or: [opd, ipd] } : ipd);
  }

  return conds.length ? conds : undefined;
}

// ─── Structured Pathology test reports ────────────────────────────────────────

// Plaintext JSON held (encrypted at rest) in IPathologyTestReport.resultData.
interface StoredPathologyResult {
  values:  PathologyResultValue[];
  remarks: string | null;
}

function parseResultData(raw: string): StoredPathologyResult {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPathologyResult>;
    return {
      values:  Array.isArray(parsed.values) ? parsed.values : [],
      remarks: typeof parsed.remarks === 'string' ? parsed.remarks : null,
    };
  } catch {
    return { values: [], remarks: null };
  }
}

const NUMERIC_RESULT = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

// Validates the submitted values against the test's template and returns only
// the filled ones, in template order, each with the unit and this patient's
// reference range snapshotted and its HIGH/LOW/ABNORMAL flag computed.
function buildResultValues(
  testName: string,
  input:    SubmitPathologyTestReportInput['values'],
  gender:   string | null | undefined,
): PathologyResultValue[] {
  const template = findReportTemplate(testName);
  const known    = new Set(template.parameters.map((p) => p.key));
  const unknown  = Object.keys(input).filter((k) => !known.has(k));
  if (unknown.length) throw new ValidationError(`Unknown result field(s) for ${testName}: ${unknown.join(', ')}`);

  const errors: string[] = [];
  const values: PathologyResultValue[] = [];
  for (const param of template.parameters) {
    const value = input[param.key]?.trim();
    if (!value) continue;   // every field is optional
    if (param.inputType === 'number' && !NUMERIC_RESULT.test(value)) {
      errors.push(`${param.name} must be a number.`);
      continue;
    }
    if (param.inputType === 'select' && !(param.options ?? []).includes(value)) {
      errors.push(`${param.name} must be one of: ${(param.options ?? []).join(', ')}.`);
      continue;
    }
    values.push({
      key:            param.key,
      name:           param.name,
      section:        param.section ?? null,
      value,
      unit:           param.unit,
      referenceRange: resolveReferenceText(param, gender),
      flag:           computeFlag(param, value, gender),
    });
  }
  if (errors.length) throw new ValidationError(errors.join(' '));
  return values;
}

// One entry per test in testType (in order): its entry form (template fields
// with this patient's reference ranges) and its submitted result, if any.
// A result stored under a test name no longer in testType is not returned.
async function buildTestReports(
  doc:    IPathologyRequest,
  gender: string | null | undefined,
): Promise<PathologyTestReportResponse[]> {
  const stored = new Map((doc.testReports ?? []).map((r) => [r.testName, r]));
  const names  = stored.size
    ? await userRepository.findNamesByIds(doc.tenantId, [...new Set([...stored.values()].map((r) => r.submittedBy))])
    : new Map<string, string>();
  return splitPathologyTests(doc.testType).map((testName, testIndex) => {
    const template = findReportTemplate(testName);
    const report   = stored.get(testName);
    const data     = report ? parseResultData(report.resultData) : null;
    return {
      testIndex,
      testName,
      templateKey: template.key,
      fields: template.parameters.map((p) => ({
        key:            p.key,
        name:           p.name,
        unit:           p.unit,
        inputType:      p.inputType,
        section:        p.section ?? null,
        options:        p.options ?? null,
        referenceRange: resolveReferenceText(p, gender),
      })),
      result: report && data ? {
        values:          data.values,
        remarks:         data.remarks,
        submittedBy:     report.submittedBy,
        submittedByName: names.get(report.submittedBy) ?? 'Lab Staff',
        submittedAt:     report.submittedAt.toISOString(),
      } : null,
    };
  });
}

function reportFileSlug(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'test';
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

    const requestedAt = new Date();
    const encounter   = await resolveLabEncounterLink(tenantId, input.patientId, requestedAt, input.referredBy);

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
      opdVisitId:     encounter.opdVisitId,
      ipdAdmissionId: encounter.ipdAdmissionId,
      requestedAt,
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

  // Read access to one pathology request — a Doctor only for their assigned
  // patients or requests they were "Referred By" on (same 404 either way).
  private async findReadablePathology(
    requestId:           string,
    tenantId:            string,
    allowedPatientIds?:  string[],
    referredByDoctorId?: string,
  ): Promise<IPathologyRequest> {
    const doc = await labRepository.findPathologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Pathology request not found');
    const isReferredDoctor = !!referredByDoctorId && doc.referredBy === referredByDoctorId;
    if (allowedPatientIds && !isReferredDoctor && !allowedPatientIds.includes(doc.patientId)) {
      throw new NotFoundError('Pathology request not found');
    }
    return doc;
  }

  // Single-request view: the list shape plus the linked encounter and the
  // structured per-test reports.
  private async toPathologyDetail(doc: IPathologyRequest): Promise<PathologyRequestResponse> {
    const patient = await patientRepository.findByPatientId(doc.tenantId, doc.patientId);
    const [response, encounter, testReports] = await Promise.all([
      toPathologyResponse(doc, patient?.fullName),
      getEncounterSummary(doc),
      buildTestReports(doc, patient?.gender),
    ]);
    return { ...response, encounter, testReports };
  }

  async getPathologyRequest(
    requestId:           string,
    tenantId:            string,
    allowedPatientIds?:  string[],
    referredByDoctorId?: string,
  ): Promise<PathologyRequestResponse> {
    const doc = await this.findReadablePathology(requestId, tenantId, allowedPatientIds, referredByDoctorId);
    return this.toPathologyDetail(doc);
  }

  // ─── Structured test reports ──────────────────────────────────────────────

  // Lab staff (route: PATHOLOGIST / HOSPITAL_ADMIN) submit — or later amend —
  // the structured result of one test of the request. Each test is stored and
  // editable independently; the request moves to IN_PROGRESS on its first
  // submitted test and COMPLETED once every test has a submitted report. The
  // requester, the referring doctor and the encounter's assigned doctors are
  // notified that the report is available.
  async submitPathologyTestReport(
    requestId: string,
    testIndex: number,
    tenantId:  string,
    userId:    string,
    input:     SubmitPathologyTestReportInput,
  ): Promise<PathologyRequestResponse> {
    const doc = await labRepository.findPathologyById(requestId, tenantId);
    if (!doc) throw new NotFoundError('Pathology request not found');

    const testName = splitPathologyTests(doc.testType)[testIndex];
    if (testName === undefined) throw new NotFoundError('Test not found on this pathology request');
    if (testName !== input.testName) {
      throw new ConflictError('The tests on this request have changed. Reload the request and try again.');
    }

    await this.assertPaid(tenantId, 'pathology', doc, 'Payment must be collected before the report can be submitted.');

    const patient = await patientRepository.findByPatientId(tenantId, doc.patientId);
    const values  = buildResultValues(testName, input.values, patient?.gender);
    const remarks = input.remarks?.trim() || null;
    if (values.length === 0 && !remarks) {
      throw new ValidationError('Enter at least one result before submitting the report.');
    }

    const isAmendment = (doc.testReports ?? []).some((r) => r.testName === testName);
    const saved = await labRepository.upsertPathologyTestReport(requestId, tenantId, {
      testName,
      templateKey: findReportTemplate(testName).key,
      resultData:  JSON.stringify({ values, remarks }),
      submittedBy: userId,
      submittedAt: new Date(),
    });
    if (!saved) throw new NotFoundError('Pathology request not found');

    // Status follows the tests' report coverage; a request already COMPLETED
    // (e.g. by a file upload) is never moved back.
    const submitted  = new Set((saved.testReports ?? []).map((r) => r.testName));
    const allDone    = splitPathologyTests(saved.testType).every((t) => submitted.has(t));
    const nextStatus = allDone
      ? LabRequestStatus.COMPLETED
      : saved.status === LabRequestStatus.PENDING ? LabRequestStatus.IN_PROGRESS : saved.status;
    const updated = nextStatus !== saved.status
      ? (await labRepository.updatePathology(requestId, tenantId, { status: nextStatus })) ?? saved
      : saved;

    try {
      const record     = await resolveEncounterRecord(updated);
      const recipients = new Set([
        updated.requestedBy,
        ...(updated.referredBy !== LAB_REFERRED_BY_SELF ? [updated.referredBy] : []),
        ...(record ? encounterDoctorIds(record) : []),
      ]);
      recipients.delete(userId);
      await Promise.all([...recipients].map((recipientId) => notificationService.sendNotification(
        recipientId, tenantId,
        isAmendment ? 'Pathology Report Updated' : 'Pathology Report Ready',
        `The ${testName} report for patient ${doc.patientId} is ${isAmendment ? 'updated' : 'now available'}.`,
        'PATHOLOGY_REQUEST', requestId,
      ).catch(() => undefined)));
    } catch { /* swallow */ }

    // Result values are clinical data (encrypted at rest) — the audit entry
    // records which test's report was submitted, never its values.
    try {
      await auditService.log({
        entityType:    AuditEntityType.PATHOLOGY_REQUEST,
        entityId:      requestId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: { status: doc.status },
        newValue: {
          status:     updated.status,
          testReport: { testName, action: isAmendment ? 'AMENDED' : 'SUBMITTED', results: REDACTED_AUDIT_MARKER },
        },
      });
    } catch { /* swallow */ }

    return this.toPathologyDetail(updated);
  }

  // One test's submitted report as its own PDF — never several tests combined.
  // Every copy carries the Doctor Signature block; `letterhead` (the Download
  // button) also adds the hospital letterhead, which the Print copy omits.
  async getPathologyTestReportPdf(
    requestId:           string,
    testIndex:           number,
    tenantId:            string,
    allowedPatientIds?:  string[],
    referredByDoctorId?: string,
    letterhead = false,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const doc = await this.findReadablePathology(requestId, tenantId, allowedPatientIds, referredByDoctorId);
    const testName = splitPathologyTests(doc.testType)[testIndex];
    if (testName === undefined) throw new NotFoundError('Test not found on this pathology request');
    const report = (doc.testReports ?? []).find((r) => r.testName === testName);
    if (!report) throw new NotFoundError('The report for this test has not been submitted yet.');

    const context = await this.loadPathologyReportContext(doc, tenantId, letterhead);
    const buffer  = await this.renderPathologyTestReport(context, testName, report);
    return { buffer, fileName: `pathology-report-${reportFileSlug(testName)}-${doc.patientId}.pdf` };
  }

  // Bulk Download / Print: every submitted test report of the request, in test
  // order, as one PDF. Each report is rendered exactly as its own per-test PDF
  // (same content, formatting, page numbering, Doctor Signature and — with
  // `letterhead` — the letterhead) and the reports are appended back to back.
  // Tests whose report hasn't been submitted are skipped; none submitted → 404.
  async getAllPathologyTestReportsPdf(
    requestId:           string,
    tenantId:            string,
    allowedPatientIds?:  string[],
    referredByDoctorId?: string,
    letterhead = false,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const doc = await this.findReadablePathology(requestId, tenantId, allowedPatientIds, referredByDoctorId);
    const reports = splitPathologyTests(doc.testType).flatMap((testName) => {
      const report = (doc.testReports ?? []).find((r) => r.testName === testName);
      return report ? [{ testName, report }] : [];
    });
    if (reports.length === 0) throw new NotFoundError('No test report has been submitted for this request yet.');

    const context = await this.loadPathologyReportContext(doc, tenantId, letterhead);
    const merged  = await PdfLibDocument.create();
    for (const { testName, report } of reports) {
      const part  = await PdfLibDocument.load(await this.renderPathologyTestReport(context, testName, report));
      const pages = await merged.copyPages(part, part.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }
    merged.setTitle(`Pathology Reports - ${context.patient.fullName} (${context.patient.patientId})`);
    merged.setAuthor(context.hospital.name);
    merged.setSubject('Pathology Report');
    return {
      buffer:   Buffer.from(await merged.save()),
      fileName: `pathology-reports-${doc.patientId}-${reportFileSlug(doc.requestId)}.pdf`,
    };
  }

  // Everything a report PDF needs besides the test itself — shared by all
  // tests of one request, so the bulk PDF looks each value up only once.
  private async loadPathologyReportContext(doc: IPathologyRequest, tenantId: string, letterhead: boolean) {
    const [patient, tenant, encounter, referredByName] = await Promise.all([
      patientRepository.findByPatientId(tenantId, doc.patientId),
      tenantRepository.findById(tenantId),
      getEncounterSummary(doc),
      getReferredByName(tenantId, doc.referredBy),
    ]);
    if (!patient) throw new NotFoundError('Patient not found');
    const logoUrl = tenant?.branding?.logoUrl
      ? await s3Service.getPresignedUrl(tenant.branding.logoUrl, REPORT_URL_EXPIRY_SECONDS).catch(() => null)
      : null;
    const logo = letterhead && logoUrl ? await fetchImageBuffer(logoUrl) : null;

    return {
      tenantId,
      hospital: {
        name:               tenant?.branding?.displayName || tenant?.name || 'Hospital',
        logoUrl,
        primaryColor:       tenant?.branding?.primaryColor || '',
        address:            formatHospitalAddress(tenant),
        email:              tenant?.adminEmail ?? null,
        registrationNumber: tenant?.onboardingDocuments?.gstNumber ?? null,
      },
      patient: {
        fullName:     patient.fullName,
        patientId:    patient.patientId,
        age:          resolvePatientAge(patient),
        gender:       patient.gender ?? null,
        mobileNumber: patient.mobileNumber ?? null,
        address:      patient.address ?? null,
      },
      request: {
        requestId:   doc.requestId,
        requestedAt: doc.requestedAt.toISOString(),
        referredByName,
      },
      encounter,
      letterhead: letterhead ? { logo } : null,
    };
  }

  private async renderPathologyTestReport(
    context:  Awaited<ReturnType<LabService['loadPathologyReportContext']>>,
    testName: string,
    report:   IPathologyTestReport,
  ): Promise<Buffer> {
    const result   = parseResultData(report.resultData);
    const reporter = await userRepository.findById(context.tenantId, report.submittedBy);
    return buildPathologyReportPdf({
      hospital:       context.hospital,
      patient:        context.patient,
      request:        context.request,
      encounter:      context.encounter,
      test:           { testName, values: result.values, remarks: result.remarks },
      reportedByName: reporter?.name ?? reporter?.email ?? 'Lab Staff',
      reportedAt:     report.submittedAt.toISOString(),
      generatedAt:    new Date().toISOString(),
      ...(context.letterhead ? { letterhead: context.letterhead } : {}),
    });
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
    const encounterConds = await resolveEncounterConditions('pathology', tenantId, query);
    const result = await labRepository.findPathologyByPatient(tenantId, query, scopedPatientIds, referral, encounterConds);
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

    const requestedAt = new Date();
    const encounter   = await resolveLabEncounterLink(tenantId, input.patientId, requestedAt, input.referredBy);

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
      opdVisitId:     encounter.opdVisitId,
      ipdAdmissionId: encounter.ipdAdmissionId,
      requestedAt,
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
    const [response, encounter] = await Promise.all([toRadiologyResponse(doc), getEncounterSummary(doc)]);
    return { ...response, encounter };
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
    const encounterConds = await resolveEncounterConditions('radiology', tenantId, query);
    const result = await labRepository.findRadiologyByPatient(tenantId, query, scopedPatientIds, referral, encounterConds);
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

    let updated = await labRepository.updatePathology(requestId, tenantId, updatePayload, allowedPatientIds);
    if (!updated) throw new NotFoundError('Pathology request not found');

    // Removing a test that had no report can leave every remaining test
    // reported — recalculate so the request completes immediately.
    const newValue: Record<string, unknown> = { ...updatePayload };
    if ('testType' in input && updated.status === LabRequestStatus.IN_PROGRESS) {
      const submitted = new Set((updated.testReports ?? []).map((r) => r.testName));
      const tests     = splitPathologyTests(updated.testType);
      if (tests.length > 0 && tests.every((t) => submitted.has(t))) {
        updated = (await labRepository.updatePathology(
          requestId, tenantId, { status: LabRequestStatus.COMPLETED }, allowedPatientIds,
        )) ?? updated;
        previousValue.status = doc.status;
        newValue.status      = updated.status;
      }
    }

    try {
      await auditService.log({
        entityType:    AuditEntityType.PATHOLOGY_REQUEST,
        entityId:      requestId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: redactNotes(previousValue),
        newValue:      redactNotes(newValue),
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
    await this.assertPaid(tenantId, kind, doc, 'Payment must be collected before the report can be uploaded.');
  }

  // Same rule for a structured Pathology report submission.
  private async assertPaid(tenantId: string, kind: LabKind, doc: LabPaymentLink, message: string): Promise<void> {
    const paid = await findCompletedPayment(tenantId, kind, doc);
    if (!paid) throw new ConflictError(message);
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
