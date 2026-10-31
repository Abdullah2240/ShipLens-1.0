// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { formatDateTime } from '@/platform/i18n/format';
import type { ContentEntryView } from '../types';
import { ContentEntriesTable } from './ContentEntriesTable';
import { ContentPreview } from './ContentPreview';
import { ContentTabs } from './ContentTabs';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

// next-intl's createNavigation cannot be imported under Vitest (see LanguageSwitcher.test).
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => router,
  Link: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Role queries over full tables and dialogs are slow on a busy runner.
vi.setConfig({ testTimeout: 20000 });

const LOCALES = ['en', 'ur'] as const;
type Locale = (typeof LOCALES)[number];
const NAMESPACES = ['common', 'shell', 'content'];

function messages(locale: Locale): Record<string, unknown> {
  const file = path.resolve(import.meta.dirname, `../../../../messages/${locale}/content.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function msg(locale: Locale, key: string, values: Record<string, string> = {}): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
      messages(locale),
    );
  if (typeof value !== 'string') throw new Error(`missing content message ${locale}:${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
}

function view(overrides: Partial<ContentEntryView> = {}): ContentEntryView {
  return {
    key: 'about',
    locale: 'en',
    exists: true,
    title: 'About us',
    body: 'We help.',
    status: 'draft',
    hasUnpublishedChanges: false,
    translationMissing: false,
    publishedAt: null,
    updatedAt: '2026-10-20T09:15:00.000Z',
    ...overrides,
  };
}

function absent(key: ContentEntryView['key'], locale: ContentEntryView['locale']) {
  return view({
    key,
    locale,
    exists: false,
    title: null,
    body: null,
    translationMissing: locale === 'ur',
    updatedAt: null,
  });
}

const ENTRIES: ContentEntryView[] = [
  view({
    key: 'about',
    locale: 'en',
    status: 'published',
    hasUnpublishedChanges: true,
    publishedAt: '2026-10-19T08:00:00.000Z',
    updatedAt: '2026-10-21T10:30:00.000Z',
  }),
  absent('about', 'ur'),
  view({ key: 'programs', locale: 'en', updatedAt: '2026-10-18T07:00:00.000Z' }),
  view({
    key: 'programs',
    locale: 'ur',
    title: 'پروگرام',
    body: 'اردو متن',
    status: 'published',
    publishedAt: '2026-10-22T06:00:00.000Z',
    updatedAt: '2026-10-22T06:00:00.000Z',
  }),
  absent('get-involved', 'en'),
  absent('get-involved', 'ur'),
  view({ key: 'contact', locale: 'en', status: 'published' }),
  view({ key: 'contact', locale: 'ur', title: '', body: '', translationMissing: true }),
];

const SOURCES = ['ContentTabs.tsx', 'ContentEntriesTable.tsx', 'ContentPreview.tsx'];

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no modal dialog support
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

describe.each(LOCALES)('content screens (%s)', (locale) => {
  const render = (ui: React.ReactElement) => renderWithIntl(ui, { locale, namespaces: NAMESPACES });

  describe('ContentTabs', () => {
    it('links Pages and Events and marks the active tab', () => {
      const { container } = render(<ContentTabs active="pages" />);
      expect(container).toHaveAttribute('lang', locale);
      expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      const nav = screen.getByRole('navigation', { name: msg(locale, 'tabs.label') });
      const pages = within(nav).getByRole('link', { name: msg(locale, 'tabs.pages') });
      const events = within(nav).getByRole('link', { name: msg(locale, 'tabs.events') });
      expect(pages).toHaveAttribute('href', '/content');
      expect(events).toHaveAttribute('href', '/content/events');
      expect(pages).toHaveAttribute('aria-current', 'page');
      expect(events).not.toHaveAttribute('aria-current');
    });

    it('marks Events active when asked', () => {
      render(<ContentTabs active="events" />);
      expect(screen.getByRole('link', { name: msg(locale, 'tabs.events') })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  });

  describe('ContentEntriesTable', () => {
    const rowFor = (key: string) =>
      screen.getByText(msg(locale, `keys.${key}`)).closest('tr') as HTMLTableRowElement;
    const cells = (key: string) => rowFor(key).querySelectorAll('td');

    it('shows one row per page with English and Urdu cells linking to the editor', () => {
      render(<ContentEntriesTable entries={ENTRIES} />);
      const table = screen.getByRole('table', { name: msg(locale, 'list.caption') });
      expect(within(table).getAllByRole('row')).toHaveLength(5);
      for (const key of ['about', 'programs', 'get-involved', 'contact']) {
        for (const [lang, name] of [
          ['en', 'columns.english'],
          ['ur', 'columns.urdu'],
        ] as const) {
          const link = screen.getByRole('link', {
            name: msg(locale, 'actions.open', {
              page: msg(locale, `keys.${key}`),
              language: msg(locale, name),
            }),
          });
          expect(link).toHaveAttribute('href', `/content/${key}/${lang}`);
        }
      }
    });

    it('shows draft, published, not created and unpublished-changes states', () => {
      render(<ContentEntriesTable entries={ENTRIES} />);
      const [, aboutEn, aboutUr] = cells('about');
      expect(aboutEn).toHaveTextContent(msg(locale, 'state.published'));
      expect(aboutEn).toHaveTextContent(msg(locale, 'state.unpublishedChanges'));
      expect(aboutUr).toHaveTextContent(msg(locale, 'state.notCreated'));
      const [, programsEn, programsUr] = cells('programs');
      expect(programsEn).toHaveTextContent(msg(locale, 'state.draft'));
      expect(programsEn).not.toHaveTextContent(msg(locale, 'state.unpublishedChanges'));
      expect(programsUr).toHaveTextContent(msg(locale, 'state.published'));
      const [, getInvolvedEn] = cells('get-involved');
      expect(getInvolvedEn).toHaveTextContent(msg(locale, 'state.notCreated'));
      expect(getInvolvedEn).not.toHaveTextContent(msg(locale, 'state.missingTranslation'));
    });

    it('marks missing Urdu translations with text, never on English', () => {
      render(<ContentEntriesTable entries={ENTRIES} />);
      const missing = msg(locale, 'state.missingTranslation');
      expect(cells('about')[2]).toHaveTextContent(missing);
      expect(cells('contact')[2]).toHaveTextContent(missing);
      expect(cells('programs')[2]).not.toHaveTextContent(missing);
      for (const key of ['about', 'programs', 'get-involved', 'contact']) {
        expect(cells(key)[1]).not.toHaveTextContent(missing);
      }
    });

    it('shows the latest edit with formatDateTime and a dash when never saved', () => {
      render(<ContentEntriesTable entries={ENTRIES} />);
      expect(cells('about')[3]).toHaveTextContent(
        formatDateTime(new Date('2026-10-21T10:30:00.000Z'), locale),
      );
      expect(cells('programs')[3]).toHaveTextContent(
        formatDateTime(new Date('2026-10-22T06:00:00.000Z'), locale),
      );
      expect(cells('get-involved')[3]).toHaveTextContent('—');
    });
  });

  describe('ContentPreview', () => {
    it('renders the draft under a private banner with the entry language', () => {
      const { container } = render(
        <ContentPreview
          entry={view({ title: 'Who we are', body: 'We **help** families.\n\n## Our work' })}
        />,
      );
      expect(screen.getByRole('note')).toHaveTextContent(msg(locale, 'preview.banner'));
      expect(screen.getByRole('heading', { level: 1, name: 'Who we are' })).toBeInTheDocument();
      const article = container.querySelector('article')!;
      expect(article).toHaveAttribute('lang', 'en');
      expect(article).toHaveAttribute('dir', 'ltr');
      expect(article.querySelector('strong')).toHaveTextContent('help');
      expect(screen.getByRole('link', { name: msg(locale, 'preview.back') })).toHaveAttribute(
        'href',
        '/content/about/en',
      );
    });

    it('uses Urdu direction for an Urdu entry whatever the admin language', () => {
      const { container } = render(
        <ContentPreview
          entry={view({ key: 'programs', locale: 'ur', title: 'پروگرام', body: 'اردو متن' })}
        />,
      );
      const article = container.querySelector('article')!;
      expect(article).toHaveAttribute('lang', 'ur');
      expect(article).toHaveAttribute('dir', 'rtl');
      expect(container).toHaveAttribute('lang', locale);
    });

    it('neutralises script and javascript: links in the draft body', () => {
      const { container } = render(
        <ContentPreview
          entry={view({ body: 'Hi <script>alert(1)</script>\n\n[x](javascript:alert(1))' })}
        />,
      );
      expect(container.querySelector('script')).not.toBeInTheDocument();
      expect(container.innerHTML).not.toMatch(/<script/i);
      for (const anchor of container.querySelectorAll('a')) {
        expect(anchor.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
      }
      expect(container.innerHTML).not.toMatch(/javascript:/i);
    });

    it('shows the missing-translation notice and no article for an empty Urdu entry', () => {
      const { container } = render(<ContentPreview entry={absent('about', 'ur')} />);
      expect(screen.getByRole('status')).toHaveTextContent(msg(locale, 'preview.missingNotice'));
      expect(container.querySelector('article')).not.toBeInTheDocument();
    });

    it('shows the empty message when title and body are both empty', () => {
      const { container } = render(<ContentPreview entry={view({ title: '', body: null })} />);
      expect(screen.getByRole('status')).toHaveTextContent(msg(locale, 'preview.empty'));
      expect(container.querySelector('article')).not.toBeInTheDocument();
    });
  });
});

describe('content components', () => {
  it.each(SOURCES)('%s uses logical direction utilities only', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
  });
});
