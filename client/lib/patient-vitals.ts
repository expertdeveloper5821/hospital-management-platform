import type { DepartmentResponse, VitalsProfile } from '@/store/types';

// The vitals set is decided only by the OPD visit's / IPD admission's
// department, never by patient age: the Pediatric / Non-Pediatric system
// departments get their own set, every other department (or none) DEFAULT.
export type VitalsCategory = VitalsProfile | 'DEFAULT';

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

// The vitals profile of the selected/saved department — set only on the
// Pediatric / Non-Pediatric departments, null for any other (or none).
export function getVitalsProfile(
  departmentId: string | null | undefined,
  departments: DepartmentResponse[] | null | undefined,
): VitalsProfile | null {
  if (!departmentId) return null;
  return departments?.find((d) => d.departmentId === departmentId)?.vitalsProfile ?? null;
}

export function getVitalsCategory(
  departmentId: string | null | undefined,
  departments: DepartmentResponse[] | null | undefined,
): VitalsCategory {
  return getVitalsProfile(departmentId, departments) ?? 'DEFAULT';
}

export function getVitalsHeading(category: VitalsCategory): string {
  if (category === 'PEDIATRIC') return 'Pediatric Vitals';
  if (category === 'NON_PEDIATRIC') return 'Non-Pediatric Vitals';
  return 'Vitals';
}

export function getVitalDefinitions(category: VitalsCategory): VitalDefinition[] {
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

  if (category === 'NON_PEDIATRIC') {
    return [
      { key: 'bloodPressure', label: 'BP', unit: 'mmHg', placeholder: 'e.g. 120/80' },
      { key: 'pulse', label: 'PR', unit: 'bpm', min: 20, max: 250, step: 1, placeholder: 'e.g. 72' },
      { key: 'spo2', label: 'SpO₂', unit: '%', min: 50, max: 100, step: 1, placeholder: 'e.g. 98' },
      { key: 'sugar', label: 'RBS', unit: 'mg/dL', min: 10, max: 1000, step: 1, placeholder: 'e.g. 90' },
      { key: 'bodyTemperature', label: 'Temperature', unit: '°F', min: 80, max: 115, step: 0.1, placeholder: 'e.g. 98.6' },
      { key: 'weight', label: 'Weight', unit: 'kg', min: 0.5, max: 500, step: 0.1, placeholder: 'e.g. 65.5' },
    ];
  }

  return [
    { key: 'spo2', label: 'SpO₂', unit: '%', min: 50, max: 100, step: 1, placeholder: 'e.g. 98' },
    { key: 'bodyTemperature', label: 'Temperature', unit: '°F', min: 80, max: 115, step: 0.1, placeholder: 'e.g. 98.6' },
    { key: 'bloodPressure', label: 'BP', unit: 'mmHg', placeholder: 'e.g. 120/80' },
    { key: 'pulse', label: 'Pulse', unit: 'bpm', min: 20, max: 250, step: 1, placeholder: 'e.g. 72' },
    { key: 'height', label: 'Height', unit: 'cm', min: 20, max: 300, step: 0.1, placeholder: 'e.g. 165' },
    { key: 'weight', label: 'Weight', unit: 'kg', min: 0.5, max: 500, step: 0.1, placeholder: 'e.g. 65.5' },
  ];
}

export function getVitalSlipLabel(definition: VitalDefinition, category: VitalsCategory): string {
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
