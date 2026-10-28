import { AUDIT_FIELD_ALLOWLIST } from './allowlist';

type Scalar = string | number | boolean | null;
type Snapshot = Record<string, Scalar>;

export interface SnapshotPair {
  before: Snapshot | null;
  after: Snapshot | null;
}

function allowedFields(entityType: string): readonly string[] {
  if (!Object.hasOwn(AUDIT_FIELD_ALLOWLIST, entityType)) {
    throw new Error(`Unknown audit entity type: ${entityType}`);
  }
  return AUDIT_FIELD_ALLOWLIST[entityType]!;
}

function toScalar(entityType: string, field: string, value: unknown): Scalar {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    default:
      throw new Error(`Audit field ${entityType}.${field} must be a scalar`);
  }
}

function pick(
  entityType: string,
  fields: readonly string[],
  source: object,
  only?: Set<string>,
): Snapshot {
  const out: Snapshot = {};
  const record = source as Record<string, unknown>;
  for (const field of fields) {
    if (only && !only.has(field)) continue;
    if (record[field] === undefined) continue;
    out[field] = toScalar(entityType, field, record[field]);
  }
  return out;
}

/**
 * Allowlisted, changed-fields-only before/after snapshots. Create (before null) keeps every
 * allowlisted field of `after`; delete-like (after null) keeps `before` only. For updates,
 * fields missing from `after` are treated as untouched. Unknown entity types throw.
 */
export function snapshotChanges(
  entityType: string,
  before: object | null | undefined,
  after: object | null | undefined,
): SnapshotPair {
  const fields = allowedFields(entityType);

  if (!before && !after) return { before: null, after: null };
  if (!before) return { before: null, after: pick(entityType, fields, after!) };
  if (!after) return { before: pick(entityType, fields, before), after: null };

  const afterSnap = pick(entityType, fields, after);
  const beforeAll = pick(entityType, fields, before);
  const changed = new Set<string>();
  for (const field of Object.keys(afterSnap)) {
    if ((beforeAll[field] ?? null) !== afterSnap[field]) changed.add(field);
  }

  const beforeOut: Snapshot = {};
  const afterOut: Snapshot = {};
  for (const field of fields) {
    if (!changed.has(field)) continue;
    beforeOut[field] = beforeAll[field] ?? null;
    afterOut[field] = afterSnap[field]!;
  }
  return { before: beforeOut, after: afterOut };
}
