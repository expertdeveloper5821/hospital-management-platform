import { UserModel, IUser } from './user.model';
import { UserRole, PaginatedResult } from '../../shared/types/common.types';
import { ListUsersFilters, UpdateProfileRequest, UpdateMyProfileRequest, SortByField } from './user.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SORT_FIELD_MAP: Record<SortByField, string> = {
  name:      'name',
  createdAt: 'createdAt',
  role:      'role',
};

export class UserRepository {
  async findById(tenantId: string, userId: string): Promise<IUser | null> {
    assertDbConnected();
    return UserModel.findOne({ _id: userId, tenantId });
  }

  async findByEmail(tenantId: string, email: string): Promise<IUser | null> {
    assertDbConnected();
    return UserModel.findOne({ tenantId, email: email.toLowerCase() });
  }

  // Resolve a set of user ids to their display names (tenant-scoped).
  async findNamesByIds(tenantId: string, userIds: string[]): Promise<Map<string, string>> {
    assertDbConnected();
    if (userIds.length === 0) return new Map();
    const valid = userIds.filter((id) => /^[a-fA-F0-9]{24}$/.test(id));
    if (valid.length === 0) return new Map();
    const docs = await UserModel.find({ _id: { $in: valid }, tenantId })
      .select('_id name').lean();
    return new Map(docs.map((u) => [(u._id as { toString(): string }).toString(), u.name as string]));
  }

  // Return ids of users whose name matches a case-insensitive substring (tenant-scoped).
  // Capped so a very short query (e.g. "a") can't return an unbounded id set that
  // then becomes a huge $in filter downstream.
  static readonly NAME_SEARCH_MAX = 200;
  async findIdsByNameSearch(tenantId: string, nameQuery: string): Promise<string[]> {
    assertDbConnected();
    const trimmed = nameQuery.trim();
    if (!trimmed) return [];
    const re = new RegExp(escapeRegex(trimmed), 'i');
    const docs = await UserModel.find({ tenantId, name: re })
      .select('_id')
      .limit(UserRepository.NAME_SEARCH_MAX)
      .lean();
    return docs.map((u) => (u._id as { toString(): string }).toString());
  }

  async findAll(
    tenantId: string,
    filters: ListUsersFilters,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<IUser>> {
    assertDbConnected();
    const query: Record<string, unknown> = { tenantId };
    if (filters.role     !== undefined) query.role     = filters.role;
    if (filters.isActive !== undefined) query.isActive = filters.isActive;

    if (filters.search) {
      const escaped = escapeRegex(filters.search);
      const re = new RegExp(escaped, 'i');
      query.$or = [{ name: re }, { email: re }];
    }

    const sortField = SORT_FIELD_MAP[filters.sortBy ?? 'createdAt'];
    const sortDir   = filters.sortOrder === 'asc' ? 1 : -1;

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      UserModel.find(query).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      UserModel.countDocuments(query),
    ]);
    return { data: data as IUser[], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Minimal active-employee roster for a tenant (id/name/email only) — used to
  // build tenant-wide reports (e.g. attendance) without paginating.
  async findActiveRoster(tenantId: string): Promise<Array<{ userId: string; name: string; email: string }>> {
    assertDbConnected();
    const docs = await UserModel.find({ tenantId, isActive: true })
      .select('_id name email')
      .sort({ name: 1 })
      .lean();
    return docs.map((u) => ({
      userId: (u._id as { toString(): string }).toString(),
      name:   u.name as string,
      email:  u.email as string,
    }));
  }

  async countActiveAdmins(tenantId: string): Promise<number> {
    assertDbConnected();
    return UserModel.countDocuments({
      tenantId,
      role:     UserRole.HOSPITAL_ADMIN,
      isActive: true,
    });
  }

  async save(user: Partial<IUser>): Promise<IUser> {
    assertDbConnected();
    return UserModel.create(user);
  }

  async updateRole(tenantId: string, userId: string, role: UserRole): Promise<void> {
    assertDbConnected();
    await UserModel.findOneAndUpdate({ _id: userId, tenantId }, { role });
  }

  async setActive(tenantId: string, userId: string, isActive: boolean): Promise<void> {
    assertDbConnected();
    await UserModel.findOneAndUpdate({ _id: userId, tenantId }, { isActive });
  }

  async updateProfile(tenantId: string, userId: string, data: UpdateProfileRequest): Promise<IUser | null> {
    assertDbConnected();
    const update: Partial<IUser> = {};
    if (data.name)  update.name  = data.name;
    if (data.email) update.email = data.email.toLowerCase();
    return UserModel.findOneAndUpdate({ _id: userId, tenantId }, update, { new: true });
  }

  async updateMyProfile(tenantId: string, userId: string, data: UpdateMyProfileRequest): Promise<IUser | null> {
    assertDbConnected();
    const update: Partial<IUser> = {};
    if (data.name !== undefined)            update.name           = data.name;
    if (data.phone !== undefined)           update.phone          = data.phone;
    if (data.profileImageUrl !== undefined) update.profileImageUrl = data.profileImageUrl;
    return UserModel.findOneAndUpdate({ _id: userId, tenantId }, update, { new: true });
  }

  async updatePassword(tenantId: string, userId: string, passwordHash: string): Promise<void> {
    assertDbConnected();
    await UserModel.findOneAndUpdate({ _id: userId, tenantId }, { passwordHash });
  }

  async addDepartmentToUsers(tenantId: string, userIds: string[], departmentId: string): Promise<void> {
    assertDbConnected();
    await UserModel.updateMany(
      { _id: { $in: userIds }, tenantId },
      { $addToSet: { departmentIds: departmentId } },
    );
  }

  async removeDepartmentFromUsers(tenantId: string, userIds: string[], departmentId: string): Promise<void> {
    assertDbConnected();
    await UserModel.updateMany(
      { _id: { $in: userIds }, tenantId },
      { $pull: { departmentIds: departmentId } },
    );
  }
}

export const userRepository = new UserRepository();
