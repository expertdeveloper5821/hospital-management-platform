import path from 'path';
import mongoose from 'mongoose';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { TenantModel }   from '../src/modules/tenant/tenant.model';
import { PatientModel }  from '../src/modules/patient/patient.model';
import { TenantStatus }  from '../src/shared/types/common.types';
import { Gender, BloodGroup } from '../src/modules/patient/patient.types';

// 3 patients per tenant — covers male, female, other + varied blood groups
const PATIENT_TEMPLATES = [
  {
    fullName:               'Rajesh Kumar',
    dateOfBirth:            new Date('1985-03-12'),
    gender:                 Gender.MALE,
    mobileNumber:           '9810001001',
    address:                '42, MG Road, Bengaluru, Karnataka - 560001',
    aadhaarNumber:          '123456789012',
    emergencyContactName:   'Sunita Kumar',
    emergencyContactMobile: '9810001002',
    bloodGroup:             BloodGroup.B_POS,
  },
  {
    fullName:               'Priya Sharma',
    dateOfBirth:            new Date('1992-07-25'),
    gender:                 Gender.FEMALE,
    mobileNumber:           '9820002001',
    address:                '15, Juhu Tara Road, Mumbai, Maharashtra - 400049',
    aadhaarNumber:          '234567890123',
    emergencyContactName:   'Anil Sharma',
    emergencyContactMobile: '9820002002',
    bloodGroup:             BloodGroup.O_POS,
  },
  {
    fullName:               'Alex Fernandes',
    dateOfBirth:            new Date('2000-11-08'),
    gender:                 Gender.OTHER,
    mobileNumber:           '9830003001',
    address:                '7, Park Street, Kolkata, West Bengal - 700016',
    aadhaarNumber:          null,
    emergencyContactName:   null,
    emergencyContactMobile: null,
    bloodGroup:             BloodGroup.AB_POS,
  },
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
    console.log(`\nTenant: ${tenant.name} (${tenantId})`);

    for (const template of PATIENT_TEMPLATES) {
      // Vary mobile per tenant to avoid compound-index collisions across tenants
      const tenantIndex   = activeTenants.indexOf(tenant) + 1;
      const mobileNumber  = `${template.mobileNumber.slice(0, -1)}${tenantIndex}`;

      const existing = await PatientModel.findOne({ tenantId, mobileNumber });
      if (existing) {
        console.log(`  [skip] Patient already exists: ${template.fullName} (${mobileNumber})`);
        continue;
      }

      const patient = await PatientModel.create({ ...template, mobileNumber, tenantId });
      console.log(`  [ok]   ${template.fullName.padEnd(20)} patientId=${patient.patientId}  mobile=${mobileNumber}`);
    }
  }

  console.log('\nPatient seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Patient seed failed:', err.message);
  process.exit(1);
});
