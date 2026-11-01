// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { encode } from 'uqr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { formatDate, formatDateTime } from '@/platform/i18n/format';
import {
  ChainStatusBadge,
  CopyLinkButton,
  Qr,
  VerificationCertificate,
  VerificationPanel,
  type VerificationCertificateResult,
} from '.';

const MESSAGES = path.resolve(import.meta.dirname, '../../../messages');
const URL_SAMPLE = 'https://example.test/verify/7K2QHM9XWD?s=0123456789abcdef';

type Messages = Record<string, unknown>;
function messages(locale: string): Messages {
  return JSON.parse(readFileSync(path.join(MESSAGES, locale, 'verify.json'), 'utf8')) as Messages;
}
function flatKeys(tree: Messages, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flatKeys(value as Messages, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

/** Dark cells drawn by a path made of `M x y h1v1h-1z` unit squares. */
function darkCells(d: string): Set<string> {
  const cells = new Set<string>();
  for (const match of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) cells.add(`${match[1]},${match[2]}`);
  return cells;
}

function renderQr(value: string, label = 'QR') {
  const { container } = render(<Qr value={value} label={label} />);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg');
  return { container, svg };
}

describe('verify namespace', () => {
  it('is loaded by the app, after the phase 3 namespaces', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../i18n/request.ts'), 'utf8');
    const list = /NAMESPACES = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? '';
    const names = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(names.at(-1)).toBe('verify');
    expect(names.indexOf('verify')).toBeGreaterThan(names.indexOf('share'));
  });

  it('has identical keys in English and Urdu', () => {
    expect(flatKeys(messages('ur')).sort()).toEqual(flatKeys(messages('en')).sort());
  });

  it('carries every key the twist screens rely on', () => {
    const keys = new Set(flatKeys(messages('en')));
    const required = [
      'badge.intact',
      'badge.intactDetail',
      'badge.broken',
      'badge.reason.sequence_gap',
      'badge.reason.link_mismatch',
      'badge.reason.hash_mismatch',
      'badge.empty',
      'badge.recheck',
      'panel.title',
      'panel.intro',
      'panel.code',
      'panel.seal',
      'panel.sealHelp',
      'panel.open',
      'panel.copy',
      'panel.copied',
      'panel.qrLabel',
      'page.title',
      'page.intro',
      'page.codeLabel',
      'page.codeHint',
      'page.submit',
      'page.invalid',
      'page.notFound',
      'page.rateLimited',
      'page.metaDescription',
      'result.branch',
      'result.week',
      'result.approvedTotal',
      'result.collections',
      'result.approvedOn',
      'result.anchor',
      'result.seal',
      'result.checkedAt',
      'result.howItWorks',
      'result.privacy',
      ...['verified', 'mismatch', 'unanchored', 'chain_broken'].flatMap((s) => [
        `result.integrity.${s}`,
        `result.integrityDetail.${s}`,
      ]),
      ...['match', 'mismatch', 'not_provided'].map((s) => `result.sealCheck.${s}`),
      ...['intact', 'broken', 'empty'].map((s) => `result.chain.${s}`),
    ];
    for (const key of required) expect(keys, key).toContain(key);
  });

  it('keeps page strings free of markup tags so pages can use plain t()', () => {
    for (const locale of ['en', 'ur']) {
      const page = messages(locale).page as Record<string, string>;
      for (const [key, value] of Object.entries(page)) expect(value, key).not.toMatch(/<\w+>/);
    }
  });
});

describe('Qr', () => {
  it('renders one labelled svg with a 4-module quiet zone, a light background and one dark path', () => {
    const { svg } = renderQr(URL_SAMPLE, 'Open the check');
    const size = encode(URL_SAMPLE, { ecc: 'M', border: 0 }).size;
    const n = size + 8;

    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Open the check');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${n} ${n}`);
    expect(svg.getAttribute('width')).toBe('176');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');

    const rects = svg.querySelectorAll('rect');
    expect(rects).toHaveLength(1);
    expect(rects[0]?.getAttribute('fill')).toBe('#fff');
    expect(rects[0]?.getAttribute('width')).toBe(String(n));

    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('fill')).toBe('#111');
  });

  it('draws the three finder patterns', () => {
    const { svg } = renderQr(URL_SAMPLE);
    const n = encode(URL_SAMPLE, { ecc: 'M', border: 0 }).size + 8;
    const cells = darkCells(svg.querySelector('path')?.getAttribute('d') ?? '');

    for (const [x, y] of [
      [4, 4],
      [n - 5, 4],
      [4, n - 5],
    ]) {
      expect(cells.has(`${x},${y}`), `finder corner ${x},${y}`).toBe(true);
    }
    // The quiet zone is never painted.
    for (const cell of cells) {
      const [x = 0, y = 0] = cell.split(',').map(Number);
      expect(x >= 4 && y >= 4 && x < n - 4 && y < n - 4, cell).toBe(true);
    }
    // Finder centre is dark and its separator ring is light.
    expect(cells.has('7,7')).toBe(true);
    expect(cells.has('5,5')).toBe(false);
  });

  it('matches the uqr matrix module for module', () => {
    const { data } = encode(URL_SAMPLE, { ecc: 'M', border: 0 });
    const cells = darkCells(
      renderQr(URL_SAMPLE).svg.querySelector('path')?.getAttribute('d') ?? '',
    );
    const expected = data.flatMap((row, y) =>
      row.flatMap((dark, x) => (dark ? [`${x + 4},${y + 4}`] : [])),
    );
    expect(cells.size).toBe(expected.length);
    for (const cell of expected) expect(cells.has(cell)).toBe(true);
  });

  it('is deterministic and value-sensitive', () => {
    const a = renderQr(URL_SAMPLE).svg.querySelector('path')?.getAttribute('d');
    const b = renderQr(URL_SAMPLE).svg.querySelector('path')?.getAttribute('d');
    const c = renderQr('https://example.test/verify/ABCDE12345?s=fedcba9876543210')
      .svg.querySelector('path')
      ?.getAttribute('d');
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('accepts a custom pixel size', () => {
    const { container } = render(<Qr value={URL_SAMPLE} label="QR" size={240} />);
    expect(container.querySelector('svg')?.getAttribute('height')).toBe('240');
  });

  it('uses no injected HTML and no script', () => {
    const { container } = renderQr(URL_SAMPLE);
    expect(container.querySelector('script')).toBeNull();
    const source = readFileSync(path.join(import.meta.dirname, 'Qr.tsx'), 'utf8');
    expect(source).not.toContain('dangerouslySetInnerHTML');
    expect(source).not.toMatch(/^['"]use client['"]/m);
  });
});

// ---------------------------------------------------------------------------
// Badge, panel, copy button and certificate

const LOCALES = ['en', 'ur'] as const;
type Loc = (typeof LOCALES)[number];
const PHYSICAL =
  /(^|\s)!?(?:[\w-]+:)*-?(?:m[lr]-|p[lr]-|left-|right-|text-left\b|text-right\b|border-[lr]\b|rounded-[lr]\b)/;
const CHECKED_AT = '2026-10-31T09:15:00.000Z';

/** Message text with rich tags removed and arguments filled in. */
function msg(locale: Loc, key: string, args: Record<string, string> = {}): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Messages | undefined)?.[part], messages(locale));
  if (typeof value !== 'string') throw new Error(`missing verify.${key} (${locale})`);
  // Remove rich-text tags until none remain, so a tag split around another tag cannot
  // survive a single pass.
  let text = value;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<\/?\w+>/g, '');
  } while (text !== previous);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => args[name] ?? `{${name}}`);
}

function expectLogicalOnly(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('[class]')]) {
    const cls = el.getAttribute('class') ?? '';
    expect(cls, `physical class in "${cls}"`).not.toMatch(PHYSICAL);
  }
}

function renderVerify(ui: ReactElement, locale: Loc = 'en') {
  return renderWithIntl(ui, { locale, namespaces: ['verify'] });
}

describe('ChainStatusBadge', () => {
  it.each(LOCALES)('states an intact chain in words with the count and time (%s)', (locale) => {
    const { container } = renderVerify(
      <ChainStatusBadge
        status="intact"
        checkedEvents={1234}
        checkedAt={CHECKED_AT}
        locale={locale}
      />,
      locale,
    );
    const status = screen.getByRole('status');
    const time = formatDateTime(new Date(CHECKED_AT), locale);
    expect(status).toHaveTextContent(msg(locale, 'badge.intact'));
    expect(status).toHaveTextContent(msg(locale, 'badge.intactDetail', { count: '1,234', time }));
    expect(screen.queryByRole('link')).toBeNull();
    expectLogicalOnly(container);
  });

  it.each(LOCALES)('names the broken event and the reason (%s)', (locale) => {
    const { container } = renderVerify(
      <ChainStatusBadge
        status="broken"
        checkedEvents={9}
        checkedAt={CHECKED_AT}
        brokenAtSeq={7}
        reason="hash_mismatch"
        recheckHref="?fresh=1"
        locale={locale}
      />,
      locale,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(msg(locale, 'badge.broken', { seq: '7' }));
    expect(status).toHaveTextContent(msg(locale, 'badge.reason.hash_mismatch'));
    const bdi = [...status.querySelectorAll('bdi')].find((el) => /7$/.test(el.textContent ?? ''));
    expect(bdi?.textContent).toMatch(/^#?7$/);
    expect(screen.getByRole('link', { name: msg(locale, 'badge.recheck') })).toHaveAttribute(
      'href',
      '?fresh=1',
    );
    expectLogicalOnly(container);
  });

  it('reads "Audit chain broken at event #7" in English', () => {
    renderVerify(
      <ChainStatusBadge
        status="broken"
        checkedEvents={9}
        checkedAt={CHECKED_AT}
        brokenAtSeq={7}
        reason="sequence_gap"
        locale="en"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Audit chain broken at event #7');
    expect(screen.getByRole('status')).toHaveTextContent(
      'An event is missing, or one was added out of order.',
    );
  });

  it('states an empty chain', () => {
    renderVerify(
      <ChainStatusBadge status="empty" checkedEvents={0} checkedAt={CHECKED_AT} locale="en" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No audit events to check yet');
  });
});

const PANEL_URL = 'https://shiplens.example/verify/7K2QHM9XWD?s=0123456789abcdef';

describe('VerificationPanel', () => {
  it.each(LOCALES)('shows code, QR, grouped seal, public link and copy button (%s)', (locale) => {
    const { container } = renderVerify(
      <VerificationPanel
        code="7K2QH-M9XWD"
        url={PANEL_URL}
        seal="0123456789abcdef"
        locale={locale}
      />,
      locale,
    );
    const code = screen.getByText('7K2QH-M9XWD');
    expect(code.tagName).toBe('BDI');
    expect(code.className).toContain('font-mono');
    expect(screen.getByRole('img', { name: msg(locale, 'panel.qrLabel') })).toBeInTheDocument();
    expect(screen.getByText('0123 4567 89ab cdef').tagName).toBe('BDI');
    const open = screen.getByRole('link', { name: msg(locale, 'panel.open') });
    expect(open).toHaveAttribute('href', PANEL_URL);
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: msg(locale, 'panel.copy') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: msg(locale, 'panel.title') })).toBeInTheDocument();
    expectLogicalOnly(container);
  });

  it('says when there is no seal yet', () => {
    renderVerify(<VerificationPanel code="7K2QH-M9XWD" url={PANEL_URL} seal={null} locale="en" />);
    expect(screen.getByText('No seal yet')).toBeInTheDocument();
  });
});

describe('CopyLinkButton', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  }

  it('copies the URL and announces it politely', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    setClipboard({ writeText });
    renderVerify(<CopyLinkButton url={PANEL_URL} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PANEL_URL));
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(live).toHaveTextContent('Link copied'));
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();
  });

  it.each([
    ['unavailable', undefined],
    ['rejecting', { writeText: () => Promise.reject(new Error('denied')) }],
  ])('selects the URL text when the clipboard is %s', async (_, clipboard) => {
    setClipboard(clipboard);
    renderVerify(<CopyLinkButton url={PANEL_URL} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    const live = screen.getByRole('status');
    await waitFor(() => expect(live).toHaveTextContent('Link selected. Press Ctrl+C to copy it.'));
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Public link' });
    expect(input.value).toBe(PANEL_URL);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(PANEL_URL.length);
  });
});

const VERIFIED: VerificationCertificateResult = {
  code: '7K2QHM9XWD',
  branch: { name: 'Gulberg', city: 'Lahore' },
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  approvedTotal: '1234567.5',
  collectionCount: 1180,
  approvedOn: '2026-10-27',
  integrity: 'verified',
  anchor: { chainSeq: 42, seal: '0123456789abcdef' },
  sealCheck: 'not_provided',
  chain: { status: 'intact', checkedEvents: 512, brokenAtSeq: null, checkedAt: CHECKED_AT },
};

function renderCertificate(result: VerificationCertificateResult, locale: Loc = 'en') {
  const view = renderVerify(<VerificationCertificate result={result} locale={locale} />, locale);
  const article = view.container.querySelector('article');
  if (!article) throw new Error('no article');
  return { ...view, article };
}

describe('VerificationCertificate', () => {
  it('presents a verified report with every listed field', () => {
    const { article } = renderCertificate(VERIFIED);
    const text = article.textContent ?? '';

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('This report is verified');
    expect(text).toContain(msg('en', 'result.integrityDetail.verified'));
    expect(text).toContain('Gulberg');
    expect(text).toContain('Lahore');
    expect(text).toContain(
      msg('en', 'result.week', {
        start: formatDate('2026-10-19', 'en'),
        end: formatDate('2026-10-25', 'en'),
      }),
    );
    expect(screen.getByText('PKR 1,234,567.50').tagName).toBe('BDI');
    expect(text).toContain('1,180');
    expect(text).toContain(formatDate('2026-10-27', 'en'));
    expect(text).toContain('Recorded in the audit chain as event #42');
    expect(screen.getByText('0123 4567 89ab cdef')).toBeInTheDocument();
    expect(text).toContain('Audit chain intact: 512 events checked');
    expect(text).toContain(`Checked at ${formatDateTime(new Date(CHECKED_AT), 'en')}`);
    expect(text).toContain('No personal information is shown on this page.');
    expect(screen.getByText('7K2QH-M9XWD').tagName).toBe('BDI');
    expect(article).toHaveAttribute('dir', 'ltr');
    const steps = [...article.querySelectorAll('li[data-step]')].map((li) =>
      li.getAttribute('data-step'),
    );
    expect(steps).toEqual(['approved', 'recorded', 'checked']);
  });

  it.each([
    ['mismatch', 'danger'],
    ['unanchored', 'warning'],
    ['chain_broken', 'danger'],
  ] as const)('shows its own headline, detail and icon for %s', (integrity, toneName) => {
    const result: VerificationCertificateResult = {
      ...VERIFIED,
      integrity,
      ...(integrity === 'unanchored'
        ? { anchor: null, approvedOn: null, collectionCount: null }
        : {}),
      ...(integrity === 'chain_broken'
        ? {
            chain: {
              status: 'broken' as const,
              checkedEvents: 30,
              brokenAtSeq: 17,
              checkedAt: CHECKED_AT,
            },
          }
        : {}),
    };
    const { article } = renderCertificate(result);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent(msg('en', `result.integrity.${integrity}`));
    expect(article.textContent).toContain(msg('en', `result.integrityDetail.${integrity}`));
    expect(article).toHaveAttribute('data-integrity', integrity);
    // An icon sits next to the words; the tone is never the only signal.
    const badge = heading.parentElement?.previousElementSibling;
    expect(badge?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(badge?.className).toContain(`tone-${toneName}`);

    if (integrity === 'unanchored') {
      expect(article.textContent).toContain('No approval event found');
      expect(article.textContent).toContain('Not recorded');
      expect(article.querySelector('[data-seal]')).toBeNull();
    }
    if (integrity === 'chain_broken') {
      expect(article.textContent).toContain('Audit chain broken at event #17');
    }
  });

  it('warns prominently when the seal in the link does not match', () => {
    const { article } = renderCertificate({ ...VERIFIED, sealCheck: 'mismatch' });
    const warning = article.querySelector<HTMLElement>('[data-seal-warning]');
    if (!warning) throw new Error('no seal warning');
    expect(within(warning).getByText('Seal does not match')).toBeInTheDocument();
    expect(warning).toHaveTextContent(msg('en', 'result.sealCheck.mismatch'));
  });

  it('confirms a matching seal and says nothing extra when no seal was given', () => {
    const matched = renderCertificate({ ...VERIFIED, sealCheck: 'match' });
    expect(matched.article.textContent).toContain(msg('en', 'result.sealCheck.match'));
    matched.unmount();

    const { article } = renderCertificate(VERIFIED);
    expect(article.querySelector('[data-seal-warning]')).toBeNull();
    expect(article.textContent).not.toContain(msg('en', 'result.sealCheck.not_provided'));
    expect(article.textContent).not.toContain(msg('en', 'result.sealCheck.match'));
  });

  it('renders right to left in Urdu with Latin digits for codes, amounts and event numbers', () => {
    const { article } = renderCertificate(VERIFIED, 'ur');
    expect(article).toHaveAttribute('dir', 'rtl');
    expect(article).toHaveAttribute('lang', 'ur');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      msg('ur', 'result.integrity.verified'),
    );
    expect(screen.getByText('PKR 1,234,567.50').tagName).toBe('BDI');
    expect(screen.getByText('7K2QH-M9XWD').tagName).toBe('BDI');
    expect(article.textContent).toContain(msg('ur', 'result.anchor', { seq: '42' }));
    expect(article.textContent).toContain(msg('ur', 'result.privacy'));
    expect(article.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('uses logical layout classes only, in every state and both locales', () => {
    for (const locale of LOCALES) {
      for (const integrity of ['verified', 'mismatch', 'unanchored', 'chain_broken'] as const) {
        const { container, unmount } = renderCertificate(
          { ...VERIFIED, integrity, sealCheck: 'mismatch' },
          locale,
        );
        expectLogicalOnly(container);
        unmount();
      }
    }
  });

  it('never renders fields beyond the listed ones', () => {
    const leaky = {
      ...VERIFIED,
      reviewerName: 'Bilal Ahmed',
      leadEmail: 'lead@example.test',
      leadPhone: '+92 300 1234567',
      notes: 'Private note',
    } as unknown as VerificationCertificateResult;
    const { container } = renderCertificate(leaky);
    const html = container.innerHTML;
    for (const secret of ['Bilal Ahmed', 'lead@example.test', '+92 300 1234567', 'Private note']) {
      expect(html).not.toContain(secret);
    }
  });

  it('can be the page headline', () => {
    renderVerify(<VerificationCertificate result={VERIFIED} locale="en" headingLevel={1} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This report is verified');
  });
});

describe('verification components source', () => {
  it('never injects HTML or reaches into modules', () => {
    for (const file of [
      'Qr.tsx',
      'ChainStatusBadge.tsx',
      'VerificationPanel.tsx',
      'CopyLinkButton.tsx',
      'VerificationCertificate.tsx',
      'parts.tsx',
    ]) {
      const source = readFileSync(path.join(import.meta.dirname, file), 'utf8');
      expect(source, file).not.toContain('dangerouslySetInnerHTML');
      expect(source, file).not.toMatch(/from '@\/modules\//);
    }
  });
});
