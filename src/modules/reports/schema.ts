// Pure Zod schemas for report input. No server imports, so client forms can reuse them.
import { z } from 'zod';
import { REPORT_STATUSES } from '@/platform/config/constants';
import { pktWeekStart } from '@/platform/time';
import type { ReportQuery } from './types';

export const DEFAULT_REPORT_LIMIT = 60;
export const MAX_REPORT_LIMIT = 500;

/** Clients always send a JSON body, `{}` at minimum. */
export const submitInputSchema = z.strictObject({
  confirmNil: z.boolean({ error: 'invalid_type' }).optional(),
});
export type SubmitInput = z.output<typeof submitInputSchema>;

export const returnInputSchema = z.strictObject({
  reason: z
    .string({ error: 'required' })
    .trim()
    .min(3, { error: 'too_short' })
    .max(500, { error: 'too_long' }),
});
export type ReturnInput = z.output<typeof returnInputSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

function mondayOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return pktWeekStart(value) === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function limitOf(value: unknown): number {
  const raw = first(value);
  if (typeof raw !== 'string' || !/^-?\d{1,9}$/.test(raw.trim())) return DEFAULT_REPORT_LIMIT;
  return Math.min(MAX_REPORT_LIMIT, Math.max(1, Number(raw.trim())));
}

/** List filters. Never throws: invalid values are dropped and the limit is clamped. */
export function parseReportQuery(
  params: Record<string, string | string[] | undefined> | null | undefined,
): ReportQuery {
  const source = params ?? {};
  const out: ReportQuery = { limit: limitOf(source.limit) };
  const status = z.enum(REPORT_STATUSES).safeParse(first(source.status));
  if (status.success) out.status = status.data;
  const branchId = first(source.branchId);
  if (typeof branchId === 'string' && UUID.test(branchId)) out.branchId = branchId.toLowerCase();
  const weekStart = mondayOrUndefined(first(source.weekStart));
  if (weekStart) out.weekStart = weekStart;
  return out;
}
