import { PackageModel, IPackage } from './packages.model';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

export interface PackageListFilters {
  status?: 'ACTIVE' | 'INACTIVE';
  page?:   number;
  limit?:  number;
}

class PackageRepository {
  async save(data: Partial<IPackage>): Promise<IPackage> {
    assertDbConnected();
    return PackageModel.create(data);
  }

  async findById(tenantId: string, packageId: string): Promise<IPackage | null> {
    assertDbConnected();
    return PackageModel.findOne({ tenantId, packageId, isDeleted: { $ne: true } });
  }

  async findByName(tenantId: string, name: string): Promise<IPackage | null> {
    assertDbConnected();
    const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    return PackageModel.findOne({ tenantId, name: re, isDeleted: { $ne: true } });
  }

  async update(
    tenantId:  string,
    packageId: string,
    data:      Partial<IPackage>,
  ): Promise<IPackage | null> {
    assertDbConnected();
    return PackageModel.findOneAndUpdate(
      { tenantId, packageId, isDeleted: { $ne: true } },
      data,
      { new: true },
    );
  }

  async list(
    tenantId: string,
    filters:  PackageListFilters,
  ): Promise<PaginatedResult<IPackage>> {
    assertDbConnected();
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 20, 20);
    const skip  = (page - 1) * limit;

    const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
    if (filters.status) query.status = filters.status;

    const [data, total] = await Promise.all([
      PackageModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PackageModel.countDocuments(query),
    ]);

    return { data: data as IPackage[], total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}

export const packageRepository = new PackageRepository();
