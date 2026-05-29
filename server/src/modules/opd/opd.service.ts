import { v4 as uuidv4 } from 'uuid';
import { opdRepository, OpdHistoryFilters } from './opd.repository';
import { patientRepository } from '../patient/patient.repository';
import { IOPDVisit } from './opd.model';
import { AuditEntityType, PaginatedResult } from '../../shared/types/common.types';
import { auditService } from '../../shared/services/audit.service';
import { NotFoundError, ConflictError } from '../../shared/middleware/error-handler';
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

export class OPDService {
  async createVisit(
    tenantId:  string,
    data:      CreateOPDVisitRequest,
    createdBy: string,
  ): Promise<IOPDVisit & { fullName?: string }> {
    const patient = await patientRepository.findByPatientId(tenantId, data.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const visitDate = data.visitDate ? new Date(data.visitDate) : new Date();
    visitDate.setHours(0, 0, 0, 0);

    const queueNumber = (await opdRepository.countByDate(tenantId, visitDate)) + 1;
    const visitId = `OPD-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`;

    const visit = await opdRepository.save({
      visitId,
      tenantId,
      patientId:      data.patientId,
      doctorId:       data.doctorId      ?? null,
      visitDate,
      queueNumber,
      status:         OPDVisitStatus.OPEN,
      chiefComplaint: data.chiefComplaint,
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
    tenantId:  string,
    visitId:   string,
    data:      UpdateOPDVisitRequest,
    updatedBy: string,
  ): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');

    if (TERMINAL_STATUSES.has(visit.status)) {
      throw new ConflictError(`Cannot update a visit with status ${visit.status}`);
    }

    const updateData:    Partial<IOPDVisit>        = {};
    const previousValue: Record<string, unknown> = {};
    const newValue:      Record<string, unknown> = {};

    const fields = ['chiefComplaint', 'doctorId', 'diagnosis', 'prescription', 'notes'] as const;
    for (const key of fields) {
      if (data[key] !== undefined) {
        previousValue[key] = (visit as unknown as Record<string, unknown>)[key];
        newValue[key]      = data[key];
        (updateData as Record<string, unknown>)[key] = data[key];
      }
    }

    // visitDate needs Date conversion and may require a new queue number
    if (data.visitDate !== undefined) {
      const newDate = new Date(data.visitDate);
      newDate.setHours(0, 0, 0, 0);

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

    const updated = await opdRepository.update(tenantId, visitId, updateData);
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
    tenantId:    string,
    visitId:     string,
    data:        CompleteOPDVisitRequest,
    completedBy: string,
  ): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');

    if (TERMINAL_STATUSES.has(visit.status)) {
      throw new ConflictError(`Cannot complete a visit with status ${visit.status}`);
    }

    const updateData: Partial<IOPDVisit> = {
      status:    OPDVisitStatus.COMPLETED,
      diagnosis: data.diagnosis,
    } as Partial<IOPDVisit>;
    if (data.prescription !== undefined) updateData.prescription = data.prescription;
    if (data.notes        !== undefined) updateData.notes        = data.notes;

    const updated = await opdRepository.update(tenantId, visitId, updateData);
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
    tenantId:    string,
    visitId:     string,
    cancelledBy: string,
  ): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');

    if (TERMINAL_STATUSES.has(visit.status)) {
      throw new ConflictError(`Cannot cancel a visit with status ${visit.status}`);
    }

    const updated = await opdRepository.update(tenantId, visitId, {
      status: OPDVisitStatus.CANCELLED,
    } as Partial<IOPDVisit>);
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
    tenantId: string,
    date?:     string,
    doctorId?: string,
  ): Promise<(IOPDVisit & { fullName?: string })[]> {
    const visitDate = date ? new Date(date) : new Date();
    const visits = (await opdRepository.findByDate(tenantId, visitDate, doctorId))
      .filter((visit) =>
        visit.status === OPDVisitStatus.OPEN || visit.status === OPDVisitStatus.IN_PROGRESS,
      );

    const patientIds = [...new Set(visits.map((v) => v.patientId))];
    const nameMap = await patientRepository.findNamesByPatientIds(tenantId, patientIds)
      ?? new Map<string, string>();

    return visits.map((v) =>
      withFullName(v, nameMap.get(v.patientId) ?? v.fullName ?? v.patientId),
    );
  }

  async getVisitById(tenantId: string, visitId: string): Promise<IOPDVisit & { fullName?: string }> {
    const visit = await opdRepository.findByVisitId(tenantId, visitId);
    if (!visit) throw new NotFoundError('OPD visit not found');
    const patient = await patientRepository.findByPatientId(tenantId, visit.patientId);
    return withFullName(visit, patient?.fullName);
  }

  async getPatientHistory(
    tenantId:  string,
    patientId: string,
    filters:   OpdHistoryFilters,
  ): Promise<PaginatedResult<OPDVisitResponse>> {
    const patient = await patientRepository.findByPatientId(tenantId, patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const result = await opdRepository.findByPatient(tenantId, patientId, filters);

    return {
      ...result,
      data: result.data.map((visit) => ({
        visitId:        visit.visitId,
        tenantId:       visit.tenantId,
        patientId:      visit.patientId,
        fullName:       patient.fullName,
        doctorId:       visit.doctorId,
        visitDate:      visit.visitDate,
        queueNumber:    visit.queueNumber,
        status:         visit.status,
        chiefComplaint: visit.chiefComplaint,
        diagnosis:      visit.diagnosis,
        prescription:   visit.prescription,
        notes:          visit.notes,
        createdAt:      visit.createdAt,
        updatedAt:      visit.updatedAt,
      })),
    };
  }
}

export const opdService = new OPDService();
