import { v4 as uuidv4 } from 'uuid';
import { opdRepository, OpdHistoryFilters } from './opd.repository';
import { ipdService } from '../ipd/ipd.service';
import { patientRepository } from '../patient/patient.repository';
import { paymentRepository } from '../payment/payment.repository';
import { PaymentReferenceType } from '../payment/payment.types';
import { tenantService } from '../tenant/tenant.service';
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
} from './opd.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function withFullName<T extends IOPDVisit>(visit: T, fullName?: string): T & { fullName?: string } {
  return Object.assign(visit, { fullName });
}

// Roles trusted to record a backdated OPD visit (e.g. paper-register backfill).
// Every other role is restricted to today/future dates.
const BACKDATE_ALLOWED_ROLES: ReadonlySet<UserRole> = new Set([UserRole.HOSPITAL_ADMIN]);

function isPastDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
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

    const visitDate = data.visitDate ? new Date(data.visitDate) : new Date();
    visitDate.setHours(0, 0, 0, 0);
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

    const visit = await opdRepository.save({
      visitId,
      tenantId,
      patientId:      data.patientId,
      doctorIds,
      departmentId:   patient.departmentId ?? null,
      visitDate,
      queueNumber,
      status:         OPDVisitStatus.OPEN,
      notes:          data.notes         ?? null,
      diagnosis:      null,
      prescription:   null,
    });

    await auditService.log({
      entityType: AuditEntityType.OPD_VISIT,
      entityId:   visitId,
      action:     'CREATE',
      userId:     createdBy,
      tenantId,
      newValue:   { visitId, patientId: data.patientId, status: OPDVisitStatus.OPEN },
    });

    return withFullName(visit, patient.fullName);
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
    if (scopedPatientIds && !scopedPatientIds.includes(visit.patientId)) {
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

    // visitDate needs Date conversion and may require a new queue number
    if (data.visitDate !== undefined) {
      const newDate = new Date(data.visitDate);
      newDate.setHours(0, 0, 0, 0);
      assertNotPastDateUnlessAuthorized(newDate, role);

      previousValue.visitDate = visit.visitDate;
      newValue.visitDate      = newDate;
      updateData.visitDate    = newDate;

      const existingDate = new Date(visit.visitDate);
      existingDate.setHours(0, 0, 0, 0);
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

    const updated = await opdRepository.update(tenantId, visitId, updateData, scopedPatientIds);
    if (!updated) throw new NotFoundError('OPD visit not found');

    await auditService.log({
      entityType: AuditEntityType.OPD_VISIT,
      entityId:   visitId,
      action:     'UPDATE',
      userId:     updatedBy,
      tenantId,
      previousValue,
      newValue,
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
    scopedPatientIds?: string[],
  ): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');
    if (scopedPatientIds && !scopedPatientIds.includes(visit.patientId)) {
      throw new NotFoundError('OPD visit not found');
    }

    if (TERMINAL_STATUSES.has(visit.status)) {
      throw new ConflictError(`Cannot start a visit with status ${visit.status}`);
    }
    if (visit.status === OPDVisitStatus.IN_PROGRESS) {
      throw new ConflictError('This consultation has already started.');
    }

    const updated = await opdRepository.update(tenantId, visitId, {
      status: OPDVisitStatus.IN_PROGRESS,
    } as Partial<IOPDVisit>, scopedPatientIds);
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
      newValue:      { status: OPDVisitStatus.COMPLETED, diagnosis: data.diagnosis },
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
  ): Promise<(IOPDVisit & { fullName?: string })[]> {
    const visitDate = date ? new Date(date) : new Date();

    // Sweep before reading so a stale visit is never rendered as still waiting.
    // Best-effort: a failed sweep must not take the queue down with it.
    try {
      await this.expireStaleVisits(tenantId);
    } catch { /* non-blocking — the queue read is the caller's actual request */ }

    let visits = await opdRepository.findByDate(tenantId, visitDate, doctorId, patientIds);

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
        visitDate:      visit.visitDate,
        queueNumber:    visit.queueNumber,
        status:         visit.status,
        diagnosis:      visit.diagnosis,
        prescription:   visit.prescription,
        notes:          visit.notes,
        createdAt:      visit.createdAt,
        updatedAt:      visit.updatedAt,
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
  // Delegates to IPDService's canonical implementation — nurse ward
  // assignment and doctor-patient assignment are IPD/OPD admission data that
  // IPDService already owns, so the logic isn't duplicated here.

  // A Nurse only sees OPD visits for patients currently admitted (active IPD
  // admission) in their assigned ward(s). Returns undefined for any other role.
  async resolveNursePatientIds(
    tenantId: string,
    userId:   string,
    role:     UserRole,
  ): Promise<string[] | undefined> {
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
