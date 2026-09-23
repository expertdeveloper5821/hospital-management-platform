import type { TempIdRef } from './types';

export class UnresolvedTempIdError extends Error {
  constructor(public tempId: string) {
    super(`Temp id "${tempId}" has not been resolved yet — its dependency hasn't synced.`);
    this.name = 'UnresolvedTempIdError';
  }
}

function setDeep(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor[segments[i]];
    cursor = (typeof next === 'object' && next !== null ? next : {}) as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

/**
 * Returns a copy of `payload` with every `tempIdRefs` path rewritten to the
 * real id the referenced dependency resolved to. Throws UnresolvedTempIdError
 * if a dependency hasn't synced yet — callers must respect topological order
 * (see topological-sort.ts) so this never happens in practice.
 */
export function resolveTempIdRefs(
  payload: Record<string, unknown>,
  tempIdRefs: TempIdRef[],
  resolvedIds: Map<string, string>,
): Record<string, unknown> {
  if (tempIdRefs.length === 0) return payload;

  const result = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

  for (const ref of tempIdRefs) {
    const resolved = resolvedIds.get(ref.tempId);
    if (resolved === undefined) {
      throw new UnresolvedTempIdError(ref.tempId);
    }
    setDeep(result, ref.path, resolved);
  }

  return result;
}
