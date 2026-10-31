// Audit viewer query parsing: never throws, invalid values are dropped. Pure.
import { addDays } from '@/platform/time';
import type { AuditQuery } from './types';

export const AUDIT_LIMITS = Object.freeze({ defaultLimit: 50, maxLimit: 200 } as const);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z_]+\.[a-z_]+$/;
const ENTITY = /^[a-z_]+$/;
const ENTITY_ID = /^[A-Za-z0-9-]{1,64}$/;
const BEFORE = /^\d{1,18}$/;
const DIGITS = /^\d+$/;
const MAX_TEXT = 64;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

/** The value of a key given exactly once as a string; repeated keys and arrays are dropped. */
function single(params: ParamSource, key: string): string | undefined {
  if (params instanceof URLSearchParams) {
    const values = params.getAll(key);
    return values.length === 1 ? values[0] : undefined;
  }
  if (!Object.hasOwn(params, key)) return undefined;
  const value: unknown = params[key];
  return typeof value === 'string' ? value : undefined;
}

/** A real calendar date in YYYY-MM-DD form. */
function isDate(value: string | undefined): value is string {
  if (value === undefined || !DATE.test(value)) return false;
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}

function matches(value: string | undefined, pattern: RegExp): value is string {
  return value !== undefined && value.length <= MAX_TEXT && pattern.test(value);
}

function parseLimit(value: string | undefined): number {
  if (value === undefined || !DIGITS.test(value)) return AUDIT_LIMITS.defaultLimit;
  const n = value.length > 6 ? AUDIT_LIMITS.maxLimit : Number.parseInt(value, 10);
  return Math.min(Math.max(n, 1), AUDIT_LIMITS.maxLimit);
}

export function parseAuditQuery(params: ParamSource): AuditQuery {
  try {
    const out: AuditQuery = { limit: parseLimit(single(params, 'limit')) };
    let from = single(params, 'from');
    let to = single(params, 'to');
    if (!isDate(from)) from = undefined;
    if (!isDate(to)) to = undefined;
    if (from && to && from > to) [from, to] = [to, from];
    if (from) out.from = from;
    if (to) out.to = to;

    const actor = single(params, 'actor');
    if (matches(actor, UUID)) out.actor = actor.toLowerCase();
    const branch = single(params, 'branch');
    if (matches(branch, UUID)) out.branch = branch.toLowerCase();
    const action = single(params, 'action');
    if (matches(action, ACTION)) out.action = action;
    const entity = single(params, 'entity');
    if (matches(entity, ENTITY)) out.entity = entity;
    const entityId = single(params, 'entityId');
    if (matches(entityId, ENTITY_ID)) out.entityId = entityId;
    const before = single(params, 'before');
    if (matches(before, BEFORE)) out.before = before;
    return out;
  } catch {
    return { limit: AUDIT_LIMITS.defaultLimit };
  }
}
