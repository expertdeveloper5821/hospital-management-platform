import type { VitalsProfile } from '../../modules/department/department.model';
import { AgeUnit } from '../../modules/patient/patient.types';
import { resolvePatientAge } from './patient-age';

export type PatientVitalKey =
  | 'bloodPressure'
  | 'pulse'
  | 'respiratoryRate'
  | 'spo2'
  | 'sugar'
  | 'bodyTemperature'
  | 'height'
  | 'weight'
  | 'headCircumference';

export interface PatientVitalDefinition {
  key: PatientVitalKey;
  label: string;
  unit: string;
}

// The vitals set is decided only by the OPD visit's / IPD admission's
// department, never by patient age: the Pediatric / Non-Pediatric system
// departments get their own set, every other department (or none) DEFAULT.
export type VitalsCategory = VitalsProfile | 'DEFAULT';

const PEDIATRIC_VITALS: PatientVitalDefinition[] = [
  { key: 'pulse', label: 'PR', unit: 'bpm' },
  { key: 'respiratoryRate', label: 'RR', unit: '/min' },
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'bloodPressure', label: 'BP', unit: 'mmHg' },
  { key: 'height', label: 'Height/Length', unit: 'cm' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'headCircumference', label: 'Head Circumference', unit: 'cm' },
];

const NON_PEDIATRIC_VITALS: PatientVitalDefinition[] = [
  { key: 'bloodPressure', label: 'BP', unit: 'mmHg' },
  { key: 'pulse', label: 'PR', unit: 'bpm' },
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'sugar', label: 'RBS', unit: 'mg/dL' },
  { key: 'bodyTemperature', label: 'Temperature', unit: '°F' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
];

const DEFAULT_VITALS: PatientVitalDefinition[] = [
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'bodyTemperature', label: 'Temperature', unit: '°F' },
  { key: 'bloodPressure', label: 'BP', unit: 'mmHg' },
  { key: 'pulse', label: 'Pulse', unit: 'bpm' },
  { key: 'height', label: 'Height', unit: 'cm' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
];

export interface PatientAgeInput {
  age?: number | null;
  ageUnit?: AgeUnit | null;
  dateOfBirth?: string | Date | null;
}

// A patient younger than 18 years is pediatric. Uses resolvePatientAge's
// contract: an explicit age (with its unit) wins over dateOfBirth.
export function isPediatricPatient(age: number | null | undefined, ageUnit: AgeUnit | null | undefined): boolean {
  if (age === null || age === undefined || !Number.isFinite(age) || age < 0) return false;
  const unit = ageUnit ?? 'YEARS';
  const years = unit === 'YEARS' ? age : unit === 'MONTHS' ? age / 12 : age / 365;
  return years < 18;
}

// The department's vitalsProfile stays authoritative (Pediatric /
// Non-Pediatric system departments). When the visit/admission carries no
// profile at all, the patient's age decides: under 18 → the Pediatric set,
// otherwise the Default set.
export function getVitalsCategory(
  vitalsProfile: VitalsProfile | null | undefined,
  patient?: PatientAgeInput | null,
): VitalsCategory {
  if (vitalsProfile) return vitalsProfile;
  const patientAge = patient
    ? resolvePatientAge(patient.age, patient.ageUnit, patient.dateOfBirth)
    : null;
  if (patientAge && isPediatricPatient(patientAge.value, patientAge.unit)) return 'PEDIATRIC';
  return 'DEFAULT';
}

export function getPatientVitalDefinitions(category: VitalsCategory): PatientVitalDefinition[] {
  if (category === 'PEDIATRIC') return PEDIATRIC_VITALS;
  if (category === 'NON_PEDIATRIC') return NON_PEDIATRIC_VITALS;
  return DEFAULT_VITALS;
}

export function getPatientVitalsHeading(category: VitalsCategory): string {
  if (category === 'PEDIATRIC') return 'Pediatric Vitals';
  if (category === 'NON_PEDIATRIC') return 'Non-Pediatric Vitals';
  return 'Vitals';
}

export function getPatientVitalSlipLabel(definition: PatientVitalDefinition, category: VitalsCategory): string {
  if (category === 'PEDIATRIC') {
    if (definition.key === 'height') return 'Height';
    if (definition.key === 'headCircumference') return 'Head Circ.';
    return definition.label;
  }
  return definition.key === 'bodyTemperature' ? 'Temp' : definition.label;
}

export function formatPatientVitalValue(
  vitals: Partial<Record<PatientVitalKey, number | string | null>> | null | undefined,
  definition: PatientVitalDefinition,
): string {
  const value = vitals?.[definition.key];
  return value === null || value === undefined || value === ''
    ? ''
    : String(value);
}
