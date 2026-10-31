// Pure Zod schemas for event input. No server imports, so the events editor can reuse them.
import { z } from 'zod';

export const EVENT_TITLE_MAX = 200;
export const EVENT_SUMMARY_MAX = 2000;
export const EVENT_LOCATION_MAX = 200;

const emptyToNull = (value: string): string | null => (value === '' ? null : value);

const titleEn = z
  .string({ error: 'required' })
  .trim()
  .min(1, { error: 'required' })
  .max(EVENT_TITLE_MAX, { error: 'too_long' });

/** Trimmed free text where an empty value means "none". */
const optionalText = (max: number) =>
  z
    .string({ error: 'invalid_type' })
    .trim()
    .max(max, { error: 'too_long' })
    .transform(emptyToNull)
    .nullable()
    .optional();

/** An instant written as ISO-8601 UTC with a trailing Z; an empty value means "none". */
const instant = z
  .string({ error: 'invalid_datetime' })
  .trim()
  .transform(emptyToNull)
  .pipe(z.iso.datetime({ offset: false, error: 'invalid_datetime' }).nullable())
  .nullable()
  .optional();

const branchId = z
  .string({ error: 'invalid_branch' })
  .trim()
  .transform(emptyToNull)
  .pipe(z.uuid({ error: 'invalid_branch' }).nullable())
  .nullable()
  .optional();

const fields = {
  titleUr: optionalText(EVENT_TITLE_MAX),
  summaryEn: optionalText(EVENT_SUMMARY_MAX),
  summaryUr: optionalText(EVENT_SUMMARY_MAX),
  location: optionalText(EVENT_LOCATION_MAX),
  startsAt: instant,
  endsAt: instant,
  branchId,
};

/** True when both instants are present and the end is earlier than the start. */
export function endsBeforeStart(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): boolean {
  return Boolean(startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt));
}

const datePairRule = (
  value: { startsAt?: string | null; endsAt?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (endsBeforeStart(value.startsAt, value.endsAt)) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'ends_before_start' });
  }
};

export const eventInputSchema = z.strictObject({ titleEn, ...fields }).superRefine(datePairRule);
export type EventInput = z.output<typeof eventInputSchema>;
export type EventInputDraft = z.input<typeof eventInputSchema>;

/**
 * Every field optional, at least one present. The date rule here only sees the patch;
 * the service re-checks the pair after merging it with the stored row.
 */
export const eventPatchSchema = z
  .strictObject({ titleEn: titleEn.optional(), ...fields })
  .refine((value) => Object.keys(value).length > 0, { error: 'empty_patch' })
  .superRefine(datePairRule);
export type EventPatch = z.output<typeof eventPatchSchema>;
export type EventPatchDraft = z.input<typeof eventPatchSchema>;
