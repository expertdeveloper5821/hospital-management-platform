import path from 'path';
import mongoose from 'mongoose';
import { seedTenants } from './tenants.seed';
import { seedUsers } from './users.seed';
import { seedPatients } from './patients.seed';

// Load .env without dotenv-safe — seeds only need MONGODB_URI
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/HMS';

async function main(): Promise<void> {
  console.log('[seed] Connecting to MongoDB:', MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@'));

  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('[seed] Connected.\n');

  try {
    const tenants = await seedTenants();
    console.log();
    await seedUsers(tenants);
    console.log();
    await seedPatients(tenants);
    console.log('\n[seed] Done.');
  } finally {
    await mongoose.connection.close();
    console.log('[seed] Disconnected.');
  }
}

main().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
