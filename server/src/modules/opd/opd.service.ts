import { v4 as uuidv4 } from 'uuid';
import { opdRepository, OpdHistoryFilters } from './opd.repository';
import { ipdService } from '../ipd/ipd.service';
import { patientRepository } from '../patient/patient.repository';
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
} from './opd.types';

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
