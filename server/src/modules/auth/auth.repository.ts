import { UserModel, IUser, SuperAdminModel, ISuperAdmin } from './auth.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class AuthRepository {
  async findUserByEmail(tenantId: string, email: string): Promise<IUser | null> {
    assertDbConnected();
    return UserModel.findOne({ tenantId, email: email.toLowerCase() });
  }

  async findUserByEmailAnyTenant(email: string): Promise<IUser | null> {
    assertDbConnected();
    return UserModel.findOne({ email: email.toLowerCase() });
  }

  async findSuperAdminByEmail(email: string): Promise<ISuperAdmin | null> {
    assertDbConnected();
    return SuperAdminModel.findOne({ email: email.toLowerCase() });
  }

  async findUserById(userId: string): Promise<IUser | null> {
    assertDbConnected();
    return UserModel.findById(userId);
  }

  async findSuperAdminById(id: string): Promise<ISuperAdmin | null> {
    assertDbConnected();
    return SuperAdminModel.findById(id);
  }

  async incrementFailedAttempts(userId: string): Promise<void> {
    assertDbConnected();
    await UserModel.findByIdAndUpdate(userId, {
      $inc: { failedLoginAttempts: 1 },
    });
  }

  async lockAccount(userId: string, lockUntil: Date): Promise<void> {
    assertDbConnected();
    await UserModel.findByIdAndUpdate(userId, {
      lockedUntil:         lockUntil,
      failedLoginAttempts: 0,
    });
  }

  async unlockAccount(userId: string): Promise<void> {
    assertDbConnected();
    await UserModel.findByIdAndUpdate(userId, {
      lockedUntil:         null,
      failedLoginAttempts: 0,
    });
  }

  async saveResetToken(
    userId: string,
    token: string,
    expiry: Date,
  ): Promise<void> {
    assertDbConnected();
    await UserModel.findByIdAndUpdate(userId, {
      resetToken:       token,
      resetTokenExpiry: expiry,
    });
  }

  async consumeResetToken(token: string): Promise<IUser | null> {
    assertDbConnected();
    return UserModel.findOne({
      resetToken:       token,
      resetTokenExpiry: { $gt: new Date() },
    });
  }

  async recordPasswordChange(userId: string, newHash: string): Promise<void> {
    assertDbConnected();
    await UserModel.findByIdAndUpdate(userId, {
      passwordHash:        newHash,
      isFirstLogin:        false,
      failedLoginAttempts: 0,
      lockedUntil:         null,
      resetToken:          null,
      resetTokenExpiry:    null,
    });
  }
}

export const authRepository = new AuthRepository();
