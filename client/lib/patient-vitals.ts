import type { AgeUnit } from '@/store/types';
import { resolvePatientAge } from '@/lib/patient-age';

export type PatientCategory = 'PEDIATRIC' | 'NON_PEDIATRIC';

export type VitalKey =
  | 'bloodPressure'
  | 'pulse'
  | 'respiratoryRate'
  | 'spo2'
  | 'sugar'
  | 'bodyTemperature'
  | 'height'
  | 'weight'
  | 'headCircumference';

export interface VitalDefinition {
  key: VitalKey;
  label: string;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder: string;
}

export interface PatientVitalsAge {
  age: number | null;
  ageUnit?: AgeUnit | null;
  dateOfBirth: string | null;
}

export function getPatientCategory(patient: PatientVitalsAge | null | undefined): PatientCategory {
  const age = patient
    ? resolvePatientAge(patient.age, patient.ageUnit, patient.dateOfBirth)
    : null;

  if (!age) return 'NON_PEDIATRIC';

  const ageInYears = age.unit === 'YEARS'
    ? age.value
    : age.unit === 'MONTHS'
      ? age.value / 12
      : age.value / 365.2425;
  return ageInYears < 18 ? 'PEDIATRIC' : 'NON_PEDIATRIC';
}

export function getVitalDefinitions(category: PatientCategory): VitalDefinition[] {
  if (category === 'PEDIATRIC') {
    return [
      { key: 'pulse', label: 'PR', unit: 'bpm', min: 20, max: 250, step: 1, placeholder: 'e.g. 120' },
      { key: 'respiratoryRate', label: 'RR', unit: '/min', min: 1, max: 150, step: 1, placeholder: 'e.g. 30' },
      { key: 'spo2', label: 'SpO₂', unit: '%', min: 50, max: 100, step: 1, placeholder: 'e.g. 98' },
      { key: 'bloodPressure', label: 'BP', unit: 'mmHg', placeholder: 'e.g. 90/60' },
      { key: 'height', label: 'Height/Length', unit: 'cm', min: 20, max: 300, step: 0.1, placeholder: 'e.g. 65' },
      { key: 'weight', label: 'Weight', unit: 'kg', min: 0.1, max: 500, step: 0.1, placeholder: 'e.g. 6.5' },
      { key: 'headCircumference', label: 'Head Circumference', unit: 'cm', min: 10, max: 100, step: 0.1, placeholder: 'e.g. 40' },
    ];
  }

  return [
    { key: 'bloodPressure', label: 'BP', unit: 'mmHg', placeholder: 'e.g. 120/80' },
    { key: 'pulse', label: 'PR', unit: 'bpm', min: 20, max: 250, step: 1, placeholder: 'e.g. 72' },
    { key: 'spo2', label: 'SpO₂', unit: '%', min: 50, max: 100, step: 1, placeholder: 'e.g. 98' },
    { key: 'sugar', label: 'RBS', unit: 'mg/dL', min: 10, max: 1000, step: 1, placeholder: 'e.g. 90' },
    { key: 'bodyTemperature', label: 'Temperature', unit: '°F', min: 80, max: 115, step: 0.1, placeholder: 'e.g. 98.6' },
    { key: 'weight', label: 'Weight', unit: 'kg', min: 0.5, max: 500, step: 0.1, placeholder: 'e.g. 65.5' },
  ];
}

export function getVitalSlipLabel(definition: VitalDefinition, category: PatientCategory): string {
  if (category === 'PEDIATRIC') {
    if (definition.key === 'height') return 'Height';
    if (definition.key === 'headCircumference') return 'Head Circ.';
    return definition.label;
  }
  return definition.key === 'bodyTemperature' ? 'Temp' : definition.label;
}

export function parsePatientVital(
  key: VitalKey,
  rawValue: string,
  definition: VitalDefinition,
): { value: number | string | null; error?: string } {
  const raw = rawValue.trim();
  if (!raw) return { value: null };

  if (key === 'bloodPressure') {
    return /^\d{2,3}\/\d{2,3}$/.test(raw)
      ? { value: raw }
      : { value: null, error: 'Blood pressure must be in the format systolic/diastolic, e.g. 120/80.' };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < (definition.min ?? Number.NEGATIVE_INFINITY) || value > (definition.max ?? Number.POSITIVE_INFINITY)) {
    return { value: null, error: `${definition.label} must be between ${definition.min} and ${definition.max} ${definition.unit}.` };
  }
  return { value };
}

export function formatVitalValue(
  vitals: Partial<Record<VitalKey, number | string | null>> | null | undefined,
  definition: VitalDefinition,
): string | null {
  const value = vitals?.[definition.key];
  if (value === null || value === undefined || value === '') return null;
  return `${value} ${definition.unit}`;
}
