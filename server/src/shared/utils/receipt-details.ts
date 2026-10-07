import { ITenant }  from '../../modules/tenant/tenant.model';
import { IPatient } from '../../modules/patient/patient.model';

// Letterhead fields printed at the top of every A5 payment receipt (generic
// and Lab), resolved from the payment's own tenant — never hardcoded.
export interface ReceiptHospitalDetails {
  hospitalName:               string;
  hospitalRegistrationNumber: string | null;
  hospitalAddress:            string | null;
}

// The onboarding form stores the hospital's registration certificate *number*
// here, but some legacy/seeded tenants hold a document path/S3 key instead —
// never print a file path on a receipt as if it were a registration number.
export function resolveRegistrationNumber(value: string | undefined | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (/[\\/]/.test(v) || /\.(pdf|png|jpe?g|webp|docx?)$/i.test(v)) return null;
  return v;
}

// e.g. "321 Lab Street, Mumbai, Maharashtra - 400001"
export function formatHospitalAddress(tenant: ITenant | null | undefined): string | null {
  const docs = tenant?.onboardingDocuments;
  const parts = [
    docs?.addressLine,
    docs?.city,
    [docs?.state, docs?.pincode].map((p) => p?.trim()).filter(Boolean).join(' - '),
  ].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function resolveReceiptHospitalDetails(tenant: ITenant | null | undefined): ReceiptHospitalDetails {
  return {
    hospitalName:               tenant?.branding?.displayName || tenant?.name || 'Hospital',
    hospitalRegistrationNumber: resolveRegistrationNumber(tenant?.onboardingDocuments?.registrationCertificate),
    hospitalAddress:            formatHospitalAddress(tenant),
  };
}

function calculateAge(dob: Date): number | null {
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return Math.max(0, age);
}

// Stored age wins; otherwise derived from the (decrypted) date of birth.
export function resolvePatientAge(patient: Pick<IPatient, 'age' | 'dateOfBirth'>): number | null {
  return patient.age ?? (patient.dateOfBirth ? calculateAge(new Date(patient.dateOfBirth)) : null);
}

// Derives 2-4 uppercase initials from the hospital display name for use in
// invoice numbers, e.g.:
//   "Narayan Hospital"        → "NH"
//   "City Care Hospital"      → "CCH"
//   "Apollo Multi-Speciality" → "AM"
// Single-word names use the first two characters ("Apollo" → "AP").
export function hospitalInitials(name: string): string {
  const words = name
    .replace(/[^a-zA-Z\s]/g, ' ')  // strip punctuation/numbers
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 'HO';
  if (words.length === 1) return (words[0].slice(0, 2)).toUpperCase();

  // Up to 4 initials from the first characters of each word (skip very short
  // connector words — "of", "and", "the", etc. — so they don't pollute the code).
  const SKIP = new Set(['OF', 'AND', 'THE', 'FOR', 'AT', 'IN', 'BY', 'TO', 'A']);
  const initials = words
    .filter((w) => !SKIP.has(w.toUpperCase()))
    .slice(0, 4)
    .map((w) => w[0].toUpperCase())
    .join('');

  return initials || words.map((w) => w[0].toUpperCase()).join('').slice(0, 4) || 'HO';
}

// e.g. hospitalInitials("Narayan Hospital") = "NH", counter = 1 → "INV-NH0001"
export function generateInvoiceNumber(hospitalName: string, counter: number): string {
  const initials = hospitalInitials(hospitalName);
  const padded   = String(counter).padStart(4, '0');
  return `INV-${initials}${padded}`;
}
