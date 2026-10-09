import { DepartmentModel, IDepartment, VitalsProfile } from './department.model';
import { assertDbConnected } from '../../shared/utils/db-guard';
import { PaginatedResult } from '../../shared/types/common.types';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class DepartmentRepository {
  async findById(tenantId: string, departmentId: string): Promise<IDepartment | null> {
    assertDbConnected();
    return DepartmentModel.findOne({ tenantId, departmentId, isDeleted: { $ne: true } });
  }

  async findByName(tenantId: string, name: string): Promise<IDepartment | null> {
    assertDbConnected();
    return DepartmentModel.findOne({
      tenantId,
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      isDeleted: { $ne: true },
    });
  }

  async findAll(tenantId: string): Promise<IDepartment[]> {
    assertDbConnected();
    return DepartmentModel.find({ tenantId, isDeleted: { $ne: true } }).sort({ name: 1 });
  }

  // Paginated list. `search` matches the department name, or any department in
  // `matchedDepartmentIds` (resolved from assigned doctors' names by the service).
  async findPaginated(
    tenantId: string,
    filters: { search?: string; matchedDepartmentIds?: string[] },
    page: number,
    limit: number,
  ): Promise<PaginatedResult<IDepartment>> {
    assertDbConnected();
    const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
    if (filters.search) {
      const re = new RegExp(escapeRegex(filters.search), 'i');
      query.$or = [
        { name: re },
        { departmentId: { $in: filters.matchedDepartmentIds ?? [] } },
      ];
    }

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      DepartmentModel.find(query).sort({ name: 1, _id: 1 }).skip(skip).limit(limit),
      DepartmentModel.countDocuments(query),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Vitals profiles already claimed in this tenant — soft-deleted rows
  // included, so a department the hospital deleted is never re-seeded.
  async findClaimedVitalsProfiles(tenantId: string): Promise<VitalsProfile[]> {
    assertDbConnected();
    const rows = await DepartmentModel.find(
      { tenantId, vitalsProfile: { $type: 'string' } },
      { vitalsProfile: 1 },
    ).lean();
    return rows.map((r) => r.vitalsProfile as VitalsProfile);
  }

  // Blanks the placeholder description an earlier seed wrote on the vitals
  // departments; any other description (typed by the hospital) is kept.
  async clearSeededVitalsDescriptions(tenantId: string, seededDescriptions: string[]): Promise<void> {
    assertDbConnected();
    await DepartmentModel.updateMany(
      { tenantId, vitalsProfile: { $type: 'string' }, description: { $in: seededDescriptions } },
      { $set: { description: null } },
    );
  }

  async save(data: Partial<IDepartment>): Promise<IDepartment> {
    assertDbConnected();
    return DepartmentModel.create(data);
  }

  async update(
    tenantId: string,
    departmentId: string,
    data: Partial<IDepartment>,
  ): Promise<IDepartment | null> {
    assertDbConnected();
    return DepartmentModel.findOneAndUpdate(
      { tenantId, departmentId, isDeleted: { $ne: true } },
      { $set: data },
      { new: true },
    );
  }

  async softDelete(tenantId: string, departmentId: string): Promise<IDepartment | null> {
    assertDbConnected();
    return DepartmentModel.findOneAndUpdate(
      { tenantId, departmentId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
  }
}

export const departmentRepository = new DepartmentRepository();
