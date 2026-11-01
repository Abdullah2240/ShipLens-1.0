// Pure Zod schemas for branch input. No server imports, so client forms can reuse them.
import { z } from 'zod';
import { BRANCH_STATUSES } from '@/platform/config/constants';

const name = z
  .string({ error: 'required' })
  .trim()
  .min(2, { error: 'too_short' })
  .max(80, { error: 'too_long' });

/** Trimmed free text where an empty value means "none". */
const optionalText = (max: number) =>
  z
    .string({ error: 'invalid_type' })
    .trim()
    .max(max, { error: 'too_long' })
    .transform((value) => (value === '' ? null : value));

export const branchCreateSchema = z.strictObject({
  name,
  city: optionalText(60).nullable().optional(),
  summary: optionalText(500).nullable().optional(),
});
export type BranchCreateInput = z.output<typeof branchCreateSchema>;

export const branchPatchSchema = z
  .strictObject({
    name: name.optional(),
    city: optionalText(60).nullable().optional(),
    summary: optionalText(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'empty_patch' });
export type BranchPatch = z.output<typeof branchPatchSchema>;

export const branchTransitionSchema = z.strictObject({
  to: z.enum(BRANCH_STATUSES, { error: 'invalid_status' }),
});
export type BranchTransitionInput = z.output<typeof branchTransitionSchema>;

export const assignLeadSchema = z.strictObject({
  userId: z.uuid({ error: 'invalid_uuid' }),
});
export type AssignLeadInput = z.output<typeof assignLeadSchema>;

/** List filter, parsed leniently: an unknown status is dropped rather than rejected. */
export const branchListQuerySchema = z
  .object({ status: z.string().optional() })
  .transform(({ status }) => {
    const parsed = z.enum(BRANCH_STATUSES).safeParse(status);
    return parsed.success ? { status: parsed.data } : {};
  });
export type BranchListQuery = z.output<typeof branchListQuerySchema>;
