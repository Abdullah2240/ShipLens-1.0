// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { findPhysicalDirection } from '../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { formatDate, formatDateTime } from '@/platform/i18n/format';
import { Bdi, DateText, IdText, Ltr, MoneyText } from '.';

const LOCALES = ['en', 'ur'] as const;

const MIXED_VALUES = [
  'ali.khan@example.test',
  '0300-0000123',
  'M00042',
  'BR002',
  'req_01JB-7f3a-2c9d',
] as const;

describe('Ltr', () => {
  it('renders an isolated left-to-right bdi', () => {
    renderWithIntl(<Ltr>BR002</Ltr>);
    const el = screen.getByText('BR002');
    expect(el.tagName).toBe('BDI');
    expect(el).toHaveAttribute('dir', 'ltr');
    expect(el.className).toContain('[unicode-bidi:isolate]');
  });

  it('keeps an extra class', () => {
    renderWithIntl(<Ltr className="font-mono">x</Ltr>);
    expect(screen.getByText('x').className).toContain('font-mono');
  });

  it.each(MIXED_VALUES)('keeps %s intact inside an Urdu sentence', (value) => {
    const { container } = renderWithIntl(
      <p>
        رابطہ: <Ltr>{value}</Ltr> پر کریں
      </p>,
      { locale: 'ur' },
    );
    expect(container).toHaveAttribute('dir', 'rtl');
    const bdi = container.querySelector('bdi');
    expect(bdi).toHaveAttribute('dir', 'ltr');
    expect(bdi?.textContent).toBe(value);
  });
});

describe('Bdi', () => {
  it('renders an auto-direction bdi without a dir attribute', () => {
    renderWithIntl(<Bdi>Ali Khan</Bdi>, { locale: 'ur' });
    const el = screen.getByText('Ali Khan');
    expect(el.tagName).toBe('BDI');
    expect(el).not.toHaveAttribute('dir');
  });

  it('isolates an Urdu name inside English text', () => {
    const { container } = renderWithIntl(
      <p>
        Submitted by <Bdi>علی خان</Bdi> (Lahore)
      </p>,
    );
    expect(container.querySelector('bdi')?.textContent).toBe('علی خان');
  });
});

describe.each(LOCALES)('MoneyText (%s)', (locale) => {
  it('formats with Latin digits and tabular numerals inside Ltr', () => {
    renderWithIntl(<MoneyText amount="1234.5" />, { locale });
    const el = screen.getByText('PKR 1,234.50');
    expect(el.tagName).toBe('BDI');
    expect(el).toHaveAttribute('dir', 'ltr');
    expect(el.className).toContain('tabular');
    expect(el.textContent).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe.each(LOCALES)('IdText (%s)', (locale) => {
  it('renders the id inside Ltr, monospaced on request', () => {
    renderWithIntl(<IdText id="M00042" mono />, { locale });
    const el = screen.getByText('M00042');
    expect(el).toHaveAttribute('dir', 'ltr');
    expect(el.className).toContain('font-mono');
  });

  it('is not monospaced by default', () => {
    renderWithIntl(<IdText id="BR002" />, { locale });
    expect(screen.getByText('BR002').className).not.toContain('font-mono');
  });
});

describe.each(LOCALES)('DateText (%s)', (locale) => {
  it('formats a business date with formatDate', () => {
    const { container } = renderWithIntl(<DateText value="2026-10-31" />, { locale });
    const bdi = container.querySelector('bdi');
    expect(bdi).toHaveAttribute('dir', 'auto');
    expect(bdi?.className).toContain('[unicode-bidi:isolate]');
    expect(bdi?.textContent).toBe(formatDate('2026-10-31', locale));
    expect(bdi?.textContent).toMatch(/2026/);
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-10-31');
  });

  it('formats an instant with formatDateTime in PKT', () => {
    const instant = new Date('2026-10-31T19:30:00Z');
    const { container } = renderWithIntl(<DateText value={instant} withTime />, { locale });
    const text = container.querySelector('bdi')?.textContent;
    expect(text).toBe(formatDateTime(instant, locale));
    // 19:30 UTC is 00:30 the next day in Asia/Karachi
    expect(text).toMatch(/00:30/);
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-10-31T19:30:00.000Z');
  });

  it('formats a Date without time as the PKT calendar day', () => {
    const instant = new Date('2026-10-31T19:30:00Z');
    const { container } = renderWithIntl(<DateText value={instant} />, { locale });
    expect(container.querySelector('bdi')?.textContent).toBe(formatDate(instant, locale));
  });

  it('accepts an ISO instant string with withTime', () => {
    const iso = '2026-10-31T19:30:00.000Z';
    const { container } = renderWithIntl(<DateText value={iso} withTime />, { locale });
    expect(container.querySelector('bdi')?.textContent).toBe(formatDateTime(new Date(iso), locale));
  });
});

describe('DateText in Urdu text', () => {
  it('isolates an Urdu date-time with automatic direction so it reads right to left', () => {
    const instant = new Date('2026-10-15T08:06:00Z');
    const { container } = renderWithIntl(
      <p>
        جمع کرایا گیا: <DateText value={instant} withTime /> کو
      </p>,
      { locale: 'ur' },
    );
    const bdi = container.querySelector('bdi');
    const text = formatDateTime(instant, 'ur');
    expect(bdi).toHaveAttribute('dir', 'auto');
    expect(bdi).not.toHaveAttribute('dir', 'ltr');
    expect(bdi?.textContent).toBe(text);
    // The Urdu month name is the first strong character, so the isolate resolves to RTL.
    expect(text).toMatch(/^[\d\s]*\p{Script=Arabic}/u);
    expect(text).toMatch(/13:06/);
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-10-15T08:06:00.000Z');
  });

  it('keeps an English date-time left to right through the same automatic direction', () => {
    const instant = new Date('2026-10-15T08:06:00Z');
    const { container } = renderWithIntl(<DateText value={instant} withTime />);
    const text = container.querySelector('bdi')?.textContent ?? '';
    expect(text).toBe(formatDateTime(instant, 'en'));
    expect(text).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe.each(LOCALES)('bidi markup (%s)', (locale) => {
  it('uses no physical-direction classes', () => {
    const { container } = renderWithIntl(
      <>
        <Ltr>x</Ltr>
        <Bdi>y</Bdi>
        <MoneyText amount="1.00" />
        <IdText id="BR001" mono />
        <DateText value="2026-10-01" />
      </>,
      { locale },
    );
    expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
  });
});
