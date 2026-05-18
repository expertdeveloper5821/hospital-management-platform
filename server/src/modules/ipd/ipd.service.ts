import { v4 as uuidv4 } from 'uuid';
import { ipdRepository } from './ipd.repository';
import { IIPDAdmission } from './ipd.model';
import {
  AdmissionStatus,
  AdmissionResponse,
  BedOccupancySummaryItem,
  CreateAdmissionInput,
  AddProgressNoteInput,
  ListAdmissionsQuery,
} from './ipd.types';

// U3-A cross-module imports — Ward and Bed repositories owned by U3-A subunit
import { wardRepository } from './ward.repository';
import { bedRepository }  from './bed.repository';

import { patientRepository } from '../patient/patient.repository';
import { userRepository }    from '../user/user.repository';
import { auditService }      from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import {
  AppError,
  NotFoundError,
} from '../../shared/middleware/error-handler';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toResponse(doc: IIPDAdmission): AdmissionResponse {
  return {
    admissionId:      doc.admissionId,
    patientId:        doc.patientId,
    wardId:           doc.wardId,
    wardName:         doc.wardName,
    bedId:            doc.bedId,
    bedNumber:        doc.bedNumber,
    assignedDoctorId: doc.assignedDoctorId,
    status:           doc.status,
    admissionDate:    doc.admissionDate.toISOString(),
    dischargeDate:    doc.dischargeDate ? doc.dischargeDate.toISOString() : null,
    progressNotes:    doc.progressNotes,
  };
}

// ─── IPDService ───────────────────────────────────────────────────────────────

export class IPDService {
  async createAdmission(
    input:    CreateAdmissionInput,
    tenantId: string,
    userId:   string,
  ): Promise<AdmissionResponse> {
    // [1] Verify patient exists in this tenant
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    // [2] Verify ward exists in this tenant
    const ward = await wardRepository.findById(input.wardId, tenantId);
    if (!ward) throw new NotFoundError('Ward not found');

    // [3] Verify bed exists in this tenant
    const bed = await bedRepository.findById(input.bedId, tenantId);
    if (!bed) throw new NotFoundError('Bed not found');

    // [4] Confirm bed belongs to the specified ward
    if (bed.wardId !== input.wardId) {
      throw new AppError('Bed does not belong to specified ward', 400);
    }

    // [5] Check for active admission on this bed (authoritative conflict check)
    const existing = await ipdRepository.findActiveAdmissionByBed(input.bedId, tenantId);
    if (existing) {
      throw new AppError(
        `Bed is currently occupied. Occupant admission ID: ${existing.admissionId}`,
        409,
      );
    }

    // [6] Verify assignedDoctorId is a Doctor in this tenant
    const doctor = await userRepository.findById(input.assignedDoctorId, tenantId);
    if (!doctor || doctor.role !== UserRole.DOCTOR) {
      throw new AppError('Assigned user is not a Doctor in this tenant', 400);
    }

    // [7] Create admission
    const admission = await ipdRepository.save({
      admissionId:      uuidv4(),
      patientId:        input.patientId,
      wardId:           input.wardId,
      bedId:            input.bedId,
      bedNumber:        bed.bedNumber,
      wardName:         ward.wardName,
      assignedDoctorId: input.assignedDoctorId,
      status:           AdmissionStatus.ADMITTED,
      admissionDate:    new Date(),
      dischargeDate:    null,
      progressNotes:    [],
      tenantId,
    });

    // [8] Mark bed as occupied
    try {
      await bedRepository.setOccupied(input.bedId, true, tenantId);
    } catch (err) {
      // Log critical inconsistency — admission saved but bed flag stale
      console.error('CRITICAL: Admission saved but bed flag update failed', {
        admissionId: admission.admissionId,
        bedId:       input.bedId,
        error:       (err as Error).message,
      });
      throw new AppError(
        'Admission created but bed status could not be updated. Please contact support.',
        500,
      );
    }

    // [9] Audit log (non-blocking)
    try {
      await auditService.log({
        entityType: AuditEntityType.IPD_ADMISSION,
        entityId:   admission.admissionId,
        action:     'CREATE',
        userId,
        tenantId,
        newValue:   {
          patientId:        input.patientId,
          wardId:           input.wardId,
          bedId:            input.bedId,
          status:           AdmissionStatus.ADMITTED,
        },
      });
    } catch {
      // swallow — audit failure must not block primary response
    }

    return toResponse(admission);
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

    return toResponse(updated);
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

    // Release bed
    try {
      await bedRepository.setOccupied(admission.bedId, false, tenantId);
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
    } catch {
      // swallow
    }

    return toResponse(updated);
  }

  async listAdmissions(
    tenantId: string,
    query:    ListAdmissionsQuery,
  ): Promise<PaginatedResult<AdmissionResponse>> {
    const result = await ipdRepository.findActiveAdmissions(tenantId, query);
    return {
      ...result,
      data: result.data.map(toResponse),
    };
  }

  async getBedOccupancySummary(tenantId: string): Promise<BedOccupancySummaryItem[]> {
    const wards = await wardRepository.listWards(tenantId);

    const summary = await Promise.all(
      wards.map(async (ward) => {
        const beds     = await bedRepository.findByWard(ward.wardId, tenantId);
        const total    = beds.length;
        const occupied = beds.filter((b) => b.isOccupied).length;
        return {
          wardId:    ward.wardId,
          wardName:  ward.wardName,
          total,
          occupied,
          available: total - occupied,  // invariant: total === occupied + available
        };
      }),
    );

    return summary;
  }
}

export const ipdService = new IPDService();
