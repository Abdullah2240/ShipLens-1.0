export const CONTENT_KEYS = ['about', 'programs', 'get-involved', 'contact'] as const;

export type ContentKey = (typeof CONTENT_KEYS)[number];

export function isContentKey(value: string): value is ContentKey {
  return (CONTENT_KEYS as readonly string[]).includes(value);
}
