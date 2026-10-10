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
// department NAME, never by patient age: a Pediatric / Paediatric department
// gets its own set, every other department (or none) DEFAULT.
export type VitalsCategory = 'PEDIATRIC' | 'DEFAULT';

const PEDIATRIC_VITALS: PatientVitalDefinition[] = [
  { key: 'pulse', label: 'PR', unit: 'bpm' },
  { key: 'respiratoryRate', label: 'RR', unit: '/min' },
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'bloodPressure', label: 'BP', unit: 'mmHg' },
  { key: 'height', label: 'Height/Length', unit: 'cm' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'headCircumference', label: 'Head Circumference', unit: 'cm' },
];

const DEFAULT_VITALS: PatientVitalDefinition[] = [
  { key: 'bloodPressure', label: 'BP', unit: 'mmHg' },
  { key: 'pulse', label: 'PR', unit: 'bpm' },
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'sugar', label: 'RBS', unit: 'mg/dL' },
  { key: 'bodyTemperature', label: 'Temp', unit: '°F' },
  { key: 'weight', label: 'Wt', unit: 'kg' },
];

// The department NAME decides the vitals set — never patient age: a
// Pediatric / Paediatric department gets the Pediatric set, and any other
// department (or none) the Default set.
export function getVitalsCategory(departmentName?: string | null): VitalsCategory {
  if (!departmentName) return 'DEFAULT';
  const d = departmentName.toLowerCase().trim();
  if (d.includes('non')) return 'DEFAULT';
  return (d.includes('pediatric') || d.includes('paediatric')) ? 'PEDIATRIC' : 'DEFAULT';
}

export function getPatientVitalDefinitions(category: VitalsCategory): PatientVitalDefinition[] {
  if (category === 'PEDIATRIC') return PEDIATRIC_VITALS;
  return DEFAULT_VITALS;
}

export function getPatientVitalsHeading(category: VitalsCategory): string {
  if (category === 'PEDIATRIC') return 'Pediatric Vitals';
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
