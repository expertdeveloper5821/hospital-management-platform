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

export function getPatientVitalDefinitions(pediatric: boolean): PatientVitalDefinition[] {
  return pediatric ? PEDIATRIC_VITALS : NON_PEDIATRIC_VITALS;
}

export function getPatientVitalSlipLabel(definition: PatientVitalDefinition, pediatric: boolean): string {
  if (pediatric) {
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
