// Reporting filters: parsing never throws, invalid values are dropped. Pure.
import { addDays, type DateString } from '@/platform/time';
import type { PageQuery, ReportingFilters } from './types';

export const REPORTING_LIMITS = Object.freeze({
  traceMaxRows: 500,
  unroutedPageSize: 50,
  maxPageSize: 200,
  impactCacheSeconds: 60,
} as const);

// Years 2000..2099 keep every range small and every month a valid calendar month.
const MONTH = /^20\d{2}-(?:0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d+$/;
const MAX_PAGE = 1_000_000;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function single(params: ParamSource, key: string): string | undefined {
  if (params instanceof URLSearchParams) {
    const values = params.getAll(key);
    return values.length === 1 ? values[0] : undefined;
  }
  if (!Object.hasOwn(params, key)) return undefined;
  const value: unknown = params[key];
  return typeof value === 'string' ? value : undefined;
}

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function parseReportingFilters(params: ParamSource): ReportingFilters {
  const out: ReportingFilters = {};
  try {
    let from = single(params, 'from');
    let to = single(params, 'to');
    const branch = single(params, 'branch');
    if (!isMonth(from)) from = undefined;
    if (!isMonth(to)) to = undefined;
    if (from && to && from > to) [from, to] = [to, from];
    if (from) out.from = from;
    if (to) out.to = to;
    if (isUuid(branch)) out.branch = branch.toLowerCase();
  } catch {
    return {};
  }
  return out;
}

/** Re-validates filters that did not come through parseReportingFilters. */
export function normaliseFilters(filters: ReportingFilters | undefined): ReportingFilters {
  if (!filters || typeof filters !== 'object') return {};
  const source: Record<string, string | undefined> = {};
  for (const key of ['from', 'to', 'branch'] as const) {
    const value: unknown = filters[key];
    if (typeof value === 'string') source[key] = value;
  }
  return parseReportingFilters(source);
}

/** Canonical query string: from, to, branch in that order; '' when empty. */
export function toSearchParams(filters: ReportingFilters): string {
  const parts: string[] = [];
  for (const key of ['from', 'to', 'branch'] as const) {
    const value = filters[key];
    if (value) parts.push(`${key}=${encodeURIComponent(value)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** First day of the month after `month`. Day 28 plus 4 always lands in the next month. */
function firstOfNextMonth(month: string): DateString {
  return `${addDays(`${month}-28`, 4).slice(0, 7)}-01`;
}

export function lastDayOfMonth(month: string): DateString {
  return addDays(firstOfNextMonth(month), -1);
}

export function monthBounds(filters: ReportingFilters): {
  fromDate: DateString | null;
  toDate: DateString | null;
} {
  return {
    fromDate: isMonth(filters.from) ? `${filters.from}-01` : null,
    toDate: isMonth(filters.to) ? lastDayOfMonth(filters.to) : null,
  };
}

/** Every month from `from` to `to` inclusive; empty when from > to. Throws on a malformed month. */
export function monthsBetween(from: string, to: string): string[] {
  if (!isMonth(from) || !isMonth(to)) throw new RangeError('invalid month');
  const months: string[] = [];
  for (let month = from; month <= to; month = firstOfNextMonth(month).slice(0, 7)) {
    months.push(month);
  }
  return months;
}

/** A non-negative integer parameter; very long digit strings saturate instead of overflowing. */
function parseWhole(value: string | undefined): number | undefined {
  if (value === undefined || !DIGITS.test(value)) return undefined;
  return value.length > 7 ? MAX_PAGE : Number.parseInt(value, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function parsePageQuery(
  params: ParamSource,
  defaults: { pageSize?: number } = {},
): PageQuery {
  const fallbackSize = defaults.pageSize ?? REPORTING_LIMITS.unroutedPageSize;
  return {
    page: clamp(parseWhole(single(params, 'page')) ?? 1, 1, MAX_PAGE),
    pageSize: clamp(
      parseWhole(single(params, 'pageSize')) ?? fallbackSize,
      1,
      REPORTING_LIMITS.maxPageSize,
    ),
  };
}
