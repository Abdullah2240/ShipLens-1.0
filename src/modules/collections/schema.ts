// Pure Zod schemas for collection input. No server imports, so client forms can reuse them.
// Issue messages are error codes.
import { z } from 'zod';
import { COLLECTION_STATUSES, type CollectionStatus } from '@/platform/config/constants';
import { moneyInputSchema } from '@/platform/money';
import { addDays, pktWeekStart } from '@/platform/time';
import type { CollectionQuery } from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is refused). */
export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}

const amount = z
  .string({ error: (issue) => (issue.input === undefined ? 'required' : 'invalid_money') })
  .pipe(moneyInputSchema);

const collectedOn = z
  .string({ error: (issue) => (issue.input === undefined ? 'required' : 'invalid_date') })
  .refine(isDateString, { error: 'invalid_date' });

const purpose = z
  .string({ error: 'required' })
  .trim()
  .min(2, { error: 'too_short' })
  .max(120, { error: 'too_long' });

const noteText = z.string({ error: 'invalid_type' }).trim().max(500, { error: 'too_long' });

export const collectionInputSchema = z.strictObject({
  amount,
  collectedOn,
  purpose,
  note: noteText.transform((value) => (value === '' ? undefined : value)).optional(),
});

export const collectionPatchSchema = z
  .strictObject({
    amount: amount.optional(),
    collectedOn: collectedOn.optional(),
    purpose: purpose.optional(),
    note: noteText
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'empty_patch' });

export const voidInputSchema = z.strictObject({
  reason: z
    .string({ error: 'required' })
    .trim()
    .min(3, { error: 'too_short' })
    .max(500, { error: 'too_long' }),
});

const uuid = z.uuid();
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** List filters, parsed leniently: invalid values are dropped, never rejected. */
export function parseCollectionQuery(
  params: Record<string, string | string[] | undefined>,
): CollectionQuery {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const branchId = first('branchId');
  const reportId = first('reportId');
  const weekStart = first('weekStart');
  const status = first('status');
  const rawLimit = first('limit');
  const limit =
    rawLimit && /^\d+$/.test(rawLimit) && Number.isSafeInteger(Number(rawLimit))
      ? Math.min(MAX_LIMIT, Math.max(1, Number(rawLimit)))
      : DEFAULT_LIMIT;
  return {
    ...(branchId && uuid.safeParse(branchId).success ? { branchId } : {}),
    ...(reportId && uuid.safeParse(reportId).success ? { reportId } : {}),
    ...(isDateString(weekStart) && pktWeekStart(weekStart) === weekStart ? { weekStart } : {}),
    ...(status && (COLLECTION_STATUSES as readonly string[]).includes(status)
      ? { status: status as CollectionStatus }
      : {}),
    limit,
  };
}
