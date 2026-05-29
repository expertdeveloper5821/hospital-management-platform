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
}

export const userRepository = new UserRepository();
