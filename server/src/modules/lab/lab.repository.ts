import { PathologyRequestModel, IPathologyRequest } from './lab.model';
import { RadiologyRequestModel, IRadiologyRequest } from './lab.model';
import { ListLabRequestsQuery } from './lab.types';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class LabRepository {

  // ─── Pathology ─────────────────────────────────────────────────────────────

  async findPathologyById(requestId: string, tenantId: string): Promise<IPathologyRequest | null> {
    assertDbConnected();
    return PathologyRequestModel.findOne({ requestId, tenantId });
  }

  async findPendingPathology(tenantId: string): Promise<IPathologyRequest[]> {
    assertDbConnected();
    return PathologyRequestModel
      .find({ tenantId, status: 'PENDING' })
      .sort({ requestedAt: 1 });
  }

  async findPathologyByPatient(
    tenantId: string,
    query:    ListLabRequestsQuery,
  ): Promise<PaginatedResult<IPathologyRequest>> {
    assertDbConnected();
    const { patientId, status, page, limit } = query;
    const skip   = (page - 1) * limit;
    const filter: Record<string, unknown> = { tenantId };
    if (patientId) filter['patientId'] = patientId;
    if (status)    filter['status']    = status;

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
    update:    Partial<Pick<IPathologyRequest, 'status' | 'reportS3Key'>>,
  ): Promise<IPathologyRequest | null> {
    assertDbConnected();
    return PathologyRequestModel.findOneAndUpdate(
      { requestId, tenantId },
      { $set: update },
      { new: true },
    );
  }

  // ─── Radiology ─────────────────────────────────────────────────────────────

  async findRadiologyById(requestId: string, tenantId: string): Promise<IRadiologyRequest | null> {
    assertDbConnected();
    return RadiologyRequestModel.findOne({ requestId, tenantId });
  }

  async findPendingRadiology(tenantId: string): Promise<IRadiologyRequest[]> {
    assertDbConnected();
    return RadiologyRequestModel
      .find({ tenantId, status: 'PENDING' })
      .sort({ requestedAt: 1 });
  }

  async findRadiologyByPatient(
    tenantId: string,
    query:    ListLabRequestsQuery,
  ): Promise<PaginatedResult<IRadiologyRequest>> {
    assertDbConnected();
    const { patientId, status, page, limit } = query;
    const skip   = (page - 1) * limit;
    const filter: Record<string, unknown> = { tenantId };
    if (patientId) filter['patientId'] = patientId;
    if (status)    filter['status']    = status;

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
    update:    Partial<Pick<IRadiologyRequest, 'status' | 'reportS3Key'>>,
  ): Promise<IRadiologyRequest | null> {
    assertDbConnected();
    return RadiologyRequestModel.findOneAndUpdate(
      { requestId, tenantId },
      { $set: update },
      { new: true },
    );
  }
}

export const labRepository = new LabRepository();
