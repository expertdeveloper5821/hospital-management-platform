import { formatPatientAge } from './patient-age';
import { getPatientCategory } from './patient-vitals';

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

  it.each([
    [{ age: 2, ageUnit: 'DAYS', dateOfBirth: null }, 'PEDIATRIC'],
    [{ age: 18, ageUnit: 'MONTHS', dateOfBirth: null }, 'PEDIATRIC'],
    [{ age: 17, ageUnit: 'YEARS', dateOfBirth: null }, 'PEDIATRIC'],
    [{ age: 18, ageUnit: 'YEARS', dateOfBirth: null }, 'NON_PEDIATRIC'],
    [{ age: null, ageUnit: undefined, dateOfBirth: '2024-01-01' }, 'PEDIATRIC'],
  ] as const)('classifies age input %o', (patient, expected) => {
    expect(getPatientCategory(patient)).toBe(expected);
  });
});
