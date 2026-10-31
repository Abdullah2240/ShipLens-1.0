import type { Locale } from '@/i18n/routing';
import { TIMEZONE } from '../config/constants';

// Rules for every formatter: Latin digits in both locales, 3-digit grouping,
// money is formatted from decimal strings only, never from a floating point number.

const MONEY_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const INT_RE = /^(-?)(\d+)$/;
const BUSINESS_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-GB-u-nu-latn',
  ur: 'ur-PK-u-nu-latn',
};

function group(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Decimal string in, e.g. "1234.5" -> "PKR 1,234.50". Same output in every locale. */
export function formatMoney(amount: string, locale: Locale): string {
  void locale;
  if (typeof amount !== 'string') throw new TypeError('formatMoney expects a decimal string');
  const match = MONEY_RE.exec(amount);
  if (!match) throw new RangeError('formatMoney: invalid decimal string (max 2 decimals)');
  const [, sign = '', whole = '', fraction = ''] = match;
  const cents = fraction.padEnd(2, '0');
  const isZero = /^0*$/.test(whole) && cents === '00';
  return `${isZero ? '' : sign}PKR ${group(whole)}.${cents}`;
}

function dateFormatter(locale: Locale, timeZone: string, withTime: boolean) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  });
}

function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError('invalid Date');
  }
}

/** PKT business date (Asia/Karachi). Strings are YYYY-MM-DD business dates. */
export function formatDate(value: string | Date, locale: Locale): string {
  if (value instanceof Date) {
    assertValidDate(value);
    return dateFormatter(locale, TIMEZONE, false).format(value);
  }
  const match = typeof value === 'string' ? BUSINESS_DATE_RE.exec(value) : null;
  if (!match) throw new RangeError('formatDate: expected a YYYY-MM-DD business date');
  const [year = 0, month = 0, day = 0] = match.slice(1).map((part) => parseInt(part, 10));
  // Noon UTC with a UTC formatter: the host zone cannot move the calendar day.
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    noon.getUTCFullYear() !== year ||
    noon.getUTCMonth() !== month - 1 ||
    noon.getUTCDate() !== day
  ) {
    throw new RangeError('formatDate: not a real calendar date');
  }
  return dateFormatter(locale, 'UTC', false).format(noon);
}

/** An instant rendered in Asia/Karachi on a 24-hour clock. */
export function formatDateTime(instant: Date, locale: Locale): string {
  assertValidDate(instant);
  return dateFormatter(locale, TIMEZONE, true).format(instant);
}

/** Integer with 3-digit grouping and Latin digits. */
export function formatInt(value: number | string, locale: Locale): string {
  void locale;
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('formatInt: not a safe integer');
    text = String(value);
  } else {
    text = value;
  }
  const match = typeof text === 'string' ? INT_RE.exec(text) : null;
  if (!match) throw new RangeError('formatInt: expected an integer');
  const [, sign = '', digits = ''] = match;
  const isZero = /^0*$/.test(digits);
  return `${isZero ? '' : sign}${group(digits)}`;
}

/** Identifier (branch code, member ID, receipt number) shown with Latin digits. */
export function formatId(id: string): string {
  if (typeof id !== 'string') throw new TypeError('formatId expects a string');
  return id;
}
