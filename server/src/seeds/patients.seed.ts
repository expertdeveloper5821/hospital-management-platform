import mongoose, { Schema, Document, Model } from 'mongoose';
import { SeededTenant } from './tenants.seed';

// Inline schema — replaced with import from '../modules/patient/patient.model'
// once U2-A (Patient Module) is merged.
interface IPatient extends Document {
  tenantId:         string;
  patientId:        string;
  name:             string;
  dateOfBirth:      Date;
  gender:           'Male' | 'Female' | 'Other';
  bloodGroup:       string;
  contactNumber:    string;
  address:          string;
  emergencyContact: string;
}

const PatientSchema = new Schema<IPatient>(
  {
    tenantId:         { type: String, required: true, index: true },
    patientId:        { type: String, required: true },
    name:             { type: String, required: true },
    dateOfBirth:      { type: Date,   required: true },
    gender:           { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
    bloodGroup:       { type: String, required: true },
    contactNumber:    { type: String, required: true },
    address:          { type: String, default: '' },
    emergencyContact: { type: String, default: '' },
  },
  { timestamps: true, collection: 'patients' },
);

PatientSchema.index({ tenantId: 1, patientId: 1 }, { unique: true });

// Use existing model if already registered (idempotent hot-reload safe)
const PatientModel: Model<IPatient> =
  (mongoose.models['Patient'] as Model<IPatient>) ||
  mongoose.model<IPatient>('Patient', PatientSchema);

interface PatientSeedEntry {
  patientId:        string;
  name:             string;
  dateOfBirth:      Date;
  gender:           'Male' | 'Female' | 'Other';
  bloodGroup:       string;
  contactNumber:    string;
  address:          string;
  emergencyContact: string;
}

const PATIENTS_BY_TENANT: Record<string, PatientSeedEntry[]> = {
  'City General Hospital': [
    {
      patientId:        'HMS-0001',
      name:             'Ravi Shankar',
      dateOfBirth:      new Date('1985-03-15'),
      gender:           'Male',
      bloodGroup:       'A+',
      contactNumber:    '9876501001',
      address:          '14 MG Road, Bengaluru, Karnataka 560001',
      emergencyContact: 'Anita Shankar - 9876501010',
    },
    {
      patientId:        'HMS-0002',
      name:             'Priya Mehta',
      dateOfBirth:      new Date('1992-07-22'),
      gender:           'Female',
      bloodGroup:       'B+',
      contactNumber:    '9876501002',
      address:          '8 Koramangala, Bengaluru, Karnataka 560034',
      emergencyContact: 'Rahul Mehta - 9876501011',
    },
    {
      patientId:        'HMS-0003',
      name:             'Arjun Kapoor',
      dateOfBirth:      new Date('1978-11-05'),
      gender:           'Male',
      bloodGroup:       'O+',
      contactNumber:    '9876501003',
      address:          '22 Indiranagar, Bengaluru, Karnataka 560038',
      emergencyContact: 'Sunita Kapoor - 9876501012',
    },
    {
      patientId:        'HMS-0004',
      name:             'Sunita Reddy',
      dateOfBirth:      new Date('1965-02-28'),
      gender:           'Female',
      bloodGroup:       'AB+',
      contactNumber:    '9876501004',
      address:          '5 Jayanagar, Bengaluru, Karnataka 560011',
      emergencyContact: 'Mohan Reddy - 9876501013',
    },
    {
      patientId:        'HMS-0005',
      name:             'Mohammed Ali',
      dateOfBirth:      new Date('2001-09-10'),
      gender:           'Male',
      bloodGroup:       'A-',
      contactNumber:    '9876501005',
      address:          '33 Shivajinagar, Bengaluru, Karnataka 560051',
      emergencyContact: 'Fatima Ali - 9876501014',
    },
    {
      patientId:        'HMS-0006',
      name:             'Lakshmi Devi',
      dateOfBirth:      new Date('1990-06-18'),
      gender:           'Female',
      bloodGroup:       'B-',
      contactNumber:    '9876501006',
      address:          '7 Rajajinagar, Bengaluru, Karnataka 560010',
      emergencyContact: 'Suresh Devi - 9876501015',
    },
  ],
  'Apollo Multi-Specialty Clinic': [
    {
      patientId:        'HMS-0001',
      name:             'Sanjay Gupta',
      dateOfBirth:      new Date('1980-04-12'),
      gender:           'Male',
      bloodGroup:       'O+',
      contactNumber:    '9887601001',
      address:          '10 Andheri West, Mumbai, Maharashtra 400053',
      emergencyContact: 'Meera Gupta - 9887601010',
    },
    {
      patientId:        'HMS-0002',
      name:             'Kavitha Nair',
      dateOfBirth:      new Date('1995-08-25'),
      gender:           'Female',
      bloodGroup:       'A+',
      contactNumber:    '9887601002',
      address:          '3 Bandra East, Mumbai, Maharashtra 400051',
      emergencyContact: 'Rajan Nair - 9887601011',
    },
    {
      patientId:        'HMS-0003',
      name:             'Deepak Singh',
      dateOfBirth:      new Date('1970-12-30'),
      gender:           'Male',
      bloodGroup:       'B+',
      contactNumber:    '9887601003',
      address:          '45 Powai, Mumbai, Maharashtra 400076',
      emergencyContact: 'Neha Singh - 9887601012',
    },
    {
      patientId:        'HMS-0004',
      name:             'Ananya Iyer',
      dateOfBirth:      new Date('2000-01-15'),
      gender:           'Female',
      bloodGroup:       'AB-',
      contactNumber:    '9887601004',
      address:          '12 Malad West, Mumbai, Maharashtra 400064',
      emergencyContact: 'Suresh Iyer - 9887601013',
    },
    {
      patientId:        'HMS-0005',
      name:             'Ramesh Verma',
      dateOfBirth:      new Date('1988-05-20'),
      gender:           'Male',
      bloodGroup:       'O-',
      contactNumber:    '9887601005',
      address:          '28 Borivali East, Mumbai, Maharashtra 400066',
      emergencyContact: 'Sunita Verma - 9887601014',
    },
    {
      patientId:        'HMS-0006',
      name:             'Pooja Sharma',
      dateOfBirth:      new Date('1975-09-08'),
      gender:           'Female',
      bloodGroup:       'A-',
      contactNumber:    '9887601006',
      address:          '9 Goregaon West, Mumbai, Maharashtra 400062',
      emergencyContact: 'Amit Sharma - 9887601015',
    },
  ],
};

export async function seedPatients(tenants: SeededTenant[]): Promise<void> {
  console.log('[seed] Seeding patients...');

  for (const tenant of tenants) {
    const entries = PATIENTS_BY_TENANT[tenant.name];
    if (!entries) {
      console.log(`  [!] No patient definitions for tenant: ${tenant.name}`);
      continue;
    }

    for (const entry of entries) {
      const existing = await PatientModel.findOne({
        tenantId:  tenant.id,
        patientId: entry.patientId,
      });

      if (!existing) {
        await PatientModel.create({ ...entry, tenantId: tenant.id });
        console.log(`  [+] Created patient: ${entry.patientId} ${entry.name} (${tenant.name})`);
      } else {
        console.log(`  [~] Skipped (exists): ${entry.patientId} ${entry.name}`);
      }
    }
  }
}
