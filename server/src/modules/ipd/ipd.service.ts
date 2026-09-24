import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ipdRepository } from './ipd.repository';
import { opdRepository } from '../opd/opd.repository';
import { IIPDAdmission } from './ipd.model';
import { IWard }          from './ward.model';
import { IBed }           from './bed.model';
import {
  AdmissionStatus,
  AdmissionResponse,
  WardOccupancySummary,
  CreateAdmissionInput,
  AddProgressNoteInput,
  ListAdmissionsQuery,
  CreateWardRequest,
  AddBedsRequest,
  ProgressNote,
  ProgressNoteResponse,
  DischargeSummaryData,
  DischargeSummaryBilling,
  IPDVitals,
} from './ipd.types';

import { patientRepository }    from '../patient/patient.repository';
import { userRepository }       from '../user/user.repository';
import { departmentRepository } from '../department/department.repository';
import { tenantRepository }     from '../tenant/tenant.repository';
import { labRepository }        from '../lab/lab.repository';
import { paymentRepository }    from '../payment/payment.repository';
import { auditService }         from '../../shared/services/audit.service';
import { s3Service }            from '../../shared/services/s3.service';
import { AuditLogModel }        from '../audit/audit.model';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import {
  AppError,
  ConflictError,
  NotFoundError,
} from '../../shared/middleware/error-handler';
import { PatientModel } from '../patient/patient.model';
import { stripRichTextTags } from '../../shared/utils/validation';
import { ParchaOverlayInput } from '../../shared/services/parcha-template.service';


// Shape a partial (or missing) vitals update/read always merges onto — keeps
// "no vitals recorded yet" and "some vitals cleared" both resolving to the
// same fully-shaped object rather than undefined sub-fields. Mirrors OPD's
// DEFAULT_VITALS (opd.service.ts).
const DEFAULT_VITALS: IPDVitals = {
  weight:          null,
  height:          null,
  bloodPressure:   null,
  sugar:           null,
  bodyTemperature: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// vitals are encrypted at rest (see ipd.model.ts's ENCRYPTED_IPD_FIELDS).
// Audit log entries are stored in plain form and rendered in the Audit UI, so
// the object must never carry its values into one — the trail records only
// *that* vitals changed. Mirrors OPDService's redactClinicalFields; returns
// the input unchanged when it carries no `vitals` key so callers can pass it
// unconditionally.
const REDACTED_MARKER = '[redacted]';

function redactVitals(values: Record<string, unknown>): Record<string, unknown> {
  if (values.vitals === undefined) return values;
  return { ...values, vitals: REDACTED_MARKER };
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

// ─── BedOccupiedError (standalone — NOT inside IPDService) ───────────────────
export class BedOccupiedError extends Error {
  readonly statusCode = 409;
  constructor(
    public readonly bedNumber:          string,
    public readonly currentAdmissionId: string,
  ) {
    super(`Bed ${bedNumber} is already occupied by admission ${currentAdmissionId}`);
    this.name = 'BedOccupiedError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Progress notes store only the creator's userId (field name `doctorId` is
// historical — a NURSE can also author a note). Resolve each unique author to
// their display name in one batch, rather than storing/duplicating it on write.
// Build plain objects field-by-field — `notes` may be Mongoose subdocuments,
// whose own properties aren't enumerable, so a spread ({...n}) silently drops them.
function mapProgressNotes(
  notes:   ProgressNote[],
  nameMap: Map<string, string>,
): ProgressNoteResponse[] {
  return notes.map((n) => ({
    noteId:    n.noteId,
    doctorId:  n.doctorId,
    note:      n.note,
    timestamp: n.timestamp,
    staffName: nameMap.get(n.doctorId) ?? null,
  }));
}

async function resolveProgressNoteStaffNames(
  tenantId: string,
  notes:    ProgressNote[],
): Promise<ProgressNoteResponse[]> {
  if (notes.length === 0) return [];

  const uniqueIds = [...new Set(notes.map((n) => n.doctorId))];
  const nameMap = await userRepository.findNamesByIds(tenantId, uniqueIds);

  return mapProgressNotes(notes, nameMap);
}

function calculateAge(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return Math.max(0, age);
}

// ─── Parcha PDF template overlay ────────────────────────────────────────────
// Mirrors the IPD print page's (client/app/(dashboard)/ipd/[admissionId]/
// print/page.tsx) field selection exactly, so a PDF template shows the same
// information the default/image layouts do — assembled server-side since a
// PDF template is merged with the admission's data on the server (see
// IPDService.getParchaPdfContext) rather than composited client-side.
function toDisplayCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function formatParchaDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatParchaDateTime(date: Date): string {
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function buildIpdParchaOverlay(
  admission:      IIPDAdmission,
  patient:        { fullName: string; patientId: string; dateOfBirth: string; gender: string; mobileNumber: string; address: string; bloodGroup?: string | null },
  departmentName: string | null,
  doctorNames:    string,
  staffNameMap:   Map<string, string>,
): ParchaOverlayInput {
  const fieldRows: ParchaOverlayInput['fieldRows'] = [
    { label: 'Patient Name', value: patient.fullName },
    { label: 'Patient ID',   value: patient.patientId },
    { label: 'Age / Gender', value: `${calculateAge(new Date(patient.dateOfBirth))} years / ${toDisplayCase(patient.gender)}` },
    { label: 'Mobile',       value: patient.mobileNumber },
  ];
  if (patient.address)    fieldRows.push({ label: 'Address',     value: patient.address });
  if (patient.bloodGroup) fieldRows.push({ label: 'Blood Group', value: patient.bloodGroup });
  fieldRows.push({ label: 'Admission ID', value: admission.admissionId });
  fieldRows.push({ label: 'Status',       value: toDisplayCase(admission.status) });
  fieldRows.push({ label: 'Ward / Bed',   value: `${admission.wardName} / Bed ${admission.bedNumber}` });
  if (departmentName) fieldRows.push({ label: 'Department', value: departmentName });
  if (doctorNames)     fieldRows.push({ label: 'Doctor(s)',  value: doctorNames });
  fieldRows.push({ label: 'Admission Date', value: formatParchaDate(admission.admissionDate) });
  if (admission.dischargeDate) fieldRows.push({ label: 'Discharge Date', value: formatParchaDate(admission.dischargeDate) });

  const vitals: ParchaOverlayInput['vitals'] = [
    { label: 'Weight', value: admission.vitals?.weight          != null ? String(admission.vitals.weight)          : '' },
    { label: 'Height', value: admission.vitals?.height          != null ? String(admission.vitals.height)          : '' },
    { label: 'BP',     value: admission.vitals?.bloodPressure   ?? '' },
    { label: 'Sugar',  value: admission.vitals?.sugar           != null ? String(admission.vitals.sugar)           : '' },
    { label: 'Temp',   value: admission.vitals?.bodyTemperature != null ? String(admission.vitals.bodyTemperature) : '' },
  ];

  const sortedNotes = [...admission.progressNotes].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const notesText = sortedNotes.length === 0
    ? 'No progress notes recorded.'
    : sortedNotes.map((n) => {
        const author = staffNameMap.get(n.doctorId) ?? 'Staff';
        return `${formatParchaDateTime(n.timestamp)} — ${author}\n${stripRichTextTags(n.note)}`;
      }).join('\n\n');

  return {
    fieldRows,
    vitals,
    bodySections: [
      { heading: 'Progress Notes', text: notesText, weight: 1 },
    ],
    footerText: `Generated on ${formatParchaDateTime(new Date())}`,
  };
}

// ─── Discharge summary — best-effort "who did this" lookups ─────────────────
// Neither Patient nor IPDAdmission stores who created/discharged them — the
// only place that fact exists is the audit log, which already records
// `userId` for every CREATE/UPDATE. These are best-effort: any failure, an
// expired (365-day TTL) audit trail, or an ambiguous/missing entry all
// resolve to `null`, so the caller can simply omit that line.

async function resolveRegisteredBy(tenantId: string, patientId: string): Promise<string | null> {
  try {
    const entries = await AuditLogModel.find({
      tenantId, entityType: AuditEntityType.PATIENT, entityId: patientId, action: 'CREATE',
    }).sort({ timestamp: 1 }).lean();
    // The genuine registration CREATE never carries `medicalCardGenerated` —
    // that marker is only written by a later first-time medical-card
    // generation for the same patientId (see patient.service.ts). Take the
    // earliest CREATE without it.
    const registrationEntry = entries.find((e) => !(e.newValue && 'medicalCardGenerated' in e.newValue));
    if (!registrationEntry) return null;
    const nameMap = await userRepository.findNamesByIds(tenantId, [registrationEntry.userId]);
    return nameMap.get(registrationEntry.userId) ?? null;
  } catch {
    return null;
  }
}

// Mirrors GET /api/payments' requireRole list exactly — the discharge summary's
// billing section is included only for roles already allowed to view payments.
const PAYMENT_VIEW_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.MANAGER, UserRole.FINANCE_MANAGER, UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST,
]);

// Discharge summaries must include the *entire* matching record set (a
// patient's full OPD/lab/payment history), not just the first page — walks
// every page of an existing paginated repository method and concatenates the
// results, reusing the same page-size contract the method already exposes.
const DISCHARGE_SUMMARY_PAGE_SIZE = 500;

async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<PaginatedResult<T>>,
  limit: number = DISCHARGE_SUMMARY_PAGE_SIZE,
): Promise<T[]> {
  const first = await fetchPage(1, limit);
  const all = [...first.data];
  for (let page = 2; page <= first.totalPages; page++) {
    const next = await fetchPage(page, limit);
    all.push(...next.data);
  }
  return all;
}

async function resolveDischargedBy(tenantId: string, admissionId: string): Promise<string | null> {
  try {
    const entries = await AuditLogModel.find({
      tenantId, entityType: AuditEntityType.IPD_ADMISSION, entityId: admissionId, action: 'UPDATE',
    }).sort({ timestamp: -1 }).lean();
    const dischargeEntry = entries.find((e) => e.newValue?.['status'] === AdmissionStatus.DISCHARGED);
    if (!dischargeEntry) return null;
    const nameMap = await userRepository.findNamesByIds(tenantId, [dischargeEntry.userId]);
    return nameMap.get(dischargeEntry.userId) ?? null;
  } catch {
    return null;
  }
}

// Canonical admission-scope guard — shared by getAdmissionById and
// getDischargeSummaryData so the two endpoints cannot diverge in what a
// nurse/doctor is allowed to reach. `undefined` scope arrays mean "no
// restriction" (role isn't NURSE/DOCTOR); an empty/non-matching array means
// the caller has zero visibility into this admission.
function assertAdmissionInScope(
  admission:         IIPDAdmission,
  nurseWardIds?:     string[],
  doctorPatientIds?: string[],
): void {
  if (nurseWardIds && !nurseWardIds.includes(admission.wardId)) {
    throw new NotFoundError('Admission not found');
  }
  if (doctorPatientIds && !doctorPatientIds.includes(admission.patientId)) {
    throw new NotFoundError('Admission not found');
  }
}

async function toResponse(
  doc:           IIPDAdmission,
  tenantId:      string,
  fullName:      string | null = null,
  staffNameMap?: Map<string, string>,
): Promise<AdmissionResponse> {
  return {
    admissionId:       doc.admissionId,
    patientId:         doc.patientId,
    fullName,
    wardId:            doc.wardId,
    wardName:          doc.wardName,
    bedId:             doc.bedId,
    bedNumber:         doc.bedNumber,
    assignedDoctorIds: doc.assignedDoctorIds ?? [],
    departmentId:      doc.departmentId ?? null,
    status:            doc.status,
    admissionDate:     doc.admissionDate.toISOString(),
    dischargeDate:     doc.dischargeDate ? doc.dischargeDate.toISOString() : null,
    progressNotes:     staffNameMap
      ? mapProgressNotes(doc.progressNotes, staffNameMap)
      : await resolveProgressNoteStaffNames(tenantId, doc.progressNotes),
    // Explicit shape (not a spread of doc.vitals) so a Mongoose subdocument
    // never leaks its own internal keys into the API response, and a legacy
    // admission read via .lean() (missing the field entirely) still answers
    // with nulls rather than undefined — same reasoning as OPDVisit's toResponse.
    vitals: {
      weight:          doc.vitals?.weight          ?? null,
      height:          doc.vitals?.height          ?? null,
      bloodPressure:   doc.vitals?.bloodPressure   ?? null,
      sugar:           doc.vitals?.sugar           ?? null,
      bodyTemperature: doc.vitals?.bodyTemperature ?? null,
    },
  };
}

// ─── IPDService ───────────────────────────────────────────────────────────────

export class IPDService {

  // ─── U3-B: Admission Lifecycle ──────────────────────────────────────────────

  async createAdmission(
    input:    CreateAdmissionInput,
    tenantId: string,
    userId:   string,
  ): Promise<AdmissionResponse> {
    // [1] Verify patient exists in this tenant
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    // [1b] Reject if the patient already has an active admission
    const activeAdmission = await ipdRepository.findActiveAdmissionByPatient(input.patientId, tenantId);
    if (activeAdmission) {
      throw new ConflictError(
        `Patient is already admitted (admission ID: ${activeAdmission.admissionId}). Discharge the patient before creating a new admission.`,
      );
    }

    // [2] Verify ward exists — uses ipdRepository (U3-A owns Ward model)
    const ward = await ipdRepository.findWardById(tenantId, input.wardId);
    if (!ward) throw new NotFoundError('Ward not found');

    // [3] Verify bed exists — uses ipdRepository (U3-A owns Bed model)
    const bed = await ipdRepository.findBedById(tenantId, input.bedId);
    if (!bed) throw new NotFoundError('Bed not found');

    // [4] Confirm bed belongs to the specified ward
    if (bed.wardId !== input.wardId) {
      throw new AppError('Bed does not belong to specified ward', 400);
    }

    // [5] Authoritative conflict check — query IPD admissions, not bed flag
    const existing = await ipdRepository.findActiveAdmissionByBed(input.bedId, tenantId);
    if (existing) {
      throw new AppError(
        `Bed is currently occupied. Occupant admission ID: ${existing.admissionId}`,
        409,
      );
    }

    // [6] Verify all assigned doctors are Doctors in this tenant (only when provided)
    let doctorDepartmentId: string | null = null;
    const assignedDoctorIds = input.assignedDoctorIds ?? [];
    for (const dId of assignedDoctorIds) {
      const doctor = await userRepository.findById(tenantId, dId);
      if (!doctor || doctor.role !== UserRole.DOCTOR) {
        throw new AppError(`Assigned user ${dId} is not a Doctor in this tenant`, 400);
      }
      if (!doctorDepartmentId) {
        doctorDepartmentId = doctor.departmentIds?.[0] ?? null;
      }
    }

    // [7]+[8] Create the admission and occupy the bed atomically. The
    // partial unique indexes on IPDAdmission (ipd.model.ts) are the final
    // race-condition arbiter under concurrent or offline-replayed creates —
    // steps [1b]/[5] above are a fast, friendly pre-check only; a
    // duplicate-key hit here is mapped to a 409 by the repository.
    const admission = await ipdRepository.createAdmissionWithBedOccupancy(
      {
        admissionId:       uuidv4(),
        patientId:         input.patientId,
        wardId:            input.wardId,
        bedId:             input.bedId,
        bedNumber:         bed.bedNumber,
        wardName:          ward.name,
        assignedDoctorIds: assignedDoctorIds,
        departmentId:      doctorDepartmentId,
        status:           AdmissionStatus.ADMITTED,
        admissionDate:    new Date(),
        dischargeDate:    null,
        progressNotes:    [],
        tenantId,
      },
      input.bedId,
    );

    // [9] Audit log (non-blocking)
    try {
      await auditService.log({
        entityType: AuditEntityType.IPD_ADMISSION,
        entityId:   admission.admissionId,
        action:     'CREATE',
        userId,
        tenantId,
        newValue:   { patientId: input.patientId, wardId: input.wardId, bedId: input.bedId, status: AdmissionStatus.ADMITTED },
      });
    } catch { /* swallow — audit failure must not block primary response */ }

    return toResponse(admission, tenantId, patient.fullName);
  }

  async getAdmissionById(
    admissionId:      string,
    tenantId:         string,
    nurseWardIds?:    string[],
    doctorPatientIds?: string[],
  ): Promise<AdmissionResponse> {
    const admission = await ipdRepository.findById(admissionId, tenantId);
    if (!admission) throw new NotFoundError('Admission not found');
    assertAdmissionInScope(admission, nurseWardIds, doctorPatientIds);
    const patient = await patientRepository.findByPatientId(tenantId, admission.patientId);
    return toResponse(admission, tenantId, patient?.fullName ?? null);
  }

  // Assembles everything IPDController.getParchaPdf needs to render a PDF
  // parcha template: the raw template bytes (fetched from S3) plus the
  // admission's data already shaped into ParchaOverlayInput. Returns null
  // when the tenant has no PDF template configured (no template at all, or
  // an image template — those keep using the existing client-side <img>
  // overlay/default layout, not this endpoint) so the controller can respond
  // 404 and the print page can fall back cleanly. Generated fresh on every
  // request, never persisted — mirrors getDischargeSummaryData.
  async getParchaPdfContext(
    admissionId:       string,
    tenantId:          string,
    nurseWardIds?:     string[],
    doctorPatientIds?: string[],
  ): Promise<{ templateBytes: Buffer; overlay: ParchaOverlayInput } | null> {
    const admission = await ipdRepository.findById(admissionId, tenantId);
    if (!admission) throw new NotFoundError('Admission not found');
    assertAdmissionInScope(admission, nurseWardIds, doctorPatientIds);

    const tenant = await tenantRepository.findById(tenantId);
    const templateKey = tenant?.branding.parchaTemplateUrl ?? null;
    if (!templateKey || !/\.pdf$/i.test(templateKey)) return null;

    const [patient, templateBytes] = await Promise.all([
      patientRepository.findByPatientId(tenantId, admission.patientId),
      s3Service.getFile(templateKey),
    ]);
    if (!patient) throw new NotFoundError('Patient not found');

    const departmentName = admission.departmentId
      ? (await departmentRepository.findById(tenantId, admission.departmentId))?.name ?? null
      : null;
    const doctorNameMap = await userRepository.findNamesByIds(tenantId, admission.assignedDoctorIds ?? []);
    const doctorNames = (admission.assignedDoctorIds ?? [])
      .map((id) => doctorNameMap.get(id))
      .filter((n): n is string => !!n)
      .join(', ');

    const noteAuthorIds = [...new Set(admission.progressNotes.map((n) => n.doctorId))];
    const staffNameMap = await userRepository.findNamesByIds(tenantId, noteAuthorIds);

    const overlay = buildIpdParchaOverlay(admission, patient, departmentName, doctorNames, staffNameMap);
    return { templateBytes, overlay };
  }

  async updateAdmission(
    admissionId: string,
    tenantId:    string,
    input: {
      assignedDoctorIds?: string[];
      wardId?:            string;
      bedId?:             string;
      vitals?:            Partial<IPDVitals>;
    },
    userId: string,
  ): Promise<AdmissionResponse> {
    const admission = await ipdRepository.findById(admissionId, tenantId);
    if (!admission) throw new NotFoundError('Admission not found');
    if (admission.status !== AdmissionStatus.ADMITTED) {
      throw new AppError('Cannot edit a discharged admission', 400);
    }

    const fields: Parameters<typeof ipdRepository.updateAdmissionFields>[2] = {};
    const prevValue: Record<string, unknown> = {};

    // ── Doctor / department change ──────────────────────────────────────────
    if (input.assignedDoctorIds) {
      for (const dId of input.assignedDoctorIds) {
        const doctor = await userRepository.findById(tenantId, dId);
        if (!doctor || doctor.role !== UserRole.DOCTOR) {
          throw new AppError(`Assigned user ${dId} is not a Doctor in this tenant`, 400);
        }
      }
      prevValue.assignedDoctorIds = admission.assignedDoctorIds;
      fields.assignedDoctorIds    = input.assignedDoctorIds;
      if (input.assignedDoctorIds.length > 0) {
        const firstDoctor = await userRepository.findById(tenantId, input.assignedDoctorIds[0]);
        fields.departmentId = firstDoctor?.departmentIds?.[0] ?? null;
      } else {
        fields.departmentId = null;
      }
    }

    // ── Bed / ward change ───────────────────────────────────────────────────
    const bedChanging = input.bedId && input.bedId !== admission.bedId;
    if (bedChanging) {
      const newWardId = input.wardId ?? admission.wardId;

      const ward = await ipdRepository.findWardById(tenantId, newWardId);
      if (!ward) throw new AppError('Ward not found', 404);

      const bed = await ipdRepository.findBedById(tenantId, input.bedId!);
      if (!bed) throw new AppError('Bed not found', 404);
      if (bed.wardId !== newWardId) throw new AppError('Bed does not belong to specified ward', 400);

      const occupant = await ipdRepository.findActiveAdmissionByBed(input.bedId!, tenantId);
      if (occupant && occupant.admissionId !== admissionId) {
        throw new ConflictError(`Bed is already occupied by admission ${occupant.admissionId}`);
      }

      prevValue.wardId = admission.wardId;
      prevValue.bedId  = admission.bedId;
      fields.wardId    = newWardId;
      fields.wardName  = ward.name;
      fields.bedId     = input.bedId!;
      fields.bedNumber = bed.bedNumber;

      // Release the old bed
      await ipdRepository.updateBedOccupancy(tenantId, admission.bedId, false, null);
      // Occupy the new bed
      await ipdRepository.updateBedOccupancy(tenantId, input.bedId!, true, admissionId);
    } else if (input.wardId && input.wardId !== admission.wardId) {
      // Ward changed but no new bed specified — just update wardId/wardName
      const ward = await ipdRepository.findWardById(tenantId, input.wardId);
      if (!ward) throw new AppError('Ward not found', 404);
      prevValue.wardId = admission.wardId;
      fields.wardId    = input.wardId;
      fields.wardName  = ward.name;
    }

    // ── Vitals ──────────────────────────────────────────────────────────────
    // Merge onto the admission's existing readings rather than replacing the
    // whole sub-document — input.vitals only carries the sub-fields the
    // caller actually sent, so recording just one reading (e.g. weight)
    // never wipes out the others already on file. Mirrors
    // OPDService.updateVisit's vitals merge exactly. Role is not re-checked
    // here — the controller's VITALS_EDITABLE_ROLES gate is the sole check
    // on who may send this field.
    if (input.vitals !== undefined) {
      // admission.vitals is a Mongoose subdocument, not a plain object — its
      // schema-defined fields are prototype getters, not own enumerable
      // properties, so `{ ...admission.vitals }` would silently pick up
      // Mongoose's internal bookkeeping instead of the actual values.
      const existingVitals: IPDVitals = {
        weight:          admission.vitals?.weight          ?? DEFAULT_VITALS.weight,
        height:          admission.vitals?.height          ?? DEFAULT_VITALS.height,
        bloodPressure:   admission.vitals?.bloodPressure   ?? DEFAULT_VITALS.bloodPressure,
        sugar:           admission.vitals?.sugar           ?? DEFAULT_VITALS.sugar,
        bodyTemperature: admission.vitals?.bodyTemperature ?? DEFAULT_VITALS.bodyTemperature,
      };
      const mergedVitals: IPDVitals = { ...existingVitals, ...input.vitals };
      prevValue.vitals = existingVitals;
      fields.vitals     = mergedVitals;
    }

    if (Object.keys(fields).length === 0) {
      // Nothing changed — return current state
      const patient = await patientRepository.findByPatientId(tenantId, admission.patientId);
      return toResponse(admission, tenantId, patient?.fullName ?? null);
    }

    const updated = await ipdRepository.updateAdmissionFields(admissionId, tenantId, fields);
    if (!updated) throw new NotFoundError('Admission not found');

    try {
      await auditService.log({
        entityType:    AuditEntityType.IPD_ADMISSION,
        entityId:      admissionId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: redactVitals(prevValue),
        newValue:      redactVitals(fields as Record<string, unknown>),
      });
    } catch { /* swallow */ }

    const patient = await patientRepository.findByPatientId(tenantId, updated.patientId);
    return toResponse(updated, tenantId, patient?.fullName ?? null);
  }

  async addProgressNote(
    admissionId: string,
    input:       AddProgressNoteInput,
    tenantId:    string,
    userId:      string,
  ): Promise<AdmissionResponse> {
    const admission = await ipdRepository.findById(admissionId, tenantId);
    if (!admission) throw new NotFoundError('Admission not found');

    if (admission.status !== AdmissionStatus.ADMITTED) {
      throw new AppError('Cannot add progress note to a discharged admission', 400);
    }

    const progressNote = {
      noteId:    uuidv4(),
      doctorId:  userId,
      note:      input.note,
      timestamp: new Date(),
    };

    const updated = await ipdRepository.appendProgressNote(admissionId, tenantId, progressNote);
    if (!updated) throw new NotFoundError('Admission not found');

    const patient = await patientRepository.findByPatientId(tenantId, updated.patientId);
    return toResponse(updated, tenantId, patient?.fullName ?? null);
  }

  async dischargePatient(
    admissionId: string,
    tenantId:    string,
    userId:      string,
  ): Promise<AdmissionResponse> {
    const admission = await ipdRepository.findById(admissionId, tenantId);
    if (!admission) throw new NotFoundError('Admission not found');

    if (admission.status !== AdmissionStatus.ADMITTED) {
      throw new AppError('Patient is already discharged', 400);
    }

    const dischargeDate = new Date();
    const updated = await ipdRepository.updateStatus(admissionId, tenantId, {
      status: AdmissionStatus.DISCHARGED,
      dischargeDate,
    });
    if (!updated) throw new NotFoundError('Admission not found');

    // Release bed — uses U3-A's updateBedOccupancy
    try {
      await ipdRepository.updateBedOccupancy(tenantId, admission.bedId, false, null);
    } catch (err) {
      console.error('CRITICAL: Discharge saved but bed release failed', {
        admissionId,
        bedId: admission.bedId,
        error: (err as Error).message,
      });
    }

    // Audit log (non-blocking)
    try {
      await auditService.log({
        entityType:    AuditEntityType.IPD_ADMISSION,
        entityId:      admissionId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: { status: AdmissionStatus.ADMITTED },
        newValue:      { status: AdmissionStatus.DISCHARGED, dischargeDate: dischargeDate.toISOString() },
      });
    } catch { /* swallow */ }

    const patient = await patientRepository.findByPatientId(tenantId, updated.patientId);
    return toResponse(updated, tenantId, patient?.fullName ?? null);
  }

  // ─── Discharge Summary PDF data ─────────────────────────────────────────────
  // Existing-data-only aggregation across Patient/OPD/IPD/Lab/Payment/User/
  // Audit records — nothing new is stored, nothing in the discharge workflow
  // itself changes. Billing is included only when `role` already has
  // payment-view permission (mirrors GET /api/payments' role gate exactly).
  async getDischargeSummaryData(
    admissionId:       string,
    tenantId:          string,
    role:              UserRole,
    nurseWardIds?:     string[],
    doctorPatientIds?: string[],
  ): Promise<DischargeSummaryData> {
    const admission = await ipdRepository.findById(admissionId, tenantId);
    if (!admission) throw new NotFoundError('Admission not found');
    assertAdmissionInScope(admission, nurseWardIds, doctorPatientIds);
    if (admission.status !== AdmissionStatus.DISCHARGED) {
      throw new ConflictError('Discharge summary is only available after the patient has been discharged.');
    }

    const patient = await patientRepository.findByPatientId(tenantId, admission.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const [tenant, ward, opdVisits, pathologyRequests, radiologyRequests, payments] = await Promise.all([
      tenantRepository.findById(tenantId),
      ipdRepository.findWardById(tenantId, admission.wardId),
      fetchAllPages((page, limit) => opdRepository.findByPatient(tenantId, admission.patientId, { page, limit })),
      fetchAllPages((page, limit) => labRepository.findPathologyByPatient(tenantId, { patientId: admission.patientId, page, limit })),
      fetchAllPages((page, limit) => labRepository.findRadiologyByPatient(tenantId, { patientId: admission.patientId, page, limit })),
      PAYMENT_VIEW_ROLES.has(role)
        ? fetchAllPages((page, limit) => paymentRepository.findByFilters(tenantId, { patientId: admission.patientId, page, limit }))
        : Promise.resolve(null),
    ]);

    // ── Batch-resolve every user and department referenced anywhere below ──
    const userIds = new Set<string>();
    admission.assignedDoctorIds.forEach((id) => userIds.add(id));
    admission.progressNotes.forEach((n) => userIds.add(n.doctorId));
    (ward?.assignedNurseIds ?? []).forEach((id) => userIds.add(id));
    opdVisits.forEach((v) => v.doctorIds.forEach((id) => userIds.add(id)));
    pathologyRequests.forEach((r) => userIds.add(r.requestedBy));
    radiologyRequests.forEach((r) => userIds.add(r.requestedBy));

    const departmentIds = new Set<string>();
    if (admission.departmentId) departmentIds.add(admission.departmentId);
    opdVisits.forEach((v) => { if (v.departmentId) departmentIds.add(v.departmentId); });
    pathologyRequests.forEach((r) => { if (r.departmentId) departmentIds.add(r.departmentId); });
    radiologyRequests.forEach((r) => { if (r.departmentId) departmentIds.add(r.departmentId); });

    const uniqueNoteAuthorIds = [...new Set(admission.progressNotes.map((n) => n.doctorId))];

    const [nameMap, departmentEntries, registeredByName, dischargedByName, noteAuthorUsers, hospitalLogoUrl] = await Promise.all([
      userRepository.findNamesByIds(tenantId, [...userIds]),
      Promise.all([...departmentIds].map(async (id) => [id, await departmentRepository.findById(tenantId, id)] as const)),
      resolveRegisteredBy(tenantId, admission.patientId),
      resolveDischargedBy(tenantId, admissionId),
      Promise.all(uniqueNoteAuthorIds.map(async (id) => [id, await userRepository.findById(tenantId, id)] as const)),
      tenant?.branding.logoUrl ? s3Service.getPresignedUrl(tenant.branding.logoUrl, 86400).catch(() => null) : Promise.resolve(null),
    ]);

    const departmentNameMap = new Map(
      departmentEntries.filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1] !== null)
        .map(([id, dept]) => [id, dept.name]),
    );
    const authorRoleMap = new Map(
      noteAuthorUsers.filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1] !== null)
        .map(([id, user]) => [id, user.role as string]),
    );

    const namesFor = (ids: string[]) =>
      ids.map((id) => nameMap.get(id)).filter((n): n is string => !!n);

    // ── Billing (role-gated) ────────────────────────────────────────────────
    let billing: DischargeSummaryBilling | null = null;
    if (payments && payments.length > 0) {
      billing = {
        payments: payments.map((p) => ({
          amount:        p.amount,
          paymentMethod: p.paymentMethod,
          status:        p.status,
          description:   p.description,
          createdAt:     p.createdAt.toISOString(),
        })),
        total: payments
          .filter((p) => p.status === 'COMPLETED')
          .reduce((sum, p) => sum + p.amount, 0),
      };
    }

    // ── Lab requests — resolve report download links (best-effort) ─────────
    const labRequestsRaw = [
      ...pathologyRequests.map((r) => ({
        requestId: r.requestId, category: 'PATHOLOGY' as const, type: r.testType,
        status: r.status, priority: r.priority, requestedBy: r.requestedBy,
        departmentId: r.departmentId, requestedAt: r.requestedAt, notes: r.notes,
        reportS3Key: r.reportS3Key,
      })),
      ...radiologyRequests.map((r) => ({
        requestId: r.requestId, category: 'RADIOLOGY' as const, type: r.imagingType,
        status: r.status, priority: r.priority, requestedBy: r.requestedBy,
        departmentId: r.departmentId, requestedAt: r.requestedAt, notes: r.notes,
        reportS3Key: r.reportS3Key,
      })),
    ];

    const labRequests = await Promise.all(labRequestsRaw.map(async (r) => ({
      requestId:       r.requestId,
      category:        r.category,
      type:            r.type,
      status:          r.status,
      priority:        r.priority,
      requestedByName: nameMap.get(r.requestedBy) ?? null,
      departmentName:  r.departmentId ? departmentNameMap.get(r.departmentId) ?? null : null,
      requestedAt:     r.requestedAt.toISOString(),
      notesHtml:       r.notes,
      reportUrl:       r.reportS3Key ? await s3Service.getPresignedUrl(r.reportS3Key, 3600).catch(() => null) : null,
    })));

    const hospitalAddressParts = tenant
      ? [
          tenant.onboardingDocuments.addressLine,
          tenant.onboardingDocuments.city,
          tenant.onboardingDocuments.state,
          tenant.onboardingDocuments.pincode,
        ].filter((part): part is string => !!part)
      : [];

    return {
      hospital: {
        name:               tenant?.branding.displayName || tenant?.name || 'Hospital',
        logoUrl:            hospitalLogoUrl,
        // No hardcoded brand hue here — an unconfigured/missing color is
        // handled by discharge-summary.pdf's hexToRgb, which falls back to
        // black rather than a hardcoded blue.
        primaryColor:       tenant?.branding.primaryColor || '',
        address:            hospitalAddressParts.length ? hospitalAddressParts.join(', ') : null,
        email:              tenant?.adminEmail ?? null,
        registrationNumber: tenant?.onboardingDocuments.gstNumber ?? null,
      },
      patient: {
        patientId:        patient.patientId,
        fullName:         patient.fullName,
        age:              calculateAge(new Date(patient.dateOfBirth)),
        gender:           patient.gender,
        mobileNumber:     patient.mobileNumber,
        address:          patient.address || null,
        registeredAt:     patient.createdAt.toISOString(),
        registeredByName,
      },
      opdVisits: opdVisits.map((v) => ({
        visitId:        v.visitId,
        visitDate:      v.visitDate.toISOString(),
        status:         v.status,
        departmentName: v.departmentId ? departmentNameMap.get(v.departmentId) ?? null : null,
        doctorNames:    namesFor(v.doctorIds),
        diagnosis:      v.diagnosis,
        prescription:   v.prescription,
        notesHtml:      v.notes,
      })),
      admission: {
        admissionId:         admission.admissionId,
        wardName:            admission.wardName,
        bedNumber:           admission.bedNumber,
        departmentName:      admission.departmentId ? departmentNameMap.get(admission.departmentId) ?? null : null,
        assignedDoctorNames: namesFor(admission.assignedDoctorIds),
        assignedNurseNames:  namesFor(ward?.assignedNurseIds ?? []),
        admissionDate:       admission.admissionDate.toISOString(),
        dischargeDate:       admission.dischargeDate!.toISOString(),
        dischargedByName,
        progressNotes: [...admission.progressNotes]
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
          .map((n) => ({
            authorName: nameMap.get(n.doctorId) ?? null,
            authorRole: authorRoleMap.get(n.doctorId) ?? null,
            timestamp:  n.timestamp.toISOString(),
            noteHtml:   n.note,
          })),
      },
      labRequests,
      billing,
      generatedAt: new Date().toISOString(),
    };
  }

  async listAdmissions(
    tenantId:          string,
    query:             ListAdmissionsQuery,
    nurseWardIds?:     string[],
    doctorPatientIds?: string[],
  ): Promise<PaginatedResult<AdmissionResponse>> {
    const searchPatientIds = query.search
      ? await resolvePatientIdsBySearch(tenantId, query.search)
      : undefined;
    const scopedPatientIds = combinePatientIdFilters(searchPatientIds, doctorPatientIds);
    const result = await ipdRepository.findActiveAdmissions(tenantId, query, scopedPatientIds, nurseWardIds);
    const admissions = result.data;

    const patientIds = admissions.map(a => a.patientId);

    const patients = await PatientModel.find({
      tenantId,
      patientId: { $in: patientIds },
    }).lean();

    const map = new Map(patients.map(p => [p.patientId, p.fullName]));

    const allAuthorIds = [...new Set(admissions.flatMap((a) => a.progressNotes.map((n) => n.doctorId)))];
    const staffNameMap = await userRepository.findNamesByIds(tenantId, allAuthorIds);

    return {
      ...result,
      data: await Promise.all(
        result.data.map((admission) =>
          toResponse(admission, tenantId, map.get(admission.patientId) ?? null, staffNameMap),
        ),
      ),
    };
  }

  async getPatientHistory(
    tenantId:          string,
    patientId:         string,
    page:              number,
    limit:             number,
    status?:           'ADMITTED' | 'DISCHARGED',
    nurseWardIds?:     string[],
    doctorPatientIds?: string[],
  ): Promise<PaginatedResult<AdmissionResponse>> {
    const patient = await patientRepository.findByPatientId(tenantId, patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    if (nurseWardIds) {
      const scopedPatientIds = await ipdRepository.findPatientIdsByWards(tenantId, nurseWardIds);
      if (!scopedPatientIds.includes(patientId)) throw new NotFoundError('Patient not found');
    }

    if (doctorPatientIds && !doctorPatientIds.includes(patientId)) {
      throw new NotFoundError('Patient not found');
    }

    const result = await ipdRepository.findByPatient(tenantId, patientId, page, limit, status);

    return {
      ...result,
      data: await Promise.all(result.data.map((a) => toResponse(a, tenantId, patient.fullName))),
    };
  }

  async getBedOccupancySummary(tenantId: string): Promise<WardOccupancySummary[]> {
    // Delegates to U3-A's aggregation-based occupancy query (single DB round-trip)
    return ipdRepository.getOccupancySummary(tenantId);
  }

  // ─── Role-based access scope resolution ─────────────────────────────────────
  // Canonical implementations — reused by OPDService and PatientService so the
  // same nurse/doctor scoping logic isn't duplicated across modules.

  // A Nurse is restricted to the ward(s) they're assigned via Ward.assignedNurseIds.
  // Returns undefined for any other role (no restriction applied).
  async resolveNurseWardIds(
    tenantId: string,
    userId:   string,
    role:     UserRole,
  ): Promise<string[] | undefined> {
    if (role !== UserRole.NURSE) return undefined;
    return ipdRepository.findWardIdsByNurse(tenantId, userId);
  }

  // A Nurse only sees patients currently admitted (active IPD admission) in
  // their assigned ward(s) — Ward.assignedNurseIds is the source of truth.
  // Returns undefined for any other role (no restriction applied).
  async resolveNursePatientIds(
    tenantId: string,
    userId:   string,
    role:     UserRole,
  ): Promise<string[] | undefined> {
    if (role !== UserRole.NURSE) return undefined;
    const wardIds = await ipdRepository.findWardIdsByNurse(tenantId, userId);
    if (!wardIds.length) return [];
    return ipdRepository.findPatientIdsByWards(tenantId, wardIds);
  }

  // A Doctor only sees patients/records they've been assigned to — via an OPD
  // visit (doctorIds) or an IPD admission (assignedDoctorIds), current or
  // past. Returns undefined for any other role (no restriction applied).
  async resolveDoctorPatientIds(
    tenantId: string,
    userId:   string,
    role:     UserRole,
  ): Promise<string[] | undefined> {
    if (role !== UserRole.DOCTOR) return undefined;
    const [opdIds, ipdIds] = await Promise.all([
      opdRepository.findPatientIdsByDoctor(tenantId, userId),
      ipdRepository.findPatientIdsByAssignedDoctor(tenantId, userId),
    ]);
    return [...new Set([...opdIds, ...ipdIds])];
  }

  // ─── U3-A: Ward Management ──────────────────────────────────────────────────

  async createWard(
    tenantId: string,
    data:     CreateWardRequest,
    actorId:  string,
  ): Promise<IWard> {
    const existing = await ipdRepository.findWardByName(tenantId, data.name);
    if (existing) throw new ConflictError(`Ward "${data.name}" already exists`);

    const ward = await ipdRepository.createWard({ tenantId, name: data.name, floor: data.floor });

    try {
      await auditService.log({
        entityType: AuditEntityType.IPD_ADMISSION,
        entityId:   (ward._id as mongoose.Types.ObjectId).toString(),
        action:     'CREATE',
        userId:     actorId,
        tenantId,
        newValue:   { name: ward.name, floor: ward.floor },
      });
    } catch { /* swallow */ }

    return ward;
  }

  async listWards(tenantId: string): Promise<IWard[]> {
    return ipdRepository.listWards(tenantId);
  }

  async assignNursesToWard(
    tenantId: string,
    wardId:   string,
    nurseIds: string[],
    actorId:  string,
  ): Promise<IWard> {
    const ward = await ipdRepository.findWardById(tenantId, wardId);
    if (!ward) throw new NotFoundError(`Ward ${wardId} not found`);

    for (const id of nurseIds) {
      const user = await userRepository.findById(tenantId, id);
      if (!user) throw new NotFoundError(`User ${id} not found`);
      if (user.role !== UserRole.NURSE) {
        throw new AppError(`User ${id} is not a NURSE`, 400);
      }
    }

    const updated = await ipdRepository.updateWardNurses(tenantId, wardId, nurseIds);
    if (!updated) throw new NotFoundError(`Ward ${wardId} not found`);

    try {
      await auditService.log({
        entityType: AuditEntityType.IPD_ADMISSION,
        entityId:   wardId,
        action:     'UPDATE',
        userId:     actorId,
        tenantId,
        newValue:   { assignedNurseIds: nurseIds },
      });
    } catch { /* swallow */ }

    return updated;
  }

  // ─── U3-A: Bed Management ───────────────────────────────────────────────────

  async addBedsToWard(
    tenantId: string,
    wardId:   string,
    data:     AddBedsRequest,
    actorId:  string,
  ): Promise<IBed[]> {
    const ward = await ipdRepository.findWardById(tenantId, wardId);
    if (!ward) throw new NotFoundError('Ward not found');

    const created: IBed[]    = [];
    const duplicates: string[] = [];

    for (const bedNumber of data.bedNumbers) {
      const existing = await ipdRepository.findBedByNumber(tenantId, wardId, bedNumber);
      if (existing) { duplicates.push(bedNumber); continue; }
      const bed = await ipdRepository.addBed({ tenantId, wardId, bedNumber });
      created.push(bed);
    }

    if (duplicates.length > 0 && created.length === 0) {
      throw new ConflictError(`Bed(s) already exist in this ward: ${duplicates.join(', ')}`);
    }

    if (created.length > 0) {
      try {
        await auditService.log({
          entityType: AuditEntityType.IPD_ADMISSION,
          entityId:   wardId,
          action:     'UPDATE',
          userId:     actorId,
          tenantId,
          newValue:   { addedBeds: created.map((b) => b.bedNumber), skipped: duplicates },
        });
      } catch { /* swallow */ }
    }

    return created;
  }

  async listBedsInWard(tenantId: string, wardId: string): Promise<IBed[]> {
    const ward = await ipdRepository.findWardById(tenantId, wardId);
    if (!ward) throw new NotFoundError('Ward not found');
    return ipdRepository.listBedsInWard(tenantId, wardId);
  }

  // ─── U3-A: Occupancy summary (FR-08.8) ─────────────────────────────────────

  async getOccupancySummary(tenantId: string): Promise<WardOccupancySummary[]> {
    return ipdRepository.getOccupancySummary(tenantId);
  }

  // ─── U3-A: Bed conflict helper ──────────────────────────────────────────────

  async assertBedAvailable(tenantId: string, wardId: string, bedNumber: string): Promise<IBed> {
    const bed = await ipdRepository.findBedByNumber(tenantId, wardId, bedNumber);
    if (!bed) throw new NotFoundError(`Bed ${bedNumber} not found in ward`);
    if (bed.isOccupied) {
      throw new BedOccupiedError(bedNumber, bed.currentAdmissionId!);
    }
    return bed;
  }
}

export const ipdService = new IPDService();
