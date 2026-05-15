import { TenantModel, ITenant } from '../modules/tenant/tenant.model';
import { TenantStatus } from '../shared/types/common.types';

export interface SeededTenant {
  id:    string;
  name:  string;
  doc:   ITenant;
}

const DEMO_TENANTS = [
  {
    name:       'City General Hospital',
    adminEmail: 'admin-city@yopmail.com',
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'seeds/reg-cert-citygeneral.pdf',
      gstNumber:               '27AABCU9603R1ZX',
      panCard:                 'seeds/pan-citygeneral.pdf',
      addressProof:            'seeds/address-citygeneral.pdf',
    },
    branding: {
      displayName:  'City General Hospital',
      primaryColor: '#1A73E8',
      logoUrl:      null,
    },
  },
  {
    name:       'Apollo Multi-Specialty Clinic',
    adminEmail: 'admin-apollo@yopmail.com',
    status:     TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'seeds/reg-cert-apollo.pdf',
      gstNumber:               '27AABCU9603R2ZY',
      panCard:                 'seeds/pan-apollo.pdf',
      addressProof:            'seeds/address-apollo.pdf',
    },
    branding: {
      displayName:  'Apollo Multi-Specialty Clinic',
      primaryColor: '#E53935',
      logoUrl:      null,
    },
  },
];

export async function seedTenants(): Promise<SeededTenant[]> {
  console.log('[seed] Seeding tenants...');
  const results: SeededTenant[] = [];

  for (const data of DEMO_TENANTS) {
    let tenant = await TenantModel.findOne({ adminEmail: data.adminEmail });

    if (!tenant) {
      tenant = await TenantModel.create(data);
      console.log(`  [+] Created tenant: ${tenant.name} (${tenant._id})`);
    } else {
      console.log(`  [~] Skipped (exists): ${tenant.name}`);
    }

    results.push({ id: tenant._id.toString(), name: tenant.name, doc: tenant });
  }

  return results;
}
