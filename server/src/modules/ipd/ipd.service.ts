import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ipdRepository } from './ipd.repository';
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
} from './ipd.types';

import { patientRepository } from '../patient/patient.repository';
import { userRepository }    from '../user/user.repository';
import { auditService }      from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import {
  AppError,
  ConflictError,
  NotFoundError,
} from '../../shared/middleware/error-handler';
import { PatientModel } from '../patient/patient.model';


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

function toResponse(doc: IIPDAdmission, fullName: string | null = null): AdmissionResponse {
  return {
    admissionId:      doc.admissionId,
    patientId:        doc.patientId,
    fullName,
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

    // [6] Verify assignedDoctorId is a Doctor in this tenant
    const doctor = await userRepository.findById(tenantId, input.assignedDoctorId);
    if (!doctor || doctor.role !== UserRole.DOCTOR) {
      throw new AppError('Assigned user is not a Doctor in this tenant', 400);
    }

    // [7] Create admission — denormalize ward.name and bed.bedNumber at write time
    const admission = await ipdRepository.save({
      admissionId:      uuidv4(),
      patientId:        input.patientId,
      wardId:           input.wardId,
      bedId:            input.bedId,
      bedNumber:        bed.bedNumber,
      wardName:         ward.name,           // U3-A IWard uses .name, not .wardName
      assignedDoctorId: input.assignedDoctorId,
      status:           AdmissionStatus.ADMITTED,
      admissionDate:    new Date(),
      dischargeDate:    null,
      progressNotes:    [],
      tenantId,
    });

    // [8] Mark bed as occupied (advisory cache; conflict arbiter is IPD collection)
    try {
      await ipdRepository.updateBedOccupancy(tenantId, input.bedId, true, admission.admissionId);
    } catch (err) {
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
        newValue:   { patientId: input.patientId, wardId: input.wardId, bedId: input.bedId, status: AdmissionStatus.ADMITTED },
      });
    } catch { /* swallow — audit failure must not block primary response */ }

    return toResponse(admission, patient.fullName);
  }

  async getAdmissionById(admissionId: string, tenantId: string): Promise<AdmissionResponse> {
    const admission = await ipdRepository.findById(admissionId, tenantId);
    if (!admission) throw new NotFoundError('Admission not found');
    const patient = await patientRepository.findByPatientId(tenantId, admission.patientId);
    return toResponse(admission, patient?.fullName ?? null);
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
    return toResponse(updated, patient?.fullName ?? null);
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
    return toResponse(updated, patient?.fullName ?? null);
  }

  async listAdmissions(
    tenantId: string,
    query:    ListAdmissionsQuery,
  ): Promise<PaginatedResult<AdmissionResponse>> {
    const result = await ipdRepository.findActiveAdmissions(tenantId, query);
    const admissions = result.data;

    const patientIds = admissions.map(a => a.patientId);

    const patients = await PatientModel.find({
      tenantId,
      patientId: { $in: patientIds },
    }).lean();

    const map = new Map(patients.map(p => [p.patientId, p.fullName]));

    return {
      ...result,
      data: result.data.map((admission) =>
        toResponse(admission, map.get(admission.patientId) ?? null),
      ),
    };
  }

  async getBedOccupancySummary(tenantId: string): Promise<WardOccupancySummary[]> {
    // Delegates to U3-A's aggregation-based occupancy query (single DB round-trip)
    return ipdRepository.getOccupancySummary(tenantId);
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
