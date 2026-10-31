import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n/routing';
import { formatDate, formatDateTime, formatId, formatInt, formatMoney } from './format';

const LOCALES: Locale[] = ['en', 'ur'];
const NON_LATIN_DIGITS = /[٠-٩۰-۹]/;

describe('formatMoney', () => {
  it('formats zero and grouped amounts identically in both locales', () => {
    for (const locale of LOCALES) {
      expect(formatMoney('0', locale)).toBe('PKR 0.00');
      expect(formatMoney('1234567.5', locale)).toBe('PKR 1,234,567.50');
      expect(formatMoney('12.05', locale)).toBe('PKR 12.05');
      expect(formatMoney('999', locale)).toBe('PKR 999.00');
    }
  });

  it('keeps every digit above 2^53', () => {
    expect(formatMoney('9007199254740993.10', 'en')).toBe('PKR 9,007,199,254,740,993.10');
    expect(formatMoney('123456789012345678901234567890.99', 'ur')).toBe(
      'PKR 123,456,789,012,345,678,901,234,567,890.99',
    );
  });

  it('puts the sign before the currency', () => {
    expect(formatMoney('-1500', 'en')).toBe('-PKR 1,500.00');
    expect(formatMoney('-0.5', 'ur')).toBe('-PKR 0.50');
  });

  it('does not show a negative zero', () => {
    expect(formatMoney('-0', 'en')).toBe('PKR 0.00');
    expect(formatMoney('-0.00', 'en')).toBe('PKR 0.00');
  });

  it('drops leading zeros', () => {
    expect(formatMoney('0001234.5', 'en')).toBe('PKR 1,234.50');
  });

  it('always groups by three, never lakh style', () => {
    expect(formatMoney('100000', 'ur')).toBe('PKR 100,000.00');
    expect(formatMoney('10000000', 'en')).toBe('PKR 10,000,000.00');
  });

  it('rejects invalid input', () => {
    expect(() => formatMoney('12.345', 'en')).toThrow();
    expect(() => formatMoney('abc', 'en')).toThrow();
    expect(() => formatMoney('', 'en')).toThrow();
    expect(() => formatMoney('1e5', 'en')).toThrow();
    expect(() => formatMoney('1,000', 'en')).toThrow();
    expect(() => formatMoney(' 1', 'en')).toThrow();
    expect(() => formatMoney('1.', 'en')).toThrow();
    expect(() => formatMoney('.5', 'en')).toThrow();
    expect(() => formatMoney('١٢', 'ur')).toThrow();
    expect(() => formatMoney(12 as unknown as string, 'en')).toThrow();
  });
});

describe('formatInt', () => {
  it('groups by three with Latin digits', () => {
    expect(formatInt(1234567, 'ur')).toBe('1,234,567');
    expect(formatInt('42', 'en')).toBe('42');
    expect(formatInt(0, 'en')).toBe('0');
    expect(formatInt(-1000, 'en')).toBe('-1,000');
    expect(formatInt('9007199254740993', 'en')).toBe('9,007,199,254,740,993');
  });

  it('rejects non-integers', () => {
    expect(() => formatInt(1.5, 'en')).toThrow();
    expect(() => formatInt(Number.NaN, 'en')).toThrow();
    expect(() => formatInt(Number.POSITIVE_INFINITY, 'en')).toThrow();
    expect(() => formatInt('1.5', 'en')).toThrow();
    expect(() => formatInt('', 'en')).toThrow();
    expect(() => formatInt('x', 'en')).toThrow();
  });
});

describe('formatDate', () => {
  it('formats a business date in English', () => {
    expect(formatDate('2026-10-26', 'en')).toBe('26 Oct 2026');
    expect(formatDate('2026-01-01', 'en')).toBe('1 Jan 2026');
  });

  it('formats a business date in Urdu with Latin digits', () => {
    const out = formatDate('2026-10-26', 'ur');
    expect(out).toContain('26');
    expect(out).toContain('2026');
    expect(out).not.toMatch(NON_LATIN_DIGITS);
    expect(out).not.toBe(formatDate('2026-10-26', 'en'));
  });

  it('keeps the same calendar day regardless of host time zone', () => {
    // Midnight and just before midnight UTC must not move the day.
    expect(formatDate('2026-10-26', 'en')).toBe('26 Oct 2026');
    expect(formatDate('2026-12-31', 'en')).toBe('31 Dec 2026');
    expect(formatDate('2026-03-01', 'en')).toBe('1 Mar 2026');
  });

  it('renders a Date value as its Asia/Karachi calendar day', () => {
    // 19:00 UTC on the 25th is already the 26th in Karachi.
    expect(formatDate(new Date('2026-10-25T19:00:00Z'), 'en')).toBe('26 Oct 2026');
    expect(formatDate(new Date('2026-10-25T18:59:00Z'), 'en')).toBe('25 Oct 2026');
  });

  it('rejects malformed or impossible dates', () => {
    expect(() => formatDate('2026-02-30', 'en')).toThrow();
    expect(() => formatDate('2026-13-01', 'en')).toThrow();
    expect(() => formatDate('26/10/2026', 'en')).toThrow();
    expect(() => formatDate('2026-10-26T00:00:00Z', 'en')).toThrow();
    expect(() => formatDate('', 'en')).toThrow();
    expect(() => formatDate(new Date('nope'), 'en')).toThrow();
  });
});

describe('formatDateTime', () => {
  it('renders an instant in Asia/Karachi on a 24-hour clock', () => {
    const out = formatDateTime(new Date('2026-10-25T19:00:00Z'), 'en');
    expect(out).toContain('26 Oct 2026');
    expect(out).toContain('00:00');
    expect(out).not.toContain('25 Oct');
  });

  it('uses 24-hour time in the afternoon', () => {
    const out = formatDateTime(new Date('2026-10-26T09:05:00Z'), 'en');
    expect(out).toContain('14:05');
  });

  it('keeps Latin digits in Urdu', () => {
    const out = formatDateTime(new Date('2026-10-25T19:00:00Z'), 'ur');
    expect(out).toContain('26');
    expect(out).toContain('2026');
    expect(out).toContain('00:00');
    expect(out).not.toMatch(NON_LATIN_DIGITS);
  });

  it('rejects an invalid Date', () => {
    expect(() => formatDateTime(new Date('nope'), 'en')).toThrow();
  });
});

describe('formatId', () => {
  it('returns the id unchanged', () => {
    expect(formatId('BR-001')).toBe('BR-001');
    expect(formatId('MEM-2026-000123')).toBe('MEM-2026-000123');
  });

  it('throws on a non-string', () => {
    expect(() => formatId(42 as unknown as string)).toThrow();
    expect(() => formatId(undefined as unknown as string)).toThrow();
  });
});

describe('Latin digits everywhere', () => {
  it('never emits Arabic-Indic digits for any locale', () => {
    for (const locale of LOCALES) {
      const outputs = [
        formatMoney('1234567.89', locale),
        formatInt(9876543210, locale),
        formatDate('2026-10-26', locale),
        formatDateTime(new Date('2026-10-26T09:05:00Z'), locale),
      ];
      for (const out of outputs) expect(out).not.toMatch(NON_LATIN_DIGITS);
    }
  });
});

describe('source', () => {
  const source = readFileSync(path.join(import.meta.dirname, 'format.ts'), 'utf8');

  it('does no floating point conversion in the money and integer paths', () => {
    const between = (from: string, to: string) =>
      source.slice(source.indexOf(from), source.indexOf(to));
    const numeric = [
      between('const MONEY_RE', 'const INTL_LOCALE'),
      between('function group', 'function dateFormatter'),
      between('export function formatInt', 'export function formatId'),
    ].join(String.fromCharCode(10));
    expect(numeric.length).toBeGreaterThan(200);
    expect(numeric).not.toMatch(/Number\s*\(/);
    expect(numeric).not.toMatch(/parseFloat|parseInt|toFixed|Math\./);
    expect(source).not.toMatch(/style:\s*['"]currency['"]/);
  });
});
