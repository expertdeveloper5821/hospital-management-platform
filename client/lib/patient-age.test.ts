import { formatPatientAge } from './patient-age';
import { getDepartmentNameById, getVitalDefinitions, getVitalsCategory } from './patient-vitals';

describe('formatPatientAge', () => {
  it.each([
    [2, 'DAYS', '2 days'],
    [3, 'MONTHS', '3 months'],
    [5, 'YEARS', '5 years'],
  ] as const)('formats %s %s', (age, ageUnit, expected) => {
    expect(formatPatientAge({ age, ageUnit, dateOfBirth: null })).toBe(expected);
  });

  it('keeps legacy age values in years when no unit was returned', () => {
    expect(formatPatientAge({ age: 5, dateOfBirth: null })).toBe('5 years');
  });
});

describe('department-name-based vitals selection', () => {
  const departments = [
    { departmentId: 'D-PED', name: 'Pediatric', vitalsProfile: 'PEDIATRIC' },
    { departmentId: 'D-NON', name: 'Non-Pediatric', vitalsProfile: 'NON_PEDIATRIC' },
    { departmentId: 'D-DEN', name: 'Dental', vitalsProfile: null },
  ] as never;
  const keys = (departmentId: string | null) =>
    getVitalDefinitions(getVitalsCategory(getDepartmentNameById(departmentId, departments))).map((d) => d.key);

  it('Pediatric: PR → RR → SpO₂ → BP → Height → Weight → Head Circ.', () => {
    expect(keys('D-PED')).toEqual(['pulse', 'respiratoryRate', 'spo2', 'bloodPressure', 'height', 'weight', 'headCircumference']);
  });

  it('Default (incl. Non-Pediatric): BP → PR → SpO₂ → RBS → Temp → Wt', () => {
    expect(keys('D-NON')).toEqual(['bloodPressure', 'pulse', 'spo2', 'sugar', 'bodyTemperature', 'weight']);
  });

  it.each([['D-DEN'], [null], ['D-UNKNOWN']] as const)('department %s: BP → PR → SpO₂ → RBS → Temp → Wt', (departmentId) => {
    expect(getVitalsCategory(getDepartmentNameById(departmentId, departments))).toBe('DEFAULT');
    expect(keys(departmentId)).toEqual(['bloodPressure', 'pulse', 'spo2', 'sugar', 'bodyTemperature', 'weight']);
  });
});
