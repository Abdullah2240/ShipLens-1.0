import { z } from 'zod';
import { APPLICATION_STATUSES } from '@/platform/config/constants';
import type { ApplicationListQuery } from './review-types';

export const DEFAULT_APPLICATION_PAGE_SIZE = 25;
export const MAX_APPLICATION_PAGE_SIZE = 100;
const MAX_PAGE = 100_000;

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

// Unparseable values fall back to the default; out-of-range integers are clamped.
const intParam = (fallback: number, max: number) =>
  z
    .preprocess((value) => {
      const raw = first(value);
      if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw;
      if (typeof raw === 'string' && /^-?\d{1,9}$/.test(raw.trim())) return Number(raw.trim());
      return fallback;
    }, z.number().int())
    .transform((value) => Math.min(max, Math.max(1, value)));

export const applicationListQuerySchema = z.object({
  status: z.preprocess(first, z.enum(APPLICATION_STATUSES).optional().catch(undefined)),
  page: intParam(1, MAX_PAGE),
  pageSize: intParam(DEFAULT_APPLICATION_PAGE_SIZE, MAX_APPLICATION_PAGE_SIZE),
});

/** Parses list query parameters. Never throws: bad values become defaults. */
export function parseApplicationListQuery(
  params: Record<string, string | string[] | undefined>,
): ApplicationListQuery {
  const parsed = applicationListQuerySchema.safeParse(params ?? {});
  if (!parsed.success) return { page: 1, pageSize: DEFAULT_APPLICATION_PAGE_SIZE };
  const { status, page, pageSize } = parsed.data;
  return { ...(status ? { status } : {}), page, pageSize };
}

export const declineInputSchema = z.strictObject({
  note: z
    .string({ error: 'invalid_type' })
    .trim()
    .max(500, { error: 'too_long' })
    .transform((value) => value || undefined)
    .optional(),
});

export type DeclineInput = z.output<typeof declineInputSchema>;
