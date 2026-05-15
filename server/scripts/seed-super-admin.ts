import path from 'path';
import mongoose from 'mongoose';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { SuperAdminModel } from '../src/modules/auth/auth.model';

const EMAIL    = process.env.SEED_SA_EMAIL    ?? 'superadmin@yopmail.com';
const PASSWORD = process.env.SEED_SA_PASSWORD ?? 'SuperAdmin@123';

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('Connected to MongoDB');

  const existing = await SuperAdminModel.findOne({ email: EMAIL.toLowerCase() });
  if (existing) {
    console.log(`Super admin already exists: ${EMAIL}`);
    process.exit(0);
  }

  await SuperAdminModel.create({ email: EMAIL, passwordHash: PASSWORD });
  console.log(`Super admin created successfully`);
  console.log(`  Email   : ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`\nChange this password immediately after first login.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
