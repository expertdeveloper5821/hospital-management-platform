import { v4 as uuidv4 } from 'uuid';
import { opdRepository, OpdHistoryFilters } from './opd.repository';
import { ipdService } from '../ipd/ipd.service';
import { ipdRepository } from '../ipd/ipd.repository';
import { patientRepository } from '../patient/patient.repository';
import { paymentRepository } from '../payment/payment.repository';
import { PaymentReferenceType } from '../payment/payment.types';
import { departmentService } from '../department/department.service';
import { departmentRepository } from '../department/department.repository';
import { tenantService } from '../tenant/tenant.service';
import { tenantRepository } from '../tenant/tenant.repository';
import { userRepository } from '../user/user.repository';
import { toIstMidnight } from '../attendance/attendance.timezone';
import { IOPDVisit } from './opd.model';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import { auditService } from '../../shared/services/audit.service';
import { s3Service } from '../../shared/services/s3.service';
import { stripRichTextTags } from '../../shared/utils/validation';
import { ParchaOverlayInput } from '../../shared/services/parcha-template.service';
import { NotFoundError, ConflictError, ValidationError } from '../../shared/middleware/error-handler';
import {
  OPDVisitStatus,
  TERMINAL_STATUSES,
  CreateOPDVisitRequest,
  UpdateOPDVisitRequest,
  CompleteOPDVisitRequest,
  OPDVisitResponse,
  OPDPaymentValidityResponse,
  OPDPaymentValidityReason,
  AvailableOpdNurseResponse,
  DoctorNurseAssignmentsResponse,
  OPDVitals,
} from './opd.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Shape a partial (or missing) vitals update/read always merges onto — keeps
// "no vitals recorded yet" and "some vitals cleared" both resolving to the
// same fully-shaped object rather than undefined sub-fields.
const DEFAULT_VITALS: OPDVitals = {
  weight:          null,
  height:          null,
  bloodPressure:   null,
  sugar:           null,
  bodyTemperature: null,
};

// Clinical free-text — and vitals, as of the objectFields encryption — is
// encrypted at rest on the visit itself (see opd.model.ts). Audit log entries
// are stored in plain form and rendered in the Audit UI, so these fields must
// never carry their value into one — the trail records *that* the field
// changed (and, for a clear, that it was explicitly emptied), never what it
// changed to/from. Applied to both previousValue and newValue. `vitals` is an
// object, not a scalar, but is redacted wholesale with the same markers
// regardless of shape — matching the existing "whole object, not per
// sub-field" granularity IPDService's own vitals redaction also uses.
const REDACTED_AUDIT_FIELDS = ['diagnosis', 'prescription', 'notes', 'vitals'] as const;
const REDACTED_MARKER = '[redacted]';
// Distinguishes an explicit clear (a field that had content and was emptied
// by this exact change) from an ordinary set/update, without ever recording
// the clinical text itself.
const CLEARED_MARKER = '[cleared]';

// True when a clinical field's value carries no content — an empty/whitespace
// string, null/undefined, or (vitals) every sub-field null/undefined.
function isEmptyClinicalValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).every((v) => v === null || v === undefined);
  }
  return false;
}

// True when two values for the same field are equivalent — used to decide
// whether a resent field actually changed and thus belongs in the audit
// diff at all. Strings treat null/undefined/'' as the same "empty" value
// (so re-saving an already-empty field is never misreported as a fresh
// clear); string arrays (doctorIds) compare order-independently.
function isSameFieldValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }
  if (typeof a === 'string' || typeof b === 'string' || a == null || b == null) {
    const normalize = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    return normalize(a) === normalize(b);
  }
  return a === b;
}

// Redacts a clinical-field audit diff, distinguishing a genuine clear from an
// ordinary set/update, still never recording the actual clinical text. Only
// meant to be called with a (previousValue, newValue) pair whose clinical
// keys were already filtered down to fields that actually changed (see
// updateVisit/completeVisit) — every REDACTED_AUDIT_FIELDS key present in
// newValue is therefore treated as a real change: CLEARED_MARKER when the
// new value is empty (and the old one, by construction, was not), otherwise
// REDACTED_MARKER on both sides for a set/update.
function redactClinicalDiff(
  previousValue: Record<string, unknown>,
  newValue:      Record<string, unknown>,
): { previousValue: Record<string, unknown>; newValue: Record<string, unknown> } {
  const redactedPrevious = { ...previousValue };
  const redactedNew      = { ...newValue };
  for (const field of REDACTED_AUDIT_FIELDS) {
    if (!(field in newValue)) continue;
    const previousHadContent = field in previousValue && !isEmptyClinicalValue(previousValue[field]);
    redactedPrevious[field] = previousHadContent ? REDACTED_MARKER : null;
    redactedNew[field]      = isEmptyClinicalValue(newValue[field]) ? CLEARED_MARKER : REDACTED_MARKER;
  }
  return { previousValue: redactedPrevious, newValue: redactedNew };
}

function withFullName<T extends IOPDVisit>(visit: T, fullName?: string): T & { fullName?: string } {
  return Object.assign(visit, { fullName });
}

// ─── Parcha PDF template overlay ────────────────────────────────────────────
// Mirrors the OPD print page's (client/app/(dashboard)/opd/[visitId]/print/
// page.tsx) field selection exactly, so a PDF template shows the same
// information the default/image layouts do — just assembled server-side
// since a PDF template is merged with the visit's data on the server (see
// OPDService.getParchaPdfContext) rather than composited client-side.
function calculateAgeFromDob(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return Math.max(0, age);
}

function toDisplayCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function formatParchaDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildOpdParchaOverlay(
  visit:          IOPDVisit,
  patient:        { fullName: string; patientId: string; dateOfBirth: string; gender: string; mobileNumber: string; address: string; bloodGroup?: string | null },
  departmentName: string | null,
  doctorNames:    string,
): ParchaOverlayInput {
  const fieldRows: ParchaOverlayInput['fieldRows'] = [
    { label: 'Patient Name', value: patient.fullName },
    { label: 'Patient ID',   value: patient.patientId },
    { label: 'Age / Gender', value: `${calculateAgeFromDob(patient.dateOfBirth)} years / ${toDisplayCase(patient.gender)}` },
    { label: 'Mobile',       value: patient.mobileNumber },
  ];
  if (patient.address)   fieldRows.push({ label: 'Address',     value: patient.address });
  if (patient.bloodGroup) fieldRows.push({ label: 'Blood Group', value: patient.bloodGroup });
  fieldRows.push({ label: 'Visit ID',   value: visit.visitId });
  fieldRows.push({ label: 'Visit Date', value: formatParchaDate(visit.visitDate) });
  if (departmentName) fieldRows.push({ label: 'Department', value: departmentName });
  if (doctorNames)     fieldRows.push({ label: 'Doctor',     value: doctorNames });
  fieldRows.push({ label: 'Registered On', value: formatParchaDate(visit.createdAt) });

  const vitals: ParchaOverlayInput['vitals'] = [
    { label: 'Weight', value: visit.vitals?.weight          != null ? String(visit.vitals.weight)          : '' },
    { label: 'Height', value: visit.vitals?.height          != null ? String(visit.vitals.height)          : '' },
    { label: 'BP',     value: visit.vitals?.bloodPressure   ?? '' },
    { label: 'Sugar',  value: visit.vitals?.sugar           != null ? String(visit.vitals.sugar)           : '' },
    { label: 'Temp',   value: visit.vitals?.bodyTemperature != null ? String(visit.vitals.bodyTemperature) : '' },
  ];

  return {
    fieldRows,
    vitals,
    bodySections: [
      { heading: 'Diagnosis',    text: visit.diagnosis ?? '',                   weight: 1 },
      { heading: 'Prescription', text: visit.prescription ?? '',                weight: 5 },
      { heading: 'Notes',        text: stripRichTextTags(visit.notes ?? ''),    weight: 3 },
    ],
    footerText: 'This is valid for 15 days.',
  };
}

// Roles trusted to record a backdated OPD visit (e.g. paper-register backfill).
// Every other role is restricted to today/future dates.
const BACKDATE_ALLOWED_ROLES: ReadonlySet<UserRole> = new Set([UserRole.HOSPITAL_ADMIN]);

// "Today" is IST midnight, not server-local midnight — see toIstMidnight's
// doc comment. A server running in UTC must reject/allow the same dates a
// server running in IST would, for the same hospital-local calendar day.
function isPastDate(date: Date): boolean {
  return date.getTime() < toIstMidnight(new Date()).getTime();
}

function assertNotPastDateUnlessAuthorized(date: Date, role: UserRole): void {
  if (isPastDate(date) && !BACKDATE_ALLOWED_ROLES.has(role)) {
    throw new ValidationError('Past dates are not allowed for OPD visits.');
  }
}

export class OPDService {
  async createVisit(
    tenantId:  string,
    data:      CreateOPDVisitRequest,
    createdBy: string,
    role:      UserRole,
  ): Promise<IOPDVisit & { fullName?: string }> {
    const patient = await patientRepository.findByPatientId(tenantId, data.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    // Normalized to IST midnight (not server-local midnight) so the stored
    // calendar day matches the hospital-local date regardless of the server
    // process's own OS timezone — see toIstMidnight's doc comment.
    const visitDate = toIstMidnight(data.visitDate ? new Date(data.visitDate) : new Date());
    assertNotPastDateUnlessAuthorized(visitDate, role);

    const doctorIds = data.doctorIds ?? [];
    const duplicate = await opdRepository.findActiveDuplicate(tenantId, data.patientId, visitDate, doctorIds);
    if (duplicate) {
      throw new ConflictError(
        'An appointment already exists for this patient with the selected doctor, date, and time slot.',
      );
    }

    const queueNumber = (await opdRepository.countByDate(tenantId, visitDate)) + 1;
    const visitId = `OPD-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`;

    // Department is resolved from the assigned doctor(s), not the patient —
    // patients are no longer department-scoped (see CLAUDE.md), so
    // patient.departmentId is always null for anyone registered since that
    // change. Same "first doctor with a department wins" algorithm IPD uses.
    const departmentId = await departmentService.resolveDepartmentFromDoctorIds(tenantId, doctorIds);

    // Nurse assignment is optional and can name more than one nurse for the
    // same visit. Omitting it (or submitting an empty list) leaves any
    // existing doctor→nurse mapping(s) untouched — doctor assignment and
    // nurse assignment are independent. Each id given is validated fresh here
    // rather than trusted from whatever the dropdown showed, closing the race
    // window between the nurse list loading and this request landing.
    // Deduplicated so the same nurse selected twice can't produce duplicate
    // mapping-upsert calls or a misleading nurseIds array on the visit.
    const requestedNurseIds = [...new Set(data.nurseIds ?? [])];
    const nurseIds: string[] = [];
    for (const id of requestedNurseIds) {
      nurseIds.push(await this.assertNurseAvailableForOpd(tenantId, id));
    }

    const visit = await opdRepository.save({
      visitId,
      tenantId,
      patientId:      data.patientId,
      doctorIds,
      nurseIds,
      departmentId,
      visitDate,
      queueNumber,
      status:         OPDVisitStatus.OPEN,
      notes:          data.notes         ?? null,
      diagnosis:      null,
      prescription:   null,
    });

    // Doctor-wise default OPD nurses — keyed to the first assigned doctor,
    // same "first doctor wins" convention resolveDepartmentFromDoctorIds
    // uses. Adds each nurse to that doctor's mapping (a doctor can have more
    // than one); the underlying upsert is per-pair and idempotent, so this
    // never creates a duplicate/conflicting mapping row.
    if (nurseIds.length > 0 && doctorIds.length > 0) {
      const doctorId = doctorIds[0];
      await opdRepository.addNurseAssignments(tenantId, doctorId, nurseIds);
      await auditService.log({
        entityType: AuditEntityType.OPD_NURSE_ASSIGNMENT,
        entityId:   doctorId,
        action:     'UPDATE',
        userId:     createdBy,
        tenantId,
        newValue:   { doctorId, nurseIds },
      });
    }

    await auditService.log({
      entityType: AuditEntityType.OPD_VISIT,
      entityId:   visitId,
      action:     'CREATE',
      userId:     createdBy,
      tenantId,
      newValue:   { visitId, patientId: data.patientId, status: OPDVisitStatus.OPEN, nurseIds },
    });

    return withFullName(visit, patient.fullName);
  }

  // Validates a candidate OPD nurse and returns their id — throws otherwise.
  private async assertNurseAvailableForOpd(tenantId: string, nurseId: string): Promise<string> {
    const nurse = await userRepository.findById(tenantId, nurseId);
    if (!nurse || nurse.role !== UserRole.NURSE) {
      throw new ValidationError('Selected nurse was not found.');
    }
    if (!nurse.isActive) {
      throw new ValidationError('Selected nurse is not active.');
    }
    const wardIds = await ipdRepository.findWardIdsByNurse(tenantId, nurseId);
    if (wardIds.length > 0) {
      throw new ConflictError('This nurse is currently assigned to an IPD ward and is not available for OPD.');
    }
    return nurseId;
  }

  async updateVisit(
    tenantId:          string,
    visitId:           string,
    data:              UpdateOPDVisitRequest,
    updatedBy:         string,
    role:              UserRole,
    scopedPatientIds?: string[],
  ): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');

    // A Nurse's direct assignment (this exact visit's own nurseIds) is a
    // visit-level grant, checked against the visit itself — never derived
    // from scopedPatientIds, which is ward-only patient-level scope (see
    // resolveNursePatientIds). It must also satisfy the general scope check
    // below, since a nurse directly assigned to this visit and nobody else's
    // ward business is still allowed through.
    const isDirectNurseAssignment = role === UserRole.NURSE && (visit.nurseIds ?? []).includes(updatedBy);
    if (scopedPatientIds && !scopedPatientIds.includes(visit.patientId) && !isDirectNurseAssignment) {
      throw new NotFoundError('OPD visit not found');
    }

    // A Nurse may only edit (notes-only, enforced by the controller) a visit
    // she is personally listed on — narrower than the general ward/direct
    // patient-scoping above, which also covers patients she can merely *view*
    // via ward duty. Not being on this specific visit's nurseIds is treated
    // the same as "not found", matching the obfuscation convention the
    // doctor/nurse scoping checks already use elsewhere in this method.
    if (role === UserRole.NURSE && !isDirectNurseAssignment) {
      throw new NotFoundError('OPD visit not found');
    }

    if (TERMINAL_STATUSES.has(visit.status)) {
      throw new ConflictError(`Cannot update a visit with status ${visit.status}`);
    }

    const updateData:    Partial<IOPDVisit>        = {};
    const previousValue: Record<string, unknown> = {};
    const newValue:      Record<string, unknown> = {};

    const fields: Array<keyof UpdateOPDVisitRequest & keyof IOPDVisit> =
      ['doctorIds', 'diagnosis', 'prescription', 'notes'];
    for (const key of fields) {
      if ((data as Record<string, unknown>)[key] !== undefined) {
        const oldVal = (visit as unknown as Record<string, unknown>)[key];
        const newVal = (data as Record<string, unknown>)[key];
        (updateData as Record<string, unknown>)[key] = newVal;
        // Only record (and thus audit) a field that actually changed. The
        // Edit form resends diagnosis/prescription/notes on every save
        // regardless of whether the user touched them (so an intentional
        // clear is distinguishable from "field simply wasn't included" — see
        // opd/page.tsx's handleUpdate); without this check every single edit
        // would audit-log those untouched fields as a no-op "update".
        if (!isSameFieldValue(oldVal, newVal)) {
          previousValue[key] = oldVal;
          newValue[key]      = newVal;
        }
      }
    }

    // Vitals merge onto the visit's existing readings rather than replacing
    // the whole sub-document — data.vitals only carries the sub-fields the
    // caller actually sent (see UpdateOPDVisitRequest.vitals), so recording
    // just one reading (e.g. weight) never wipes out the others already on
    // file. Role is not re-checked here: the route/controller already limit
    // this endpoint to DOCTOR/HOSPITAL_ADMIN/NURSE, and NURSE_EDITABLE_FIELDS
    // in the controller is the sole gate on which of those roles may touch it.
    if (data.vitals !== undefined) {
      // visit.vitals is a Mongoose subdocument, not a plain object — its
      // schema-defined fields are prototype getters, not own enumerable
      // properties, so `{ ...visit.vitals }` silently picks up Mongoose's
      // internal bookkeeping ($__parent, _doc, …) instead of the actual
      // values. Read each field explicitly instead of spreading it.
      const existingVitals: OPDVitals = {
        weight:          visit.vitals?.weight          ?? null,
        height:          visit.vitals?.height          ?? null,
        bloodPressure:   visit.vitals?.bloodPressure   ?? null,
        sugar:           visit.vitals?.sugar           ?? null,
        bodyTemperature: visit.vitals?.bodyTemperature ?? null,
      };
      const mergedVitals: OPDVitals = { ...existingVitals, ...data.vitals };
      updateData.vitals = mergedVitals;
      // Same "only audit what actually changed" rule as the fields loop
      // above — vitals are merged (not replaced) so an edit that only
      // touches, say, weight would otherwise misreport every other reading
      // as having "changed" too.
      if (
        existingVitals.weight          !== mergedVitals.weight          ||
        existingVitals.height          !== mergedVitals.height          ||
        existingVitals.bloodPressure   !== mergedVitals.bloodPressure   ||
        existingVitals.sugar           !== mergedVitals.sugar           ||
        existingVitals.bodyTemperature !== mergedVitals.bodyTemperature
      ) {
        previousValue.vitals = existingVitals;
        newValue.vitals      = mergedVitals;
      }
    }

    // Re-stamp departmentId whenever the doctor assignment actually changes —
    // otherwise a visit that started with no doctor (or a different doctor's
    // department) would keep a stale/null department after reassignment, same
    // gap IPD's admission update already closes for assignedDoctorIds. Gated
    // on a real change (not just "doctorIds was present in the request") so
    // resending the same assignment unchanged — which the Edit form's
    // diagnosis/prescription/notes/vitals-only saves never do, but a direct
    // API caller might — doesn't re-run the department lookup/duplicate
    // check below or log a no-op departmentId "change" to the audit trail.
    const doctorIdsChanged = data.doctorIds !== undefined && !isSameFieldValue(visit.doctorIds, data.doctorIds);
    if (doctorIdsChanged) {
      previousValue.departmentId = visit.departmentId;
      const departmentId = await departmentService.resolveDepartmentFromDoctorIds(tenantId, data.doctorIds!);
      newValue.departmentId   = departmentId;
      updateData.departmentId = departmentId;
    }

    // visitDate needs Date conversion and may require a new queue number
    if (data.visitDate !== undefined) {
      const newDate = toIstMidnight(new Date(data.visitDate));
      assertNotPastDateUnlessAuthorized(newDate, role);

      previousValue.visitDate = visit.visitDate;
      newValue.visitDate      = newDate;
      updateData.visitDate    = newDate;

      const existingDate = toIstMidnight(visit.visitDate);
      if (newDate.getTime() !== existingDate.getTime()) {
        const newQueueNumber        = (await opdRepository.countByDate(tenantId, newDate)) + 1;
        previousValue.queueNumber   = visit.queueNumber;
        newValue.queueNumber        = newQueueNumber;
        updateData.queueNumber      = newQueueNumber;
      }
    }

    // Re-run the duplicate-appointment guard whenever the doctor assignment or
    // date is actually changing — an edit can create the same clash a create can.
    if (doctorIdsChanged || data.visitDate !== undefined) {
      const effectiveDoctorIds = data.doctorIds ?? visit.doctorIds;
      const effectiveDate      = (updateData.visitDate as Date | undefined) ?? visit.visitDate;
      const duplicate = await opdRepository.findActiveDuplicate(
        tenantId, visit.patientId, effectiveDate, effectiveDoctorIds, visitId,
      );
      if (duplicate) {
        throw new ConflictError(
          'An appointment already exists for this patient with the selected doctor, date, and time slot.',
        );
      }
    }

    // The repository-level filter must not re-apply scopedPatientIds when
    // access was actually granted via direct nurseIds assignment — for a
    // ward-less nurse scopedPatientIds is `[]`, and an `$in: []` filter would
    // match no document even though the visit-level check above already
    // authorized this exact visit.
    const updateFilterPatientIds = isDirectNurseAssignment ? undefined : scopedPatientIds;
    const updated = await opdRepository.update(tenantId, visitId, updateData, updateFilterPatientIds);
    if (!updated) throw new NotFoundError('OPD visit not found');

    // Skip the audit write entirely for a genuine no-op save (edit opened
    // and saved with nothing actually changed) — every field above is only
    // added to previousValue/newValue when it differs from the visit's prior
    // value, so both are empty here iff nothing did. `userId` is always
    // `updatedBy`, derived server-side from the authenticated session (see
    // the controller, which passes `req.user!.userId` — never anything from
    // the request body), so the actor can never be spoofed via the payload.
    if (Object.keys(previousValue).length > 0 || Object.keys(newValue).length > 0) {
      const { previousValue: auditPrevious, newValue: auditNew } = redactClinicalDiff(previousValue, newValue);
      await auditService.log({
        entityType: AuditEntityType.OPD_VISIT,
        entityId:   visitId,
        action:     'UPDATE',
        userId:     updatedBy,
        tenantId,
        previousValue: auditPrevious,
        newValue:      auditNew,
      });
    }

    const patient = await patientRepository.findByPatientId(tenantId, updated.patientId);
    return withFullName(updated, patient?.fullName);
  }

  // OPEN → IN_PROGRESS. Called when the doctor actually starts seeing the
  // patient, so the queue can distinguish "waiting" from "being seen" —
  // previously every visit sat at OPEN until it was completed.
  async startConsultation(
    tenantId:          string,
    visitId:           string,
    startedBy:         string,
    role:              UserRole,
    scopedPatientIds?: string[],
  ): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');

    // Same direct-assignment-vs-ward-scope split as updateVisit — a nurse
    // (the only non-doctor/admin role that can reach this action) must be
    // personally listed on this exact visit's nurseIds to start it; merely
    // having the patient in scope via ward duty, or via a different visit for
    // the same patient, is not enough.
    const isDirectNurseAssignment = role === UserRole.NURSE && (visit.nurseIds ?? []).includes(startedBy);
    if (scopedPatientIds && !scopedPatientIds.includes(visit.patientId) && !isDirectNurseAssignment) {
      throw new NotFoundError('OPD visit not found');
    }
    if (role === UserRole.NURSE && !isDirectNurseAssignment) {
      throw new NotFoundError('OPD visit not found');
    }

    if (TERMINAL_STATUSES.has(visit.status)) {
      throw new ConflictError(`Cannot start a visit with status ${visit.status}`);
    }
    if (visit.status === OPDVisitStatus.IN_PROGRESS) {
      throw new ConflictError('This consultation has already started.');
    }

    // Same reasoning as updateVisit: don't re-apply scopedPatientIds at the
    // repository filter level when access was granted via direct nurseIds
    // assignment — for a ward-less nurse it's `[]`, and `$in: []` would match
    // no document even though the visit-level check above already
    // authorized this exact visit.
    const updateFilterPatientIds = isDirectNurseAssignment ? undefined : scopedPatientIds;
    const updated = await opdRepository.update(tenantId, visitId, {
      status: OPDVisitStatus.IN_PROGRESS,
    } as Partial<IOPDVisit>, updateFilterPatientIds);
    if (!updated) throw new NotFoundError('OPD visit not found');

    await auditService.log({
      entityType:    AuditEntityType.OPD_VISIT,
      entityId:      visitId,
      action:        'UPDATE',
      userId:        startedBy,
      tenantId,
      previousValue: { status: visit.status },
      newValue:      { status: OPDVisitStatus.IN_PROGRESS },
    });

    const patient = await patientRepository.findByPatientId(tenantId, updated.patientId);
    return withFullName(updated, patient?.fullName);
  }

  // Resolve visits still sitting on the queue after their date has passed.
  // Without this a visit nobody completed stays OPEN forever, so yesterday's
  // queue keeps rendering as if those patients were still waiting.
  //
  // "Today" is IST midnight, not server midnight, so a server running in UTC
  // never expires the current day's queue during the 18:30–24:00 UTC window.
  // Runs off the queue read rather than a scheduler — the codebase has no cron,
  // and this is self-healing: the first person to open OPD each day clears the
  // backlog. Safe to call from a scheduler later without changing the result.
  async expireStaleVisits(tenantId: string): Promise<number> {
    return opdRepository.markStaleAsNoShow(tenantId, toIstMidnight(new Date()));
  }

  async completeVisit(
    tenantId:          string,
    visitId:           string,
    data:              CompleteOPDVisitRequest,
    completedBy:       string,
    scopedPatientIds?: string[],
  ): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');
    if (scopedPatientIds && !scopedPatientIds.includes(visit.patientId)) {
      throw new NotFoundError('OPD visit not found');
    }

    if (TERMINAL_STATUSES.has(visit.status)) {
      throw new ConflictError(`Cannot complete a visit with status ${visit.status}`);
    }

    const updateData: Partial<IOPDVisit> = {
      status:    OPDVisitStatus.COMPLETED,
      diagnosis: data.diagnosis,
    } as Partial<IOPDVisit>;

    // diagnosis is mandatory to complete a visit (completeVisitSchema enforces
    // non-empty), so this is always a genuine set/finalize — recorded
    // unconditionally, unlike prescription/notes below. The clinical text
    // itself is never recorded — only the fact that one was supplied. See
    // redactClinicalDiff.
    const previousValue: Record<string, unknown> = { status: visit.status, diagnosis: visit.diagnosis };
    const newValue:      Record<string, unknown> = { status: OPDVisitStatus.COMPLETED, diagnosis: data.diagnosis };

    if (data.prescription !== undefined) {
      updateData.prescription = data.prescription;
      if (!isSameFieldValue(visit.prescription, data.prescription)) {
        previousValue.prescription = visit.prescription;
        newValue.prescription      = data.prescription;
      }
    }
    if (data.notes !== undefined) {
      updateData.notes = data.notes;
      if (!isSameFieldValue(visit.notes, data.notes)) {
        previousValue.notes = visit.notes;
        newValue.notes      = data.notes;
      }
    }

    const updated = await opdRepository.update(tenantId, visitId, updateData, scopedPatientIds);
    if (!updated) throw new NotFoundError('OPD visit not found');

    const { previousValue: auditPrevious, newValue: auditNew } = redactClinicalDiff(previousValue, newValue);
    await auditService.log({
      entityType:    AuditEntityType.OPD_VISIT,
      entityId:      visitId,
      action:        'UPDATE',
      userId:        completedBy,
      tenantId,
      previousValue: auditPrevious,
      newValue:      auditNew,
    });

    const patient = await patientRepository.findByPatientId(tenantId, updated.patientId);
    return withFullName(updated, patient?.fullName);
  }

  async cancelVisit(
    tenantId:          string,
    visitId:           string,
    cancelledBy:       string,
    scopedPatientIds?: string[],
  ): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');
    if (scopedPatientIds && !scopedPatientIds.includes(visit.patientId)) {
      throw new NotFoundError('OPD visit not found');
    }

    if (TERMINAL_STATUSES.has(visit.status)) {
      throw new ConflictError(`Cannot cancel a visit with status ${visit.status}`);
    }

    const updated = await opdRepository.update(tenantId, visitId, {
      status: OPDVisitStatus.CANCELLED,
    } as Partial<IOPDVisit>, scopedPatientIds);
    if (!updated) throw new NotFoundError('OPD visit not found');

    await auditService.log({
      entityType:    AuditEntityType.OPD_VISIT,
      entityId:      visitId,
      action:        'UPDATE',
      userId:        cancelledBy,
      tenantId,
      previousValue: { status: visit.status },
      newValue:      { status: OPDVisitStatus.CANCELLED },
    });

    const patient = await patientRepository.findByPatientId(tenantId, updated.patientId);
    return withFullName(updated, patient?.fullName);
  }

  async getQueue(
    tenantId:    string,
    date?:       string,
    doctorId?:   string,
    search?:     string,
    patientIds?: string[],
    nurseId?:    string,
  ): Promise<(IOPDVisit & { fullName?: string })[]> {
    const visitDate = date ? new Date(date) : new Date();

    // Sweep before reading so a stale visit is never rendered as still waiting.
    // Best-effort: a failed sweep must not take the queue down with it.
    try {
      await this.expireStaleVisits(tenantId);
    } catch { /* non-blocking — the queue read is the caller's actual request */ }

    let visits = await opdRepository.findByDate(tenantId, visitDate, doctorId, patientIds, nurseId);

    const visitPatientIds = [...new Set(visits.map((v) => v.patientId))];
    const nameMap = await patientRepository.findNamesByPatientIds(tenantId, visitPatientIds)
      ?? new Map<string, string>();

    const result = visits.map((v) =>
      withFullName(v, nameMap.get(v.patientId) ?? v.fullName ?? v.patientId),
    );

    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re   = new RegExp(safe, 'i');
      return result.filter((v) =>
        re.test(v.fullName ?? '') || re.test(v.patientId),
      );
    }

    return result;
  }

  async getVisitById(tenantId: string, visitId: string): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');
    const patient = await patientRepository.findByPatientId(tenantId, visit.patientId);
    return withFullName(visit, patient?.fullName);
  }

  // Assembles everything OPDController.getParchaPdf needs to render a PDF
  // parcha template: the raw template bytes (fetched from S3) plus the
  // visit's data already shaped into ParchaOverlayInput. Returns null when
  // the tenant has no PDF template configured (no template at all, or an
  // image template — those keep using the existing client-side <img>
  // overlay/default layout, not this endpoint) so the controller can respond
  // 404 and the print page can fall back cleanly.
  async getParchaPdfContext(
    tenantId: string,
    visit:    IOPDVisit,
  ): Promise<{ templateBytes: Buffer; overlay: ParchaOverlayInput } | null> {
    const tenant = await tenantRepository.findById(tenantId);
    const templateKey = tenant?.branding.parchaTemplateUrl ?? null;
    if (!templateKey || !/\.pdf$/i.test(templateKey)) return null;

    const [patient, templateBytes] = await Promise.all([
      patientRepository.findByPatientId(tenantId, visit.patientId),
      s3Service.getFile(templateKey),
    ]);
    if (!patient) throw new NotFoundError('Patient not found');

    const departmentName = visit.departmentId
      ? (await departmentRepository.findById(tenantId, visit.departmentId))?.name ?? null
      : null;
    const doctorNameMap = await userRepository.findNamesByIds(tenantId, visit.doctorIds ?? []);
    const doctorNames = (visit.doctorIds ?? [])
      .map((id) => doctorNameMap.get(id))
      .filter((n): n is string => !!n)
      .join(', ');

    const overlay = buildOpdParchaOverlay(visit, patient, departmentName, doctorNames);
    return { templateBytes, overlay };
  }

  async getPatientHistory(
    tenantId:       string,
    patientId:      string,
    filters:        OpdHistoryFilters,
    scopedPatientIds?: string[],
  ): Promise<PaginatedResult<OPDVisitResponse>> {
    const patient = await patientRepository.findByPatientId(tenantId, patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    if (scopedPatientIds && !scopedPatientIds.includes(patientId)) {
      throw new NotFoundError('Patient not found');
    }

    const result = await opdRepository.findByPatient(tenantId, patientId, filters);

    return {
      ...result,
      data: result.data.map((visit) => ({
        visitId:        visit.visitId,
        tenantId:       visit.tenantId,
        patientId:      visit.patientId,
        fullName:       patient.fullName,
        doctorIds:      visit.doctorIds,
        nurseIds:       visit.nurseIds ?? [],
        visitDate:      visit.visitDate,
        queueNumber:    visit.queueNumber,
        status:         visit.status,
        diagnosis:      visit.diagnosis,
        prescription:   visit.prescription,
        notes:          visit.notes,
        // findByPatient reads via .lean() for its search path, which
        // bypasses Mongoose's schema-default hydration — a legacy row saved
        // before vitals existed would otherwise come back with `vitals`
        // missing entirely instead of the fully-shaped null object every
        // other read path guarantees.
        vitals:         visit.vitals ?? DEFAULT_VITALS,
        createdAt:      visit.createdAt,
        updatedAt:      visit.updatedAt,
      })),
    };
  }

  // ─── OPD Nurse Assignment ───────────────────────────────────────────────────

  // Nurses eligible for OPD duty: active NURSE-role users in this tenant who
  // are not currently on any ward's roster (Ward.assignedNurseIds is the
  // source of truth for "on IPD duty" — see ipdRepository.findAssignedNurseIds).
  async getAvailableOpdNurses(tenantId: string): Promise<AvailableOpdNurseResponse[]> {
    const [{ data: nurses }, wardAssignedIds] = await Promise.all([
      userRepository.findAll(tenantId, { role: UserRole.NURSE, isActive: true }, 1, 500),
      ipdRepository.findAssignedNurseIds(tenantId),
    ]);
    const onWardDuty = new Set(wardAssignedIds);
    return nurses
      .filter((n) => !onWardDuty.has((n as { _id: { toString(): string } })._id.toString()))
      .map((n) => ({
        userId: (n as { _id: { toString(): string } })._id.toString(),
        name:   n.name,
        email:  n.email,
      }));
  }

  // Every nurse currently mapped to this doctor for OPD duty (a doctor can
  // have more than one), each flagged with whether they're still
  // available — false when they've since been picked up for IPD ward duty,
  // so the frontend can flag the suggestion rather than silently reuse it.
  async getDoctorNurseAssignments(tenantId: string, doctorId: string): Promise<DoctorNurseAssignmentsResponse> {
    const assignments = await opdRepository.findNurseAssignmentsByDoctor(tenantId, doctorId);
    if (!assignments.length) {
      return { doctorId, nurses: [] };
    }

    const nurseIds = assignments.map((a) => a.nurseId);
    const [nameMap, wardAssignedIds] = await Promise.all([
      userRepository.findNamesByIds(tenantId, nurseIds),
      ipdRepository.findAssignedNurseIds(tenantId),
    ]);
    const onWardDuty = new Set(wardAssignedIds);

    return {
      doctorId,
      nurses: assignments.map((a) => ({
        nurseId:     a.nurseId,
        nurseName:   nameMap.get(a.nurseId) ?? null,
        isAvailable: !onWardDuty.has(a.nurseId),
      })),
    };
  }

  // ─── OPD payment validity (Hospital-configurable validity window) ──────────
  //
  // Rule: a completed OPD payment covers this patient *for the doctor(s) it
  // was paid against* for `opdSettings.validityDays` calendar days *after*
  // the day it was made (inclusive of both the payment day and the last
  // covered day) — e.g. a payment made on day 0 with validityDays=15 covers
  // days 0 through 15 inclusive; day 16 is the first day a new payment is
  // required. Day boundaries are computed in IST (hospital-local), matching
  // the rest of the day-bucketed logic in this codebase (see
  // attendance.timezone.ts), so a server running in UTC never mis-expires a
  // payment near midnight IST.
  //
  // Validity is doctor-specific, not department-specific: when `doctorIds` is
  // given, only a payment tied to a visit that included every one of those
  // doctors can grant validity — a still-valid payment for a *different*
  // doctor never covers a visit to a new doctor. When no doctor has been
  // selected yet (`doctorIds` empty), the check falls back to the patient's
  // most recent completed OPD payment regardless of doctor, matching the
  // pre-selection UI state.
  //
  // This is the sole source of truth the frontend must defer to — it must
  // never compute "is this payment still valid" locally.
  async getPaymentValidity(
    tenantId:   string,
    patientId:  string,
    doctorIds:  string[] = [],
  ): Promise<OPDPaymentValidityResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const { validityDays } = await tenantService.getOpdSettings(tenantId);

    const hasDoctors = doctorIds.length > 0;
    const latestPayment = hasDoctors
      ? await paymentRepository.findLatestCompletedByPatientDoctorsAndReferenceType(
          tenantId, patientId, doctorIds, PaymentReferenceType.OPD_VISIT,
        )
      : await paymentRepository.findLatestCompletedByPatientAndReferenceType(
          tenantId, patientId, PaymentReferenceType.OPD_VISIT,
        );

    if (!latestPayment) {
      // No payment tied to the requested doctor(s). If the patient has a
      // completed OPD payment at all, it just doesn't cover this doctor —
      // that's a DIFFERENT_DOCTOR case, not a brand-new patient, and a new
      // payment is required regardless of that other payment's validity window.
      const reason = hasDoctors && await paymentRepository.findLatestCompletedByPatientAndReferenceType(
        tenantId, patientId, PaymentReferenceType.OPD_VISIT,
      )
        ? OPDPaymentValidityReason.DIFFERENT_DOCTOR
        : OPDPaymentValidityReason.NO_PAYMENT;

      return {
        patientId,
        paymentRequired:  true,
        reason,
        latestPaymentId:  null,
        latestPaymentDate: null,
        validUntil:        null,
        validityDays,
      };
    }

    const paymentDay = toIstMidnight(latestPayment.createdAt);
    const validUntil = new Date(paymentDay.getTime() + validityDays * MS_PER_DAY);
    const today       = toIstMidnight(new Date());

    const isValid = today.getTime() <= validUntil.getTime();

    return {
      patientId,
      paymentRequired:   !isValid,
      reason:            isValid ? OPDPaymentValidityReason.VALID : OPDPaymentValidityReason.EXPIRED,
      latestPaymentId:   latestPayment.paymentId,
      latestPaymentDate: latestPayment.createdAt,
      validUntil,
      validityDays,
    };
  }

  // ─── Role-based access scope resolution ─────────────────────────────────────

  // A Nurse sees OPD visits/patients whose patient is currently admitted
  // (active IPD admission) in their assigned ward(s) — IPDService's canonical
  // ward-scoping. This is patient-level by design: a ward nurse sees every
  // visit for a patient currently in her care, regardless of that visit's own
  // nurseIds.
  //
  // Direct per-visit assignment (this exact visit lists the nurse in its own
  // nurseIds) is a *separate*, visit-level grant — deliberately NOT folded
  // into this patient-level set. It's enforced at the query/record level
  // instead (see OPDRepository.findByDate's nurseId param, the per-visit
  // nurseIds check in updateVisit/startConsultation below, and the getVisit
  // controller). Merging it in here would let being assigned to one visit for
  // a patient leak visibility into that patient's other, unrelated visits —
  // exactly the bug this split avoids.
  //
  // Returns undefined for any other role.
  async resolveNursePatientIds(
    tenantId: string,
    userId:   string,
    role:     UserRole,
  ): Promise<string[] | undefined> {
    if (role !== UserRole.NURSE) return undefined;
    return ipdService.resolveNursePatientIds(tenantId, userId, role);
  }

  // A Doctor only sees OPD visits/history for patients they've been assigned
  // to — via an OPD visit (doctorIds) or an IPD admission (assignedDoctorIds),
  // current or past. Returns undefined for any other role.
  async resolveDoctorPatientIds(
    tenantId: string,
    userId:   string,
    role:     UserRole,
  ): Promise<string[] | undefined> {
    return ipdService.resolveDoctorPatientIds(tenantId, userId, role);
  }

  // Nurse/Doctor scoped patient IDs for mutation guards (update/complete/cancel).
  // Returns undefined for any other role (no restriction applied).
  async resolveMutationScopedPatientIds(
    tenantId: string,
    userId:   string,
    role:     UserRole,
  ): Promise<string[] | undefined> {
    if (role === UserRole.NURSE)  return this.resolveNursePatientIds(tenantId, userId, role);
    if (role === UserRole.DOCTOR) return this.resolveDoctorPatientIds(tenantId, userId, role);
    return undefined;
  }
}

export const opdService = new OPDService();
