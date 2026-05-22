import path from 'path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { TenantModel } from '../src/modules/tenant/tenant.model';
import { UserModel }   from '../src/modules/auth/auth.model';
import { UserRole, TenantStatus } from '../src/shared/types/common.types';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);

// One user per role per active tenant.  Password is role-based for easy testing.
const ROLE_USERS: Array<{ role: UserRole; emailPrefix: string; password: string }> = [
  { role: UserRole.HOSPITAL_ADMIN,  emailPrefix: 'hospital-admin',  password: 'HospAdmin@123'  },
  { role: UserRole.MANAGER,         emailPrefix: 'manager',         password: 'Manager@123'     },
  { role: UserRole.DOCTOR,          emailPrefix: 'doctor',          password: 'Doctor@123'      },
  { role: UserRole.NURSE,           emailPrefix: 'nurse',           password: 'Nurse@123'       },
  { role: UserRole.RECEPTIONIST,    emailPrefix: 'receptionist',    password: 'Recept@123'      },
  { role: UserRole.PATHOLOGIST,     emailPrefix: 'pathologist',     password: 'Patholo@123'     },
  { role: UserRole.RADIOLOGIST,     emailPrefix: 'radiologist',     password: 'Radiol@123'      },
  { role: UserRole.FINANCE_MANAGER, emailPrefix: 'finance-manager', password: 'Finance@123'     },
  { role: UserRole.HR,              emailPrefix: 'hr',              password: 'HRUser@123'      },
  { role: UserRole.ADMIN,           emailPrefix: 'admin',           password: 'Admin@123'       },
  { role: UserRole.STAFF,           emailPrefix: 'staff',           password: 'Staff@123'       },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('Connected to MongoDB');

  const activeTenants = await TenantModel.find({ status: TenantStatus.ACTIVE });
  if (activeTenants.length === 0) {
    console.error('No active tenants found. Run seed-tenants.ts first.');
    process.exit(1);
  }

  for (const tenant of activeTenants) {
    const tenantId = (tenant._id as mongoose.Types.ObjectId).toString();
    const domain   = tenant.adminEmail.split('@')[1];
    console.log(`\nTenant: ${tenant.name} (${tenantId})`);

    for (const { role, emailPrefix, password } of ROLE_USERS) {
      const email = `${emailPrefix}@${domain}`;

      const existing = await UserModel.findOne({ tenantId, email });
      if (existing) {
        console.log(`  [skip] ${role} already exists: ${email}`);
        continue;
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await UserModel.create({
        tenantId,
        email,
        passwordHash,
        role,
        isActive:     true,
        isFirstLogin: true,
      });
      console.log(`  [ok]   ${role.padEnd(16)} → ${email}`);
    }
  }

  console.log('\nHospital-roles seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Hospital-roles seed failed:', err.message);
  process.exit(1);
});
