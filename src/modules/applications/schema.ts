import { z } from 'zod';

export const APPLICATION_ERROR_CODES = [
  'required',
  'too_short',
  'too_long',
  'invalid_email',
  'invalid_phone',
  'invalid_branch',
] as const;

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === null ? '' : value),
    z
      .string({ error: 'required' })
      .trim()
      .max(max, { error: 'too_long' })
      .transform((value) => value || null),
  );

const phoneSchema = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? null : value),
  z
    .string({ error: 'invalid_phone' })
    .transform((value) => value.replace(/[\s\-()]/g, ''))
    .refine((value) => /^(?:\+?92|0092|0)?(3\d{9})$/.test(value), { error: 'invalid_phone' })
    .transform((value) => `+92${value.match(/^(?:\+?92|0092|0)?(3\d{9})$/)![1]}`)
    .nullable(),
);

export const applicationInputSchema = z.strictObject({
  fullName: z
    .string({ error: 'required' })
    .trim()
    .min(1, { error: 'required' })
    .min(2, { error: 'too_short' })
    .max(100, { error: 'too_long' }),
  email: z
    .string({ error: 'required' })
    .trim()
    .toLowerCase()
    .min(1, { error: 'required' })
    .max(254, { error: 'too_long' })
    .pipe(z.email({ error: 'invalid_email' })),
  phone: phoneSchema,
  message: optionalText(1000),
  branchId: z.uuid({ error: 'invalid_branch' }),
  website: z.string({ error: 'required' }).max(200, { error: 'too_long' }).optional(),
});

export type ApplicationInput = z.output<typeof applicationInputSchema>;
export type ApplicationFormValues = z.input<typeof applicationInputSchema>;
