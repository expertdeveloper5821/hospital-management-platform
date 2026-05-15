import { ipdRepository }  from './ipd.repository';
import { IWard }           from './ward.model';
import { IBed }            from './bed.model';
import { auditService }    from '../../shared/services/audit.service';
import { AuditEntityType } from '../../shared/types/common.types';
import {
  ConflictError,
  NotFoundError,
} from '../../shared/middleware/error-handler';
import { CreateWardRequest, AddBedsRequest, WardOccupancySummary } from './ipd.types';
import mongoose from 'mongoose';

// Thrown when a bed is already occupied — carries the occupant admission ID (FR-08.4)
export class BedOccupiedError extends Error {
  readonly statusCode = 409;
  constructor(
    public readonly bedNumber:           string,
    public readonly currentAdmissionId:  string,
  ) {
    super(`Bed ${bedNumber} is already occupied by admission ${currentAdmissionId}`);
    this.name = 'BedOccupiedError';
  }
}

export class IpdService {

  // ─── Ward ──────────────────────────────────────────────────────────────────

  async createWard(
    tenantId: string,
    data:     CreateWardRequest,
    actorId:  string,
  ): Promise<IWard> {
    const existing = await ipdRepository.findWardByName(tenantId, data.name);
    if (existing) throw new ConflictError(`Ward "${data.name}" already exists`);

    const ward = await ipdRepository.createWard({ tenantId, name: data.name, floor: data.floor });

    await auditService.log({
      entityType: AuditEntityType.IPD_ADMISSION,
      entityId:   (ward._id as mongoose.Types.ObjectId).toString(),
      action:     'CREATE',
      userId:     actorId,
      tenantId,
      newValue:   { name: ward.name, floor: ward.floor },
    });

    return ward;
  }

  async listWards(tenantId: string): Promise<IWard[]> {
    return ipdRepository.listWards(tenantId);
  }

  // ─── Bed ───────────────────────────────────────────────────────────────────

  async addBedsToWard(
    tenantId:   string,
    wardId:     string,
    data:       AddBedsRequest,
    actorId:    string,
  ): Promise<IBed[]> {
    const ward = await ipdRepository.findWardById(tenantId, wardId);
    if (!ward) throw new NotFoundError('Ward not found');

    const created: IBed[] = [];
    const duplicates: string[] = [];

    for (const bedNumber of data.bedNumbers) {
      const existing = await ipdRepository.findBedByNumber(tenantId, wardId, bedNumber);
      if (existing) {
        duplicates.push(bedNumber);
        continue;
      }
      const bed = await ipdRepository.addBed({ tenantId, wardId, bedNumber });
      created.push(bed);
    }

    if (duplicates.length > 0 && created.length === 0) {
      throw new ConflictError(`Bed(s) already exist in this ward: ${duplicates.join(', ')}`);
    }

    if (created.length > 0) {
      await auditService.log({
        entityType: AuditEntityType.IPD_ADMISSION,
        entityId:   wardId,
        action:     'UPDATE',
        userId:     actorId,
        tenantId,
        newValue:   { addedBeds: created.map((b) => b.bedNumber), skipped: duplicates },
      });
    }

    return created;
  }

  async listBedsInWard(tenantId: string, wardId: string): Promise<IBed[]> {
    const ward = await ipdRepository.findWardById(tenantId, wardId);
    if (!ward) throw new NotFoundError('Ward not found');
    return ipdRepository.listBedsInWard(tenantId, wardId);
  }

  // ─── Occupancy (FR-08.8) ───────────────────────────────────────────────────

  async getOccupancySummary(tenantId: string): Promise<WardOccupancySummary[]> {
    return ipdRepository.getOccupancySummary(tenantId);
  }

  // ─── Bed conflict check — used by U3-B admission service ──────────────────

  async assertBedAvailable(tenantId: string, wardId: string, bedNumber: string): Promise<IBed> {
    const bed = await ipdRepository.findBedByNumber(tenantId, wardId, bedNumber);
    if (!bed) throw new NotFoundError(`Bed ${bedNumber} not found in ward`);

    if (bed.isOccupied) {
      throw new BedOccupiedError(bedNumber, bed.currentAdmissionId!);
    }

    return bed;
  }
}

export const ipdService = new IpdService();
