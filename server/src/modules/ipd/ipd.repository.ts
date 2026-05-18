import { IPDAdmissionModel, IIPDAdmission } from './ipd.model';
import { ProgressNote, ListAdmissionsQuery, StatusUpdate } from './ipd.types';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class IPDRepository {
  async findById(admissionId: string, tenantId: string): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOne({ admissionId, tenantId });
  }

  // Authoritative bed conflict check — queries IPD admissions, not the Bed flag.
  async findActiveAdmissionByBed(
    bedId: string,
    tenantId: string,
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOne({ bedId, tenantId, status: 'ADMITTED' });
  }

  async findActiveAdmissions(
    tenantId: string,
    query: ListAdmissionsQuery,
  ): Promise<PaginatedResult<IIPDAdmission>> {
    assertDbConnected();
    const { wardId, status, page, limit } = query;
    const skip   = (page - 1) * limit;
    const filter: Record<string, unknown> = { tenantId, status };
    if (wardId) filter['wardId'] = wardId;

    const [data, total] = await Promise.all([
      IPDAdmissionModel.find(filter).sort({ admissionDate: -1 }).skip(skip).limit(limit).lean(),
      IPDAdmissionModel.countDocuments(filter),
    ]);

    return {
      data:       data as IIPDAdmission[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async save(data: Partial<IIPDAdmission>): Promise<IIPDAdmission> {
    assertDbConnected();
    return IPDAdmissionModel.create(data);
  }

  async updateStatus(
    admissionId: string,
    tenantId: string,
    update: StatusUpdate,
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOneAndUpdate(
      { admissionId, tenantId },
      { $set: update },
      { new: true },
    );
  }

  async appendProgressNote(
    admissionId: string,
    tenantId: string,
    note: ProgressNote,
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOneAndUpdate(
      { admissionId, tenantId },
      { $push: { progressNotes: note } },
      { new: true },
    );
  }
}

export const ipdRepository = new IPDRepository();
