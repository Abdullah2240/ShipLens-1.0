import type { Locale } from '@/i18n/routing';

// Frozen signatures. Bodies are implemented by plan 06.
// Rules for every formatter: Latin digits in both locales, 3-digit grouping,
// money is formatted from decimal strings only, never from Number.

/** Decimal string in, e.g. "1234.5" -> "PKR 1,234.50". */
export function formatMoney(amount: string, locale: Locale): string {
  void amount;
  void locale;
  throw new Error('not implemented: plan 06');
}

/** PKT business date (Asia/Karachi). Strings are YYYY-MM-DD business dates. */
export function formatDate(value: string | Date, locale: Locale): string {
  void value;
  void locale;
  throw new Error('not implemented: plan 06');
}

/** An instant rendered in Asia/Karachi. */
export function formatDateTime(instant: Date, locale: Locale): string {
  void instant;
  void locale;
  throw new Error('not implemented: plan 06');
}

/** Integer with 3-digit grouping and Latin digits. */
export function formatInt(value: number | string, locale: Locale): string {
  void value;
  void locale;
  throw new Error('not implemented: plan 06');
}

/** Identifier (branch code, member ID, receipt number) shown with Latin digits. */
export function formatId(id: string): string {
  void id;
  throw new Error('not implemented: plan 06');
}
