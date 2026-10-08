import type { AgeUnit, PatientResponse } from '@/store/types';

interface PatientAgeInput {
  age: number | null;
  ageUnit?: AgeUnit | null;
  dateOfBirth: string | null;
}

function ageFromDob(dateOfBirth: string): { value: number; unit: AgeUnit } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  const parsed = match
    ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
    : (() => {
        const dob = new Date(dateOfBirth);
        return Number.isNaN(dob.getTime())
          ? null
          : { year: dob.getFullYear(), month: dob.getMonth() + 1, day: dob.getDate() };
      })();
  if (!parsed) return null;
  const checkedDob = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  if (
    checkedDob.getUTCFullYear() !== parsed.year ||
    checkedDob.getUTCMonth() + 1 !== parsed.month ||
    checkedDob.getUTCDate() !== parsed.day
  ) return null;

  const today = new Date();
  let years = today.getFullYear() - parsed.year;
  if (
    today.getMonth() + 1 < parsed.month ||
    (today.getMonth() + 1 === parsed.month && today.getDate() < parsed.day)
  ) years--;
  if (years > 0) return { value: years, unit: 'YEARS' };

  let months = (today.getFullYear() - parsed.year) * 12 + today.getMonth() + 1 - parsed.month;
  if (today.getDate() < parsed.day) months--;
  if (months > 0) return { value: months, unit: 'MONTHS' };

  const dayStart = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const todayStart = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return { value: Math.max(0, Math.floor((todayStart - dayStart) / 86_400_000)), unit: 'DAYS' };
}

export function formatPatientAge({ age, ageUnit, dateOfBirth }: PatientAgeInput): string | null {
  const resolved = resolvePatientAge(age, ageUnit, dateOfBirth);
  if (!resolved) return null;
  const label = resolved.unit.toLowerCase().replace(/s$/, '');
  return `${resolved.value} ${label}${resolved.value === 1 ? '' : 's'}`;
}

export function resolvePatientAge(
  age: number | null,
  ageUnit: AgeUnit | null | undefined,
  dateOfBirth: string | null,
): { value: number; unit: AgeUnit } | null {
  return age !== null
    ? { value: age, unit: ageUnit ?? 'YEARS' }
    : dateOfBirth ? ageFromDob(dateOfBirth) : null;
}

export function formatPatientResponseAge(patient: PatientResponse): string | null {
  return formatPatientAge(patient);
}
