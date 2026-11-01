import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { formatDate, formatInt, formatMoney } from '@/platform/i18n/format';
import { buildShareText, whatsappUrl, type ReportShareSummary, type Translate } from './share-text';

type Locale = 'en' | 'ur';
const MESSAGES = path.resolve(import.meta.dirname, '../../../messages');
const read = (locale: Locale, ns: string) =>
  JSON.parse(readFileSync(path.join(MESSAGES, locale, `${ns}.json`), 'utf8')) as Record<
    string,
    unknown
  >;

function translator(locale: Locale): Translate {
  return createTranslator({
    locale,
    messages: { share: read(locale, 'share') },
    namespace: 'share',
  }) as unknown as Translate;
}

const statusLabel = (locale: Locale, status: string) =>
  (read(locale, 'common').status as Record<string, string>)[status]!;

const FSI = '\u2068';
const PDI = '\u2069';
const LINK = 'https://shiplens.example/ur/share/reports/7d0a5d3e-3f4b-4b8e-9a51-2a1c0b7e9f10';

const SUMMARY: ReportShareSummary = {
  reportId: '7d0a5d3e-3f4b-4b8e-9a51-2a1c0b7e9f10',
  branchName: 'Lahore Central',
  branchCode: 'LHR-01',
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
  status: 'submitted',
  amount: '1234567.50',
  collectionCount: 12,
  amountIsFrozen: true,
};

function build(locale: Locale, summary: ReportShareSummary = SUMMARY, link = LINK) {
  return buildShareText(
    translator(locale),
    summary,
    link,
    {
      amount: formatMoney(summary.amount, locale),
      weekStart: formatDate(summary.weekStart, locale),
      weekEnd: formatDate(summary.weekEnd, locale),
      status: statusLabel(locale, summary.status),
      count: formatInt(summary.collectionCount, locale),
    },
    { isolate: locale === 'ur' },
  );
}

describe('buildShareText (English)', () => {
  it('produces exactly five lines in the documented order, link last', () => {
    expect(build('en').split('\n')).toEqual([
      'Lahore Central (LHR-01) weekly report',
      'Week: 5 Oct 2026 to 11 Oct 2026',
      'Status: Submitted',
      'Total: PKR 1,234,567.50 from 12 collections',
      `Open (login required): ${LINK}`,
    ]);
  });

  it('uses the singular for one collection', () => {
    const text = build('en', { ...SUMMARY, collectionCount: 1, amount: '10.00' });
    expect(text.split('\n')[3]).toBe('Total: PKR 10.00 from 1 collection');
  });

  it('has no bidi isolates in English', () => {
    expect(build('en')).not.toMatch(/[\u2066-\u2069]/);
  });

  it('falls back to the raw count when no formatted count is given', () => {
    const text = buildShareText(translator('en'), SUMMARY, LINK, {
      amount: 'PKR 1,234,567.50',
      weekStart: '5 Oct 2026',
      weekEnd: '11 Oct 2026',
      status: 'Submitted',
    });
    expect(text.split('\n')[3]).toBe('Total: PKR 1,234,567.50 from 12 collections');
  });

  it('appends extra lines after the link when asked', () => {
    const text = buildShareText(
      translator('en'),
      SUMMARY,
      LINK,
      { amount: 'a', weekStart: 'b', weekEnd: 'c', status: 'd' },
      { appendLines: ['Extra line'] },
    );
    const lines = text.split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[4]).toBe(`Open (login required): ${LINK}`);
    expect(lines[5]).toBe('Extra line');
  });
});

describe('buildShareText (Urdu)', () => {
  const text = build('ur');
  const lines = text.split('\n');

  it('produces five lines with the link last and unwrapped', () => {
    expect(lines).toHaveLength(5);
    expect(lines[4]!.endsWith(`: ${LINK}`)).toBe(true);
    expect(lines[4]).not.toContain(`${FSI}${LINK}`);
  });

  it('wraps the branch, code, dates, amount and count in first-strong isolates', () => {
    for (const value of [
      'Lahore Central',
      'LHR-01',
      formatDate('2026-10-05', 'ur'),
      formatDate('2026-10-11', 'ur'),
      'PKR 1,234,567.50',
      '12',
    ]) {
      expect(text, value).toContain(`${FSI}${value}${PDI}`);
    }
    expect(lines[0]).toBe(`${FSI}Lahore Central${PDI} (${FSI}LHR-01${PDI}) کی ہفتہ وار رپورٹ`);
    expect(lines[2]).toBe('حیثیت: جمع شدہ');
    expect(lines[3]).toBe(`کل رقم: ${FSI}PKR 1,234,567.50${PDI}، ${FSI}12${PDI} وصولیوں سے`);
  });

  it('balances every isolate and uses Latin digits only', () => {
    expect(text.split(FSI).length).toBe(text.split(PDI).length);
    expect(text).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
  });

  it('uses the singular for one collection', () => {
    const one = build('ur', { ...SUMMARY, collectionCount: 1 }).split('\n')[3];
    expect(one).toContain(`${FSI}1${PDI} وصولی سے`);
  });
});

describe('buildShareText content rules', () => {
  it('carries the report id only inside the link, and the link is the only URL', () => {
    for (const locale of ['en', 'ur'] as const) {
      const text = build(locale);
      expect(text.match(/https?:\/\/\S+/g)).toEqual([LINK]);
      expect(text.split(SUMMARY.reportId)).toHaveLength(2);
    }
  });

  it('strips line breaks and bidi controls from branch name and code', () => {
    const text = build('en', {
      ...SUMMARY,
      branchName: 'Evil\nInjected line\u202e',
      branchCode: 'X\u2066Y\r\nZ',
    });
    const lines = text.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('Evil Injected line (X Y Z) weekly report');
    expect(text).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
  });
});

describe('whatsappUrl', () => {
  it('encodes newlines, Urdu text and the link so they round-trip', () => {
    for (const locale of ['en', 'ur'] as const) {
      const text = build(locale);
      const url = whatsappUrl(text);
      expect(url.startsWith('https://wa.me/?text=')).toBe(true);
      const encoded = url.slice('https://wa.me/?text='.length);
      expect(encoded).not.toMatch(/[\s\n]/);
      expect(encoded).toContain('%0A');
      expect(decodeURIComponent(encoded)).toBe(text);
      expect(new URL(url).searchParams.get('text')).toBe(text);
    }
  });

  it('never uses api.whatsapp.com and never adds a phone number', () => {
    const url = whatsappUrl('hello');
    expect(url).toBe('https://wa.me/?text=hello');
    expect(url).not.toContain('api.whatsapp.com');
    expect(new URL(url).pathname).toBe('/');
    expect(new URL(url).searchParams.has('phone')).toBe(false);
  });

  it('encodes characters that would otherwise end the query value', () => {
    const url = whatsappUrl('a&b=c#d?e+f');
    expect(new URL(url).searchParams.get('text')).toBe('a&b=c#d?e+f');
  });
});
