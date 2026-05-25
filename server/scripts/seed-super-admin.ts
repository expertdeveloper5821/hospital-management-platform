import fs from 'fs';
import path from 'path';
import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

const envPath = path.resolve(__dirname, '../.env');
const examplePath = path.resolve(__dirname, '../.env.example');

// Local development can still use .env, but Render-style deployments should work
// with environment variables only and must not require the whole app env contract.
if (fs.existsSync(envPath)) {
  require('dotenv-safe').config({
    path: envPath,
    example: examplePath,
  });
}

const EMAIL = (process.env.SEED_SA_EMAIL ?? 'superadmin@yopmail.com').toLowerCase();
const PASSWORD = process.env.SEED_SA_PASSWORD ?? 'SuperAdmin@123';
const MONGODB_URI = process.env.MONGODB_URI;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is required to seed the super admin.');
}

const SuperAdminSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true, collection: 'super_admins' },
);

const SuperAdminModel = mongoose.models.SuperAdmin
  ?? mongoose.model('SuperAdmin', SuperAdminSchema);

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const existing = await SuperAdminModel.findOne({ email: EMAIL });
  if (existing) {
    console.log(`Super admin already exists: ${EMAIL}`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
  await SuperAdminModel.create({ email: EMAIL, passwordHash });

  console.log('Super admin created successfully');
  console.log(`  Email   : ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log('\nChange this password immediately after first login.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
