import type { RootState } from '@/store';

function matchesId(item: unknown, idField: string, idValue: string): item is Record<string, unknown> {
  return !!item && typeof item === 'object' && (item as Record<string, unknown>)[idField] === idValue;
}

/**
 * Scans every cached RTK Query result for one whose `idField` matches
 * `idValue` — endpoint-agnostic on purpose, since the shared base query
 * (base.api.ts) can't import any of the 19 individual API slices (they all
 * import it) to look up a specific query by name. Matches three cached
 * shapes: a single entity object (getPatientById, getOPDVisitById, …), a
 * bare array (getOPDQueue), and a paginated/wrapped object (searchPatients,
 * listAdmissions, list{Pathology,Radiology}Requests: `{ data: [...], ... }`)
 * — covering both the "visited a detail page" and the much more common
 * "clicked a row in an already-loaded list" edit flows.
 */
export function findCachedEntityById(
  state: RootState,
  idField: string,
  idValue: string,
): Record<string, unknown> | null {
  const queries = state.api.queries as Record<string, { data?: unknown } | undefined>;

  for (const entry of Object.values(queries)) {
    const data = entry?.data;
    if (!data || typeof data !== 'object') continue;

    if (Array.isArray(data)) {
      const match = data.find((item) => matchesId(item, idField, idValue));
      if (match) return match;
      continue;
    }

    if (matchesId(data, idField, idValue)) return data;

    const nested = (data as Record<string, unknown>).data;
    if (Array.isArray(nested)) {
      const match = nested.find((item) => matchesId(item, idField, idValue));
      if (match) return match;
    }
  }

  return null;
}
