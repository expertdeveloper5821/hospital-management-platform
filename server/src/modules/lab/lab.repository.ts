import { PathologyRequestModel, IPathologyRequest } from './lab.model';
import { RadiologyRequestModel, IRadiologyRequest } from './lab.model';
import { ListLabRequestsQuery } from './lab.types';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class LabRepository {

  // ─── Pathology ─────────────────────────────────────────────────────────────

  async findPathologyById(requestId: string, tenantId: string): Promise<IPathologyRequest | null> {
    assertDbConnected();
    return PathologyRequestModel.findOne({ requestId, tenantId, isDeleted: { $ne: true } });
  }

  async findPendingPathology(tenantId: string): Promise<IPathologyRequest[]> {
    assertDbConnected();
    return PathologyRequestModel
      .find({ tenantId, status: 'PENDING', isDeleted: { $ne: true } })
      .sort({ requestedAt: 1 });
  }

  async findPathologyByPatient(
    tenantId:   string,
    query:      ListLabRequestsQuery,
    patientIds?: string[],
  ): Promise<PaginatedResult<IPathologyRequest>> {
    assertDbConnected();
    const { patientId, status, page, limit } = query;
    const skip   = (page - 1) * limit;
    const filter: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
    if (patientIds)       filter['patientId'] = { $in: patientIds };
    else if (patientId)   filter['patientId'] = patientId;
    if (status)           filter['status']    = status;

    const [data, total] = await Promise.all([
      PathologyRequestModel.find(filter).sort({ requestedAt: -1 }).skip(skip).limit(limit),
      PathologyRequestModel.countDocuments(filter),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async savePathology(data: Partial<IPathologyRequest>): Promise<IPathologyRequest> {
    assertDbConnected();
    return PathologyRequestModel.create(data);
  }

  async updatePathology(
    requestId: string,
    tenantId:  string,
    update:    Partial<Pick<IPathologyRequest, 'status' | 'reportS3Key' | 'testType' | 'notes' | 'priority'>>,
  ): Promise<IPathologyRequest | null> {
    assertDbConnected();
    return PathologyRequestModel.findOneAndUpdate(
      { requestId, tenantId, isDeleted: { $ne: true } },
      { $set: update },
      { new: true },
    );
  }

  async softDeletePathology(requestId: string, tenantId: string): Promise<IPathologyRequest | null> {
    assertDbConnected();
    return PathologyRequestModel.findOneAndUpdate(
      { requestId, tenantId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
  }

  // ─── Radiology ─────────────────────────────────────────────────────────────

  async findRadiologyById(requestId: string, tenantId: string): Promise<IRadiologyRequest | null> {
    assertDbConnected();
    return RadiologyRequestModel.findOne({ requestId, tenantId, isDeleted: { $ne: true } });
  }

  async findPendingRadiology(tenantId: string): Promise<IRadiologyRequest[]> {
    assertDbConnected();
    return RadiologyRequestModel
      .find({ tenantId, status: 'PENDING', isDeleted: { $ne: true } })
      .sort({ requestedAt: 1 });
  }

  async findRadiologyByPatient(
    tenantId:    string,
    query:       ListLabRequestsQuery,
    patientIds?: string[],
  ): Promise<PaginatedResult<IRadiologyRequest>> {
    assertDbConnected();
    const { patientId, status, page, limit } = query;
    const skip   = (page - 1) * limit;
    const filter: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
    if (patientIds)       filter['patientId'] = { $in: patientIds };
    else if (patientId)   filter['patientId'] = patientId;
    if (status)           filter['status']    = status;

    const [data, total] = await Promise.all([
      RadiologyRequestModel.find(filter).sort({ requestedAt: -1 }).skip(skip).limit(limit),
      RadiologyRequestModel.countDocuments(filter),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async saveRadiology(data: Partial<IRadiologyRequest>): Promise<IRadiologyRequest> {
    assertDbConnected();
    return RadiologyRequestModel.create(data);
  }

  async updateRadiology(
    requestId: string,
    tenantId:  string,
    update:    Partial<Pick<IRadiologyRequest, 'status' | 'reportS3Key' | 'imagingType' | 'notes' | 'priority'>>,
  ): Promise<IRadiologyRequest | null> {
    assertDbConnected();
    return RadiologyRequestModel.findOneAndUpdate(
      { requestId, tenantId, isDeleted: { $ne: true } },
      { $set: update },
      { new: true },
    );
  }

  async softDeleteRadiology(requestId: string, tenantId: string): Promise<IRadiologyRequest | null> {
    assertDbConnected();
    return RadiologyRequestModel.findOneAndUpdate(
      { requestId, tenantId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
  }
}

export const labRepository = new LabRepository();
