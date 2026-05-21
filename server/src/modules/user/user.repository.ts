import { UserModel, IUser } from './user.model';
import { UserRole, PaginatedResult } from '../../shared/types/common.types';
import { ListUsersFilters, UpdateProfileRequest } from './user.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

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

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      UserModel.find(query).skip(skip).limit(limit).lean(),
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
}

export const userRepository = new UserRepository();
