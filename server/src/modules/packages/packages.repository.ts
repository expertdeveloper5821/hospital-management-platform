import mongoose from 'mongoose';
import { PackageModel, IPackage } from './packages.model';
import { WardModel, IWard } from '../ipd/ward.model';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';
import { ConflictError } from '../../shared/middleware/error-handler';

export interface PackageListFilters {
  status?: 'ACTIVE' | 'INACTIVE';
  // Case-insensitive literal substring match on package name.
  search?: string;
  page?:   number;
  limit?:  number;
}

class PackageRepository {
  async save(data: Partial<IPackage>): Promise<IPackage> {
    assertDbConnected();
    return PackageModel.create(data);
  }

  // Creates a brand-new Ward and the Package linked to it in one transaction,
  // so a failed package insert never leaves an orphaned ward behind. Ward's
  // unique (tenantId, name) index is the final duplicate-name arbiter under a
  // concurrent create — mapped to a 409 here.
  async saveWithNewWard(
    wardData: { tenantId: string; name: string; floor?: string },
    pkgData:  Partial<IPackage>,
  ): Promise<{ pkg: IPackage; ward: IWard }> {
    assertDbConnected();
    const session = await mongoose.startSession();
    try {
      let ward!: IWard;
      let pkg!:  IPackage;
      await session.withTransaction(async () => {
        [ward] = await WardModel.create(
          [{ tenantId: wardData.tenantId, name: wardData.name, floor: wardData.floor ?? null }],
          { session },
        );
        [pkg] = await PackageModel.create(
          [{ ...pkgData, wardId: (ward._id as mongoose.Types.ObjectId).toString() }],
          { session },
        );
      });
      return { pkg, ward };
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictError(`Ward "${wardData.name}" already exists`);
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

  // wardId -> ward name for the given ids, tenant-scoped. Used only to label a
  // package's linked ward in API responses.
  async findWardNames(tenantId: string, wardIds: string[]): Promise<Map<string, string>> {
    assertDbConnected();
    const ids = [...new Set(wardIds)].filter((id) => mongoose.isValidObjectId(id));
    if (ids.length === 0) return new Map();
    const wards = await WardModel.find({ tenantId, _id: { $in: ids } }).select('_id name').lean();
    return new Map(wards.map((w) => [String(w._id), w.name]));
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
    const page  = Math.max(1, filters.page ?? 1);
    const limit = Math.max(1, Math.min(filters.limit ?? 20, 20));
    const skip  = (page - 1) * limit;

    const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
    if (filters.status) query.status = filters.status;
    if (filters.search) {
      query.name = { $regex: filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    // `_id` breaks createdAt ties so no package is skipped or repeated across pages.
    const [data, total] = await Promise.all([
      PackageModel.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      PackageModel.countDocuments(query),
    ]);

    return { data: data as IPackage[], total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}

export const packageRepository = new PackageRepository();
