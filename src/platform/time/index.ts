// Time is injected through a Clock. Business dates are plain 'YYYY-MM-DD' strings on the
// PKT calendar, never Date objects. Date arithmetic runs in UTC so the host time zone
// has no effect.
import { TIMEZONE, WEEK_START } from '../config/constants';

export type DateString = string;

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(initial: string | Date): Clock & {
  set(d: string | Date): void;
  advance(ms: number): void;
} {
  let current = toInstant(initial);
  return {
    now: () => new Date(current),
    set(d) {
      current = toInstant(d);
    },
    advance(ms) {
      current += ms;
    },
  };
}

function toInstant(value: string | Date): number {
  const instant = new Date(value).getTime();
  if (Number.isNaN(instant)) throw new RangeError('invalid instant');
  return instant;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(value: DateString): number {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (!match) throw new RangeError(`invalid date: ${String(value)}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  // Round-trip so impossible dates such as 2026-02-30 are rejected.
  if (formatDate(utc) !== value) throw new RangeError(`invalid date: ${value}`);
  return utc;
}

function formatDate(utc: number): DateString {
  const d = new Date(utc);
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const MS_PER_DAY = 86_400_000;

const pktFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The PKT calendar date of an instant. */
export function pktDate(instant: Date): DateString {
  const parts = pktFormatter.formatToParts(instant);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** The Monday on or before the given date. Only a Monday week start is supported. */
export function pktWeekStart(date: DateString): DateString {
  if (WEEK_START !== 'monday') throw new Error('only a Monday week start is supported');
  const utc = parseDate(date);
  const sinceMonday = (new Date(utc).getUTCDay() + 6) % 7;
  return formatDate(utc - sinceMonday * MS_PER_DAY);
}

/** 'YYYY-MM' of a date. */
export function pktMonth(date: DateString): string {
  parseDate(date);
  return date.slice(0, 7);
}

export function addDays(date: DateString, days: number): DateString {
  return formatDate(parseDate(date) + days * MS_PER_DAY);
}

/** Later minus earlier, in whole days. Negative when reversed. */
export function daysBetween(earlier: DateString, later: DateString): number {
  return Math.round((parseDate(later) - parseDate(earlier)) / MS_PER_DAY);
}
