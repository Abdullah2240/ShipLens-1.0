// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../../tests/support/render-intl';
import type { ReportShareSummary } from '../../share-text';
import { ShareReportButton } from './ShareReportButton';

const REPORT_ID = '7d0a5d3e-3f4b-4b8e-9a51-2a1c0b7e9f10';
const SOURCE = path.resolve(import.meta.dirname, 'ShareReportButton.tsx');

const TEXT = {
  en: { button: 'Share to WhatsApp', sharing: 'Sharing…' },
  ur: { button: 'واٹس ایپ پر شیئر کریں', sharing: 'شیئر ہو رہا ہے…' },
} as const;

const SUMMARY: ReportShareSummary = {
  reportId: REPORT_ID,
  branchName: 'Lahore Central',
  branchCode: 'LHR-01',
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
  status: 'approved',
  amount: '25000.00',
  collectionCount: 3,
  amountIsFrozen: true,
};

const fetchMock = vi.fn<typeof fetch>();
const openMock = vi.fn<typeof window.open>();

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const linkFor = (locale: string) => `https://shiplens.example/${locale}/share/reports/${REPORT_ID}`;

function render(locale: 'en' | 'ur' = 'en') {
  return renderWithIntl(<ShareReportButton reportId={REPORT_ID} />, {
    locale,
    namespaces: ['share', 'common'],
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'open').mockImplementation(openMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ShareReportButton', () => {
  it('has an accessible name, a hint and a neutral icon in both locales', () => {
    for (const locale of ['en', 'ur'] as const) {
      const { container, unmount } = render(locale);
      const button = screen.getByRole('button', { name: TEXT[locale].button });
      expect(button).toHaveAttribute('aria-describedby');
      const hint = container.querySelector(
        `#${CSS.escape(button.getAttribute('aria-describedby')!)}`,
      );
      expect(hint?.textContent).toBeTruthy();
      expect(container.querySelector('[data-icon="share"]')).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('img')).toBeNull();
      expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      unmount();
    }
  });

  it('POSTs the locale, then opens wa.me with the English summary text', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(200, { data: { summary: SUMMARY, link: linkFor('en') } }),
    );
    render('en');
    await user.click(screen.getByRole('button', { name: TEXT.en.button }));

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/v1/reports/${REPORT_ID}/share`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ locale: 'en' });

    const [opened, target, features] = openMock.mock.calls[0]!;
    expect(target).toBe('_blank');
    expect(features).toBe('noopener');
    const href = String(opened);
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href.slice('https://wa.me/?text='.length)).split('\n')).toEqual([
      'Lahore Central (LHR-01) weekly report',
      'Week: 5 Oct 2026 to 11 Oct 2026',
      'Status: Approved',
      'Total: PKR 25,000.00 from 3 collections',
      `Open (login required): ${linkFor('en')}`,
    ]);
    // A fallback link in case the browser blocked the new tab.
    expect(await screen.findByRole('link', { name: 'Open WhatsApp again' })).toHaveAttribute(
      'href',
      href,
    );
  });

  it('builds the Urdu text with isolates and the Urdu status label', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(200, { data: { summary: SUMMARY, link: linkFor('ur') } }),
    );
    render('ur');
    await user.click(screen.getByRole('button', { name: TEXT.ur.button }));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ locale: 'ur' });
    const text = decodeURIComponent(String(openMock.mock.calls[0]![0]).split('?text=')[1]!);
    const lines = text.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('\u2068Lahore Central\u2069 (\u2068LHR-01\u2069) کی ہفتہ وار رپورٹ');
    expect(lines[2]).toBe('حیثیت: منظور شدہ');
    expect(lines[3]).toContain('\u2068PKR 25,000.00\u2069');
    expect(lines[4]!.endsWith(linkFor('ur'))).toBe(true);
  });

  it('shows the pending label while the request runs and blocks a second click', async () => {
    const user = userEvent.setup();
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    render('en');
    await user.click(screen.getByRole('button', { name: TEXT.en.button }));
    const busy = await screen.findByRole('button', { name: TEXT.en.sharing });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(reply(200, { data: { summary: SUMMARY, link: linkFor('en') } }));
    await screen.findByRole('button', { name: TEXT.en.button });
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'Only the lead of this branch can share its reports.'],
    [404, 'This report could not be found. It may belong to another branch.'],
    [500, 'The share could not be prepared. Check your connection and try again.'],
  ])('shows an inline error for %i and opens no window', async (status, message) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(status, { error: { code: 'x' } }));
    render('en');
    await user.click(screen.getByRole('button', { name: TEXT.en.button }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(openMock).not.toHaveBeenCalled();
  });

  it('shows the localized network error when fetch fails or the reply is malformed', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    fetchMock.mockResolvedValueOnce(reply(200, { data: { nothing: true } }));
    render('ur');
    const button = screen.getByRole('button', { name: TEXT.ur.button });
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'شیئر تیار نہیں ہو سکا۔ اپنا کنکشن چیک کریں اور دوبارہ کوشش کریں۔',
    );
    await user.click(screen.getByRole('button', { name: TEXT.ur.button }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('شیئر تیار نہیں ہو سکا');
    expect(openMock).not.toHaveBeenCalled();
  });

  it('is a client component with logical CSS only and no brand assets', () => {
    const source = readFileSync(SOURCE, 'utf8');
    expect(source).toMatch(/^'use client';/);
    expect(findPhysicalDirection(source, SOURCE)).toEqual([]);
    expect(source).not.toMatch(/api\.whatsapp\.com|\.png|\.svg['"]/);
    expect(source).toContain('wa.me');
  });
});
