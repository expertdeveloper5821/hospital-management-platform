import path from 'path';
import mongoose from 'mongoose';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { TenantModel } from '../src/modules/tenant/tenant.model';
import { TenantStatus } from '../src/shared/types/common.types';

const TENANTS = [
  {
    name:       'City General Hospital',
    adminEmail: 'admin-city@yopmail.com',
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'docs/tenant1/reg-cert.pdf',
      gstNumber:               '27AABCT1234A1Z5',
      panCard:                 'docs/tenant1/pan.pdf',
      addressLine:            '123 Main Street',
      city:                    'Mumbai',
      state:                   'Maharashtra',
    },
    branding: {
      displayName:  'City General Hospital',
      primaryColor: '#1A73E8',
    },
  },
  {
    name:       'Sunrise Multispeciality Clinic',
    adminEmail: 'admin-sun@yopmail.com',
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'docs/tenant2/reg-cert.pdf',
      gstNumber:               '29AABCS5678B1Z3',
      panCard:                 'docs/tenant2/pan.pdf',
      addressLine1:            '456 Park Avenue',
      city:                    'Pune',
      state:                   'Maharashtra',
    },
    branding: {
      displayName:  'Sunrise Clinic',
      primaryColor: '#F4A261',
    },
  },
  {
    name:       'Metro Health Centre',
    adminEmail: 'admin-metro@yopmail.com',
    status:     TenantStatus.PENDING_VERIFICATION,
    onboardingDocuments: {
      registrationCertificate: 'docs/tenant3/reg-cert.pdf',
      gstNumber:               '07AABCM9012C1Z1',
      panCard:                 'docs/tenant3/pan.pdf',
      addressLine1:            '789 Sector 15',
      city:                    'Delhi',
      state:                   'Delhi',
    },
    branding: {
      displayName:  'Metro Health Centre',
      primaryColor: '#2A9D8F',
    },
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('Connected to MongoDB');

  for (const data of TENANTS) {
    const existing = await TenantModel.findOne({ adminEmail: data.adminEmail });
    if (existing) {
      console.log(`  [skip] Tenant already exists: ${data.name} (${data.adminEmail})`);
      continue;
    }
    const tenant = await TenantModel.create(data);
    console.log(`  [ok]   Created tenant: ${tenant.name}  id=${tenant._id}  status=${tenant.status}`);
  }

  console.log('\nTenant seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Tenant seed failed:', err.message);
  process.exit(1);
});
