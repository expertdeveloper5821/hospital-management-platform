import type { VitalsProfile } from '../../modules/department/department.model';

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

export function getVitalsCategory(vitalsProfile: VitalsProfile | null | undefined): VitalsCategory {
  return vitalsProfile ?? 'DEFAULT';
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
