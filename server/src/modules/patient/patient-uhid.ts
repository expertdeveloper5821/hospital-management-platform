// UHID format for newly registered patients: `PAT-<INITIALS><SEQ>`, e.g.
// Narayan Hospital → PAT-NH01, PAT-NH02, … PAT-NH99, PAT-NH100.
// Patients registered before this format keep their legacy random
// `PAT-XXXXXXXX` UHID — it is never rewritten.

export const UHID_PREFIX           = 'PAT-';
export const MAX_INITIALS_LENGTH   = 10;
export const FALLBACK_INITIALS     = 'H';
const        MIN_SEQUENCE_DIGITS   = 2;

/**
 * Derives the hospital initials from its name: the first letter of each word,
 * uppercased ("Narayan Hospital" → "NH", "St. Mary's Hospital" → "SMH").
 * Letters only — a digit in the initials would run into the sequence number.
 * Accented Latin letters are folded to ASCII; a name with no Latin letters at
 * all falls back to "H".
 */
export function hospitalInitials(name: string | null | undefined): string {
  const words = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .split(/[^A-Za-z]+/)
    .filter(Boolean);

  const initials = words.map((w) => w[0].toUpperCase()).join('').slice(0, MAX_INITIALS_LENGTH);
  return initials || FALLBACK_INITIALS;
}

export function formatUhid(initials: string, seq: number): string {
  return `${UHID_PREFIX}${initials}${String(seq).padStart(MIN_SEQUENCE_DIGITS, '0')}`;
}
