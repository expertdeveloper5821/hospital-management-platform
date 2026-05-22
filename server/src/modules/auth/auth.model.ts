import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
import config from '../../shared/config/env';
import { UserRole } from '../../shared/types/common.types';

// ─── SuperAdmin ───────────────────────────────────────────────────────────────
export interface ISuperAdmin extends Document {
  email:        string;
  passwordHash: string;
  createdAt:    Date;
  updatedAt:    Date;
}

const SuperAdminSchema = new Schema<ISuperAdmin>(
  {
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true, collection: 'super_admins' },
);

// bcrypt pre-save hook
SuperAdminSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, config.bcryptRounds);
  next();
});

export const SuperAdminModel = mongoose.model<ISuperAdmin>('SuperAdmin', SuperAdminSchema);

// ─── User ─────────────────────────────────────────────────────────────────────
export interface IUser extends Document {
  tenantId:            string;
  email:               string;
  name:                string;
  passwordHash:        string;
  role:                UserRole;
  isActive:            boolean;
  isFirstLogin:        boolean;
  failedLoginAttempts: number;
  lockedUntil:         Date | null;
  resetToken:          string | null;
  resetTokenExpiry:    Date | null;
  createdAt:           Date;
  updatedAt:           Date;
}

const UserSchema = new Schema<IUser>(
  {
    tenantId:            { type: String, required: true, index: true },
    email:               { type: String, required: true, lowercase: true, trim: true },
    name:                { type: String, required: true, trim: true },
    passwordHash:        { type: String, required: true },
    role:                { type: String, required: true, enum: Object.values(UserRole) },
    isActive:            { type: Boolean, default: true },
    isFirstLogin:        { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil:         { type: Date, default: null },
    resetToken:          { type: String, default: null },
    resetTokenExpiry:    { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' },
);

// Compound indexes (NFR-01 — tenantId first)
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, role: 1 });
UserSchema.index({ tenantId: 1, isActive: 1 });

export const UserModel = mongoose.model<IUser>('User', UserSchema);
