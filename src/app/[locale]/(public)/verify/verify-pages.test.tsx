// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../../../tests/support/render-intl';
import type { PublicReportVerification } from '@/modules/verification';
import VerifyPage, { generateMetadata as entryMetadata } from './page';
import VerifyResultPage, { generateMetadata as resultMetadata } from './[code]/page';

const MESSAGES = path.resolve(import.meta.dirname, '../../../../../messages');

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  headers: { current: new Headers() },
  lookup: vi.fn(),
  check: vi.fn(),
  pool: { name: 'request-pool' },
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => mocks.headers.current) }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const root = nodePath.resolve(import.meta.dirname, '../../../../../messages');
  const load = (locale: string) =>
    Object.fromEntries(
      ['common', 'verify'].map((ns) => [
        ns,
        JSON.parse(fs.readFileSync(nodePath.join(root, locale, `${ns}.json`), 'utf8')),
      ]),
    );
  return {
    setRequestLocale: vi.fn(),
    getTranslations: vi.fn(async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({ locale, messages: load(locale), namespace: namespace as never }),
    ),
  };
});
vi.mock('@/modules/verification', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/verification')>()),
  lookupVerification: mocks.lookup,
  verifyRateLimiter: { check: mocks.check, reset: vi.fn() },
}));
vi.mock('@/platform/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/db')>()),
  getPool: vi.fn(() => mocks.pool),
}));
// next-intl's middleware imports 'next/server' without an extension, which Node ESM
// cannot resolve under Vitest. Only the proxy's matcher is under test here.
vi.mock('next-intl/middleware', () => ({ default: () => () => undefined }));

type Locale = 'en' | 'ur';
type Messages = Record<string, Record<string, unknown>>;

function verifyMessages(locale: Locale): Messages {
  return JSON.parse(readFileSync(path.join(MESSAGES, locale, 'verify.json'), 'utf8')) as Messages;
}
type PageText = Record<
  | 'title'
  | 'intro'
  | 'codeLabel'
  | 'codeHint'
  | 'submit'
  | 'invalid'
  | 'notFound'
  | 'notFoundTitle'
  | 'rateLimited'
  | 'rateLimitedTitle'
  | 'metaDescription'
  | 'privacy'
  | 'stepsTitle'
  | 'checkAnother',
  string
>;
const page = (locale: Locale) => verifyMessages(locale).page as unknown as PageText;
const result = (locale: Locale) => verifyMessages(locale).result as Messages;

const VERIFIED: PublicReportVerification = {
  code: 'ABCDE-FGHJK',
  branch: { name: 'Gulberg Community Branch', city: 'Lahore' },
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
  approvedTotal: '1234567.50',
  collectionCount: 42,
  approvedOn: '2026-10-13',
  integrity: 'verified',
  anchor: { chainSeq: 318, seal: '0123456789abcdef' },
  sealCheck: 'match',
  chain: {
    status: 'intact',
    checkedEvents: 1204,
    brokenAtSeq: null,
    checkedAt: '2026-11-01T06:30:00.000Z',
  },
};

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

async function renderEntry(locale: Locale, query: Record<string, string | string[]> = {}) {
  const ui = await VerifyPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(query),
  });
  return renderWithIntl(ui, { locale, namespaces: ['verify', 'common'] });
}

async function renderResult(
  locale: Locale,
  code: string,
  query: Record<string, string | string[]> = {},
) {
  const ui = await VerifyResultPage({
    params: Promise.resolve({ locale, code }),
    searchParams: Promise.resolve(query),
  });
  return renderWithIntl(ui, { locale, namespaces: ['verify', 'common'] });
}

beforeEach(() => {
  mocks.headers.current = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
  mocks.check.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.lookup.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('code entry page', () => {
  it.each(['en', 'ur'] as const)(
    'explains the check and offers a plain GET form in %s',
    async (locale) => {
      const { container } = await renderEntry(locale);
      const text = page(locale);

      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(text.title);
      expect(screen.getByText(text.intro)).toBeTruthy();
      expect(screen.getByText(text.privacy)).toBeTruthy();

      const steps = screen.getByRole('list', { name: text.stepsTitle });
      const items = within(steps).getAllByRole('listitem');
      expect(items).toHaveLength(4);
      const all = verifyMessages(locale).page as Record<string, string>;
      expect(items.map((li) => within(li).getByRole('heading', { level: 3 }).textContent)).toEqual(
        ['Approved', 'Issued', 'Chained', 'Check'].map((key) => all[`step${key}Title`]),
      );

      const form = container.querySelector('form');
      expect(form?.getAttribute('method')).toBe('get');
      expect(form?.getAttribute('action')).toBe(`/${locale}/verify`);
      expect(container.querySelectorAll('script')).toHaveLength(0);
      expect(container.getAttribute('dir')).toBe(locale === 'ur' ? 'rtl' : 'ltr');

      const input = screen.getByLabelText(text.codeLabel) as HTMLInputElement;
      expect(input.form).toBe(form);
      expect(input.name).toBe('code');
      expect(input.value).toBe('');
      expect(input.getAttribute('autocomplete')).toBe('off');
      expect(input.getAttribute('autocapitalize')).toBe('characters');
      expect(input.getAttribute('spellcheck')).toBe('false');
      expect(input.getAttribute('dir')).toBe('ltr');
      expect(input.maxLength).toBe(32);
      expect(input.getAttribute('aria-invalid')).toBeNull();
      const hint = container.querySelector(`#${input.getAttribute('aria-describedby')}`);
      expect(hint?.textContent).toBe(text.codeHint);
      expect(screen.queryByText(text.invalid)).toBeNull();
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it('reaches the field and then the named submit button by keyboard', async () => {
    await renderEntry('en');
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText(page('en').codeLabel));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: page('en').submit }));
  });

  it.each([
    ['en', 'abcde-fghjk', '/en/verify/ABCDE-FGHJK'],
    ['en', ' abcdefghjk ', '/en/verify/ABCDE-FGHJK'],
    ['ur', '7k2qh m9xwd', '/ur/verify/7K2QH-M9XWD'],
    ['en', 'oiL23-45678', '/en/verify/01123-45678'],
  ] as const)('in %s, ?code=%j redirects to %s', async (locale, code, target) => {
    await expect(renderEntry(locale, { code })).rejects.toThrow(`NEXT_REDIRECT ${target}`);
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(target);
  });

  it('uses the first value when the code is given twice', async () => {
    await expect(renderEntry('en', { code: ['abcde-fghjk', 'zzzzz'] })).rejects.toThrow(
      'NEXT_REDIRECT /en/verify/ABCDE-FGHJK',
    );
  });

  it.each(['en', 'ur'] as const)(
    'shows the invalid message next to the field for a bad code in %s',
    async (locale) => {
      const { container } = await renderEntry(locale, { code: 'bad' });
      expect(mocks.redirect).not.toHaveBeenCalled();
      const input = screen.getByLabelText(page(locale).codeLabel) as HTMLInputElement;
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.value).toBe('bad');
      const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ');
      const error = screen.getByText(page(locale).invalid).closest('p');
      if (!error) throw new Error('no error paragraph');
      expect(describedBy).toContain(error.id);
      expect(container.querySelector('form')?.contains(error)).toBe(true);
    },
  );

  it('treats an empty submission as invalid', async () => {
    await renderEntry('en', { code: '' });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(screen.getByText(page('en').invalid)).toBeTruthy();
  });

  it('keeps markup in a bad code as plain text and never longer than the field allows', async () => {
    const raw = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const { container } = await renderEntry('en', { code: raw });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    const input = screen.getByLabelText(page('en').codeLabel) as HTMLInputElement;
    expect(input.value).toBe(raw.slice(0, 32));
    expect(screen.getByText(page('en').invalid)).toBeTruthy();
  });

  it('is indexable, with a title and description from the verify namespace', async () => {
    const meta = await entryMetadata({ params: Promise.resolve({ locale: 'ur' }) });
    expect(String(meta.title)).toContain(page('ur').title);
    expect(meta.description).toBe(page('ur').metaDescription);
    expect(meta.robots).toBeUndefined();
  });
});

describe('verification result page', () => {
  it('checks the rate limit for the client address, then looks the code up with the seal', async () => {
    mocks.lookup.mockResolvedValue(VERIFIED);
    await renderResult('en', 'ABCDE-FGHJK', { s: '0123456789abcdef' });

    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('203.0.113.7');
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith(mocks.pool, 'ABCDE-FGHJK', {
      seal: '0123456789abcdef',
    });
    expect(mocks.check.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.lookup.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('renders the certificate as the page headline for a verified code', async () => {
    mocks.lookup.mockResolvedValue(VERIFIED);
    const { container } = await renderResult('en', 'ABCDE-FGHJK', { s: '0123456789abcdef' });
    const integrity = result('en').integrity as Record<string, string>;

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(integrity.verified);
    const article = container.querySelector('article[data-integrity]');
    expect(article?.getAttribute('data-integrity')).toBe('verified');
    expect(article?.getAttribute('data-seal-check')).toBe('match');
    expect(container.textContent).toContain('PKR 1,234,567.50');
    expect(container.textContent).toContain('Gulberg Community Branch');

    const back = screen.getByRole('link', { name: page('en').checkAnother });
    expect(back.getAttribute('href')).toBe('/en/verify');
    expect(container.querySelectorAll('script')).toHaveLength(0);
  });

  it('renders the Urdu certificate right to left with Latin digits', async () => {
    mocks.lookup.mockResolvedValue(VERIFIED);
    const { container } = await renderResult('ur', 'ABCDE-FGHJK', { s: '0123456789abcdef' });
    const integrity = result('ur').integrity as Record<string, string>;

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(integrity.verified);
    expect(container.getAttribute('dir')).toBe('rtl');
    expect(container.querySelector('article')?.getAttribute('dir')).toBe('rtl');
    expect(container.querySelector('article')?.getAttribute('lang')).toBe('ur');
    expect(container.textContent).toContain('1,234,567.50');
    expect(container.textContent).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(screen.getByRole('link', { name: page('ur').checkAnother }).getAttribute('href')).toBe(
      '/ur/verify',
    );
  });

  it('passes no seal when the link has none, and only the first seal when repeated', async () => {
    await renderResult('en', 'ABCDE-FGHJK');
    expect(mocks.lookup).toHaveBeenLastCalledWith(mocks.pool, 'ABCDE-FGHJK', { seal: undefined });
    await renderResult('en', 'ABCDE-FGHJK', { s: ['aaaa', 'bbbb'] });
    expect(mocks.lookup).toHaveBeenLastCalledWith(mocks.pool, 'ABCDE-FGHJK', { seal: 'aaaa' });
  });

  it.each(['en', 'ur'] as const)(
    'shows the not-recognised state with an empty form in %s',
    async (locale) => {
      const { container } = await renderResult(locale, 'ZZZZZ-ZZZZZ');
      const text = page(locale);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(text.notFoundTitle);
      expect(screen.getByText(text.notFound)).toBeTruthy();
      const input = screen.getByLabelText(text.codeLabel) as HTMLInputElement;
      expect(input.value).toBe('');
      expect(input.getAttribute('aria-invalid')).toBeNull();
      expect(container.querySelector('form')?.getAttribute('action')).toBe(`/${locale}/verify`);
      expect(container.querySelector('article')).toBeNull();
      expect(container.textContent).not.toContain('ZZZZZ');
    },
  );

  it('words unknown and malformed codes identically and never echoes the input', async () => {
    const unknown = await renderResult('en', 'ZZZZZ-ZZZZZ');
    const unknownText = unknown.container.textContent;
    unknown.unmount();

    const raw = '<img src=x onerror=alert(1)>';
    const malformed = await renderResult('en', raw);
    expect(mocks.lookup).toHaveBeenLastCalledWith(mocks.pool, raw, { seal: undefined });
    expect(malformed.container.textContent).toBe(unknownText);
    expect(malformed.container.querySelector('img')).toBeNull();
    expect(malformed.container.innerHTML).not.toContain('onerror');
  });

  it('decodes an encoded path segment before the lookup', async () => {
    await renderResult('en', 'ABCDE%20FGHJK');
    expect(mocks.lookup).toHaveBeenLastCalledWith(mocks.pool, 'ABCDE FGHJK', { seal: undefined });
    await renderResult('en', '%E0%A4%A');
    expect(mocks.lookup).toHaveBeenLastCalledWith(mocks.pool, '%E0%A4%A', { seal: undefined });
  });

  it.each(['en', 'ur'] as const)(
    'shows the try-again state with the seconds left when rate limited in %s',
    async (locale) => {
      mocks.check.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });
      const { container } = await renderResult(locale, 'abcde-fghjk', { s: '0123456789abcdef' });
      const text = page(locale);

      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(text.rateLimitedTitle);
      expect(container.textContent).toContain(text.rateLimited.replace('{seconds}', '42'));
      expect(container.querySelector('article')).toBeNull();
      const retry = container.querySelector('a[data-retry]');
      expect(retry?.getAttribute('href')).toBe(`/${locale}/verify/ABCDE-FGHJK?s=0123456789abcdef`);
    },
  );

  it('retries a malformed code or seal through the form page only', async () => {
    mocks.check.mockReturnValue({ allowed: false, retryAfterSeconds: 5 });
    const { container } = await renderResult('en', '<b>x</b>', { s: '"><script>' });
    expect(container.querySelector('a[data-retry]')?.getAttribute('href')).toBe('/en/verify');
    expect(container.querySelector('b')).toBeNull();

    const again = await renderResult('en', 'ABCDE-FGHJK', { s: 'not-a-seal' });
    expect(again.container.querySelector('a[data-retry]')?.getAttribute('href')).toBe(
      '/en/verify/ABCDE-FGHJK',
    );
  });

  it.each(['en', 'ur'] as const)(
    'is never indexed and its title carries no code in %s',
    async (locale) => {
      const meta = await resultMetadata({
        params: Promise.resolve({ locale, code: 'ABCDE-FGHJK' }),
      });
      expect(meta.robots).toEqual({ index: false, follow: false });
      expect(String(meta.title)).toContain(page(locale).title);
      expect(String(meta.title)).not.toMatch(/ABCDE|FGHJK|\d/);
    },
  );
});

describe('locale-free QR links', () => {
  it('are routed through the locale proxy, which keeps the query on its redirect', async () => {
    const { config } = await import('@/proxy');
    const matchers = (Array.isArray(config.matcher) ? config.matcher : [config.matcher]).map(
      (m: string | { source: string }) => (typeof m === 'string' ? m : m.source),
    );
    const matches = (pathname: string) =>
      matchers.some((source) => new RegExp(`^${source}$`).test(pathname));

    expect(matches('/verify/ABCDE-FGHJK')).toBe(true);
    expect(matches('/verify/abcdefghjk')).toBe(true);
    expect(matches('/verify')).toBe(true);
    expect(matches('/api/v1/public/verify/ABCDE-FGHJK')).toBe(false);
  });
});
