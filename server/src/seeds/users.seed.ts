import bcrypt from 'bcryptjs';
import { UserModel } from '../modules/auth/auth.model';
import { UserRole } from '../shared/types/common.types';
import { SeededTenant } from './tenants.seed';

const BCRYPT_ROUNDS = 12;
const DEFAULT_PASSWORD = 'Admin@1234';

interface UserSeedEntry {
  email:        string;
  role:         UserRole;
  isFirstLogin: boolean;
}

// Users seeded with isFirstLogin:false so demo logins work without forced password change.
const USERS_BY_TENANT: Record<string, UserSeedEntry[]> = {
  'City General Hospital': [
    { email: 'hospital.admin@yopmail.com',       role: UserRole.HOSPITAL_ADMIN,  isFirstLogin: false },
    { email: 'manager.seema@yopmail.com',        role: UserRole.MANAGER,          isFirstLogin: false },
    { email: 'dr.suresh.sharma@yopmail.com',     role: UserRole.DOCTOR,           isFirstLogin: false },
    { email: 'dr.priya.patel@yopmail.com',       role: UserRole.DOCTOR,           isFirstLogin: false },
    { email: 'nurse.meena.devi@yopmail.com',     role: UserRole.NURSE,            isFirstLogin: false },
    { email: 'reception.raj.kumar@yopmail.com',  role: UserRole.RECEPTIONIST,     isFirstLogin: false },
    { email: 'pathologist.alex@yopmail.com',     role: UserRole.PATHOLOGIST,      isFirstLogin: false },
    { email: 'finance.rohit@yopmail.com',        role: UserRole.FINANCE_MANAGER,  isFirstLogin: false },
  ],
  'Apollo Multi-Specialty Clinic': [
    { email: 'hospital.admin@apollo.hms',      role: UserRole.HOSPITAL_ADMIN,  isFirstLogin: false },
    { email: 'manager.vikram@apollo.hms',      role: UserRole.MANAGER,          isFirstLogin: false },
    { email: 'dr.arun.kumar@apollo.hms',       role: UserRole.DOCTOR,           isFirstLogin: false },
    { email: 'nurse.priya.nair@apollo.hms',    role: UserRole.NURSE,            isFirstLogin: false },
    { email: 'reception.anita@apollo.hms',     role: UserRole.RECEPTIONIST,     isFirstLogin: false },
    { email: 'radiologist.sunil@apollo.hms',   role: UserRole.RADIOLOGIST,      isFirstLogin: false },
    { email: 'finance.deepa@apollo.hms',       role: UserRole.FINANCE_MANAGER,  isFirstLogin: false },
  ],
};

export async function seedUsers(tenants: SeededTenant[]): Promise<void> {
  console.log('[seed] Seeding users...');

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

  for (const tenant of tenants) {
    const entries = USERS_BY_TENANT[tenant.name];
    if (!entries) {
      console.log(`  [!] No user definitions for tenant: ${tenant.name}`);
      continue;
    }

    for (const entry of entries) {
      const existing = await UserModel.findOne({ tenantId: tenant.id, email: entry.email });

      if (!existing) {
        await UserModel.create({
          tenantId:     tenant.id,
          email:        entry.email,
          passwordHash,
          role:         entry.role,
          isActive:     true,
          isFirstLogin: entry.isFirstLogin,
        });
        console.log(`  [+] Created user: ${entry.email} (${entry.role})`);
      } else {
        console.log(`  [~] Skipped (exists): ${entry.email}`);
      }
    }
  }

  console.log(`\n  Default password for all seeded users: ${DEFAULT_PASSWORD}`);
}
