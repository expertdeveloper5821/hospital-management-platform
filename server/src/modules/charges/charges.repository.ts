import { ChargeModel, ICharge, ChargeCategory } from './charges.model';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

export interface ChargeListFilters {
  patientId?:  string;
  category?:   ChargeCategory;
  startDate?:  string;
  endDate?:    string;
  addedBy?:    string;
  page?:       number;
  limit?:      number;
}

class ChargeRepository {
  async save(data: Partial<ICharge>): Promise<ICharge> {
    assertDbConnected();
    return ChargeModel.create(data);
  }

  async findById(tenantId: string, chargeId: string): Promise<ICharge | null> {
    assertDbConnected();
    return ChargeModel.findOne({ tenantId, chargeId });
  }

  async findByPatient(tenantId: string, patientId: string): Promise<ICharge[]> {
    assertDbConnected();
    return ChargeModel.find({ tenantId, patientId }).sort({ createdAt: -1 }).lean() as unknown as ICharge[];
  }

  async list(
    tenantId: string,
    filters:  ChargeListFilters,
  ): Promise<PaginatedResult<ICharge>> {
    assertDbConnected();
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 20, 20);
    const skip  = (page - 1) * limit;

    const query: Record<string, unknown> = { tenantId };
    if (filters.patientId) query.patientId = filters.patientId;
    if (filters.category)  query.category  = filters.category;
    if (filters.addedBy)   query.addedBy   = filters.addedBy;
    if (filters.startDate || filters.endDate) {
      const dateRange: Record<string, unknown> = {};
      if (filters.startDate) dateRange.$gte = new Date(filters.startDate);
      if (filters.endDate)   dateRange.$lte = new Date(filters.endDate);
      query.createdAt = dateRange;
    }

    const [data, total] = await Promise.all([
      ChargeModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ChargeModel.countDocuments(query),
    ]);

    return { data: data as ICharge[], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async update(tenantId: string, chargeId: string, data: Partial<ICharge>): Promise<ICharge | null> {
    assertDbConnected();
    return ChargeModel.findOneAndUpdate({ tenantId, chargeId }, data, { new: true });
  }
}

export const chargeRepository = new ChargeRepository();
