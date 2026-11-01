import { z } from 'zod';
import { isContentKey } from '@/modules/public-site/keys';
import { NotFound } from '@/platform/errors';
import { CONTENT_LOCALES, type ContentKey, type ContentLocale } from './types';

export const TITLE_MAX = 200;
export const BODY_MAX = 20000;

const emptyToNull = (value: string): string | null => (value === '' ? null : value);

const title = z
  .string({ error: 'invalid_type' })
  .trim()
  .max(TITLE_MAX, { error: 'too_long' })
  .transform(emptyToNull);

// The body is stored as typed (only line endings are normalised); rendering is where
// markup is made safe.
const body = z
  .string({ error: 'invalid_type' })
  .transform((value) => value.replace(/\r\n?/g, '\n'))
  .pipe(z.string().max(BODY_MAX, { error: 'too_long' }))
  .transform(emptyToNull);

export const draftInputSchema = z.strictObject({
  title: title.nullable().optional(),
  body: body.nullable().optional(),
});
export type DraftInputParsed = z.output<typeof draftInputSchema>;

/** Validates route params; any unknown key or locale is the shared 404. */
export function parseEntryParams(
  key: string,
  locale: string,
): { key: ContentKey; locale: ContentLocale } {
  if (!isContentKey(key) || !(CONTENT_LOCALES as readonly string[]).includes(locale)) {
    throw new NotFound();
  }
  return { key, locale: locale as ContentLocale };
}
