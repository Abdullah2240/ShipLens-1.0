import type { TimelineChange } from './types';

type Snapshot = Record<string, unknown> | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Snapshots are JSON values from jsonb columns, so structural equality is enough.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
  }
  return false;
}

function valueOf(snapshot: Snapshot, key: string): unknown {
  if (!snapshot || !Object.hasOwn(snapshot, key)) return null;
  return snapshot[key] ?? null;
}

/** Field-level changes between two audit snapshots; a missing key counts as null. */
export function diffSnapshots(before: Snapshot, after: Snapshot): TimelineChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: TimelineChange[] = [];
  for (const field of [...keys].sort()) {
    const from = valueOf(before, field);
    const to = valueOf(after, field);
    if (!sameValue(from, to)) changes.push({ field, before: from, after: to });
  }
  return changes;
}
