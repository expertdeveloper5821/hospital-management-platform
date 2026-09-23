import type { OutboxEntry } from './types';

/**
 * Orders outbox entries so that every entry appears after each of its
 * `dependsOn` entries (e.g. a manual payment for an offline-created patient
 * always syncs after that patient's own CREATE). A `dependsOn` id that isn't
 * present in the given list is treated as already satisfied (it synced and
 * was removed from the outbox in an earlier pass).
 *
 * Independent chains keep their original relative order (stable Kahn's
 * algorithm). If a cycle is somehow present — which the app's dependency
 * model should never produce — the remaining entries are appended in their
 * original order rather than dropped.
 */
export function topologicalOrder(entries: OutboxEntry[]): OutboxEntry[] {
  const byId = new Map(entries.map((e) => [e.clientOpId, e]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const entry of entries) {
    const relevantDeps = entry.dependsOn.filter((id) => byId.has(id));
    inDegree.set(entry.clientOpId, relevantDeps.length);
    for (const depId of relevantDeps) {
      const list = dependents.get(depId) ?? [];
      list.push(entry.clientOpId);
      dependents.set(depId, list);
    }
  }

  const ready = entries.filter((e) => inDegree.get(e.clientOpId) === 0).map((e) => e.clientOpId);
  const ordered: OutboxEntry[] = [];
  const visited = new Set<string>();

  while (ready.length > 0) {
    const id = ready.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    ordered.push(byId.get(id)!);

    for (const dependentId of dependents.get(id) ?? []) {
      const remaining = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, remaining);
      if (remaining === 0) ready.push(dependentId);
    }
  }

  if (ordered.length < entries.length) {
    for (const entry of entries) {
      if (!visited.has(entry.clientOpId)) ordered.push(entry);
    }
  }

  return ordered;
}
