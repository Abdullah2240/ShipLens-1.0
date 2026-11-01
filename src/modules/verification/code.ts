// Public verification codes for approved weekly reports.
//
// The database issues the codes (migration 202610311410_report_verification.sql): 10
// Crockford base32 characters carrying 50 random bits. This module only cleans up what a
// person types and formats stored codes for display. It is pure and never throws on user
// input.

/** Crockford base32: digits and capitals without I, L, O and U. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A stored code: exactly 10 characters of CODE_ALPHABET. Same rule as the table CHECK. */
export const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** Longer input is rejected before any processing. */
const MAX_INPUT_LENGTH = 32;

// Checked before uppercasing so that non-ASCII letters which uppercase to Latin capitals
// (dotless i to I, long s to S) are rejected instead of silently accepted.
const TYPED_CHARACTERS = /^[0-9A-Za-z -]*$/;

const LOOKALIKES: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };

/**
 * Turn a typed or scanned code into its stored form, or null when it cannot be one.
 * Accepts any case, spaces and hyphens, and the lookalikes O for 0 and I or L for 1.
 */
export function normaliseCode(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_INPUT_LENGTH) return null;
  const trimmed = raw.trim();
  if (!TYPED_CHARACTERS.test(trimmed)) return null;
  const code = trimmed
    .replace(/[ -]/g, '')
    .toUpperCase()
    .replace(/[OIL]/g, (c) => LOOKALIKES[c] ?? c);
  return CODE_PATTERN.test(code) ? code : null;
}

/** Display form 'ABCDE-FGHJK'. Throws on anything that is not a stored code (programming error). */
export function formatCode(code: string): string {
  if (!CODE_PATTERN.test(code)) {
    throw new Error('formatCode: not a stored verification code');
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
