import { v4 as uuidv4 } from 'uuid';
import { opdRepository, OpdHistoryFilters } from './opd.repository';
import { ipdService } from '../ipd/ipd.service';
import { ipdRepository } from '../ipd/ipd.repository';
import { patientRepository } from '../patient/patient.repository';
import { paymentRepository } from '../payment/payment.repository';
import { PaymentReferenceType } from '../payment/payment.types';
import { departmentService } from '../department/department.service';
import { tenantService } from '../tenant/tenant.service';
import { userRepository } from '../user/user.repository';
import { toIstMidnight } from '../attendance/attendance.timezone';
import { IOPDVisit } from './opd.model';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import { auditService } from '../../shared/services/audit.service';
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
// changed, not what it changed to/from. Applied to both previousValue and
// newValue. `vitals` is an object, not a scalar, but redactClinicalFields
// below replaces it wholesale with the same marker regardless of shape.
const REDACTED_AUDIT_FIELDS = ['diagnosis', 'prescription', 'notes', 'vitals'] as const;
const REDACTED_MARKER = '[redacted]';

function redactClinicalFields(values: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...values };
  for (const field of REDACTED_AUDIT_FIELDS) {
    if (redacted[field] !== undefined && redacted[field] !== null) {
      redacted[field] = REDACTED_MARKER;
    }
  }
  return redacted;
}

function withFullName<T extends IOPDVisit>(visit: T, fullName?: string): T & { fullName?: string } {
  return Object.assign(visit, { fullName });
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
        previousValue[key] = (visit as unknown as Record<string, unknown>)[key];
        newValue[key]      = (data as Record<string, unknown>)[key];
        (updateData as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
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
      previousValue.vitals = existingVitals;
      newValue.vitals      = mergedVitals;
      updateData.vitals    = mergedVitals;
    }

    // Re-stamp departmentId whenever the doctor assignment changes — otherwise
    // a visit that started with no doctor (or a different doctor's department)
    // would keep a stale/null department after reassignment, same gap IPD's
    // admission update already closes for assignedDoctorIds.
    if (data.doctorIds !== undefined) {
      previousValue.departmentId = visit.departmentId;
      const departmentId = await departmentService.resolveDepartmentFromDoctorIds(tenantId, data.doctorIds);
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
    // date is changing — an edit can create the same clash a create can.
    if (data.doctorIds !== undefined || data.visitDate !== undefined) {
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

    await auditService.log({
      entityType: AuditEntityType.OPD_VISIT,
      entityId:   visitId,
      action:     'UPDATE',
      userId:     updatedBy,
      tenantId,
      previousValue: redactClinicalFields(previousValue),
      newValue:      redactClinicalFields(newValue),
    });

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
    if (data.prescription !== undefined) updateData.prescription = data.prescription;
    if (data.notes        !== undefined) updateData.notes        = data.notes;

    const updated = await opdRepository.update(tenantId, visitId, updateData, scopedPatientIds);
    if (!updated) throw new NotFoundError('OPD visit not found');

    await auditService.log({
      entityType:    AuditEntityType.OPD_VISIT,
      entityId:      visitId,
      action:        'UPDATE',
      userId:        completedBy,
      tenantId,
      previousValue: { status: visit.status },
      // The diagnosis itself is deliberately not recorded here — only the fact
      // that one was supplied. See redactClinicalFields.
      newValue:      { status: OPDVisitStatus.COMPLETED, diagnosis: REDACTED_MARKER },
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
