// Local-time date helpers for date-filter inputs.

/** Today's date as YYYY-MM-DD in local time (not UTC, to avoid a midnight off-by-one). */
export function todayLocalISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Clamps a YYYY-MM-DD string so it can never exceed today. Returns the input
 * unchanged when empty. ISO date strings compare lexicographically, so a plain
 * string comparison is correct here. Enforces the "no future date" rule in code,
 * not just via the input's `max` attribute.
 */
export function clampToToday(date: string): string {
  if (!date) return date;
  const today = todayLocalISO();
  return date > today ? today : date;
}
