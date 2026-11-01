// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { formatDateTime } from '@/platform/i18n/format';
import type { ContentEntryView } from '../types';
import { ContentEditor } from './ContentEditor';
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

const SOURCES = [
  'ContentTabs.tsx',
  'ContentEntriesTable.tsx',
  'ContentPreview.tsx',
  'ContentEditor.tsx',
];

function commonMsg(locale: Locale, key: string): string {
  const file = path.resolve(import.meta.dirname, `../../../../messages/${locale}/common.json`);
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
      JSON.parse(readFileSync(file, 'utf8')) as unknown,
    );
  if (typeof value !== 'string') throw new Error(`missing common message ${locale}:${key}`);
  return value;
}

const fetchMock = vi.fn<typeof fetch>();

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no modal dialog support
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
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
  describe('ContentEditor', () => {
    const URL = '/api/v1/content/entries/about/en';
    const titleField = () => screen.getByLabelText(msg(locale, 'editor.titleLabel'));
    const bodyField = () => screen.getByLabelText(msg(locale, 'editor.bodyLabel'));
    const saveButton = () => screen.getByRole('button', { name: msg(locale, 'editor.save') });
    const publishButton = () => screen.getByRole('button', { name: msg(locale, 'editor.publish') });
    const confirmIn = (name: string) =>
      within(screen.getByRole('dialog')).getByRole('button', { name: msg(locale, name) });

    it('shows the draft in fields that follow the entry language', () => {
      const { container } = render(<ContentEditor entry={view()} />);
      expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: msg(locale, 'editor.title', { page: msg(locale, 'keys.about') }),
        }),
      ).toBeInTheDocument();
      expect(titleField()).toHaveValue('About us');
      expect(bodyField()).toHaveValue('We help.');
      expect(bodyField()).toHaveAttribute('dir', 'ltr');
      expect(bodyField()).toHaveAttribute('lang', 'en');
      expect(bodyField()).toHaveAttribute('maxLength', '20000');
      expect(titleField()).toHaveAttribute('dir', 'ltr');
    });

    it('uses right-to-left Urdu fields for an Urdu entry in any admin language', () => {
      render(
        <ContentEditor
          entry={view({ key: 'programs', locale: 'ur', title: 'پروگرام', body: 'اردو متن' })}
        />,
      );
      expect(bodyField()).toHaveAttribute('dir', 'rtl');
      expect(bodyField()).toHaveAttribute('lang', 'ur');
      expect(titleField()).toHaveAttribute('dir', 'rtl');
      expect(titleField()).toHaveAttribute('lang', 'ur');
    });

    it('offers Markdown help that rules out HTML', () => {
      const { container } = render(<ContentEditor entry={view()} />);
      const help = container.querySelector('details')!;
      expect(help.querySelector('summary')).toHaveTextContent(msg(locale, 'editor.bodyHelpTitle'));
      expect(help).toHaveTextContent(msg(locale, 'editor.bodyHelp'));
      expect(help.querySelectorAll('li code').length).toBeGreaterThanOrEqual(6);
      expect(bodyField().getAttribute('aria-describedby')).toContain(
        help.querySelector('[id]')!.id,
      );
    });

    it('links to the private preview and back to the list', () => {
      render(<ContentEditor entry={view()} />);
      expect(screen.getByRole('link', { name: msg(locale, 'editor.previewLink') })).toHaveAttribute(
        'href',
        '/content/about/en/preview',
      );
      expect(screen.getByRole('link', { name: msg(locale, 'editor.back') })).toHaveAttribute(
        'href',
        '/content',
      );
    });

    it('shows the published state, date and unpublished-changes notice', () => {
      const publishedAt = '2026-10-19T08:00:00.000Z';
      render(
        <ContentEditor
          entry={view({ status: 'published', publishedAt, hasUnpublishedChanges: true })}
        />,
      );
      expect(screen.getByText(msg(locale, 'state.published'))).toBeInTheDocument();
      expect(
        screen.getByText(
          msg(locale, 'editor.publishedOn', {
            date: formatDateTime(new Date(publishedAt), locale),
          }),
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(msg(locale, 'editor.unpublishedChangesNotice'))).toBeInTheDocument();
    });

    it('flags a missing Urdu entry and says it is not published', () => {
      render(<ContentEditor entry={absent('about', 'ur')} />);
      expect(screen.getByText(msg(locale, 'editor.missingTranslationNotice'))).toBeInTheDocument();
      expect(screen.getByText(msg(locale, 'state.missingTranslation'))).toBeInTheDocument();
      expect(screen.getByText(msg(locale, 'editor.notPublished'))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: msg(locale, 'editor.unpublish') })).toBeNull();
    });

    it('enables Save only after a change and sends title and body with PUT', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(
        reply(200, { data: view({ title: 'About us', body: 'We help more.' }) }),
      );
      render(<ContentEditor entry={view()} />);
      expect(saveButton()).toBeDisabled();
      await user.clear(bodyField());
      await user.type(bodyField(), 'We help more.');
      expect(saveButton()).toBeEnabled();
      await user.click(saveButton());

      await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
      expect(calls()).toEqual([
        { url: URL, method: 'PUT', body: { title: 'About us', body: 'We help more.' } },
      ]);
      expect(screen.getByRole('status')).toHaveTextContent(msg(locale, 'editor.saved'));
      expect(saveButton()).toBeDisabled();
    });

    it('shows the save error when the server refuses or the network fails', async () => {
      const user = userEvent.setup();
      fetchMock
        .mockResolvedValueOnce(reply(500, { error: { code: 'internal_error' } }))
        .mockRejectedValueOnce(new TypeError('offline'));
      render(<ContentEditor entry={view()} />);
      await user.type(titleField(), '!');
      await user.click(saveButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(msg(locale, 'editor.errorSave'));
      await user.click(saveButton());
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('alert')).toHaveTextContent(msg(locale, 'editor.errorSave'));
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it('publishes after confirmation, saving unsaved edits first', async () => {
      const user = userEvent.setup();
      fetchMock
        .mockResolvedValueOnce(reply(200, { data: view({ title: 'New title' }) }))
        .mockResolvedValueOnce(
          reply(200, {
            data: view({
              title: 'New title',
              status: 'published',
              publishedAt: '2026-10-31T10:00:00.000Z',
            }),
          }),
        );
      render(<ContentEditor entry={view()} />);
      await user.clear(titleField());
      await user.type(titleField(), 'New title');
      await user.click(publishButton());

      expect(
        screen.getByRole('dialog', { name: msg(locale, 'editor.publishTitle') }),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      await user.click(confirmIn('editor.publish'));

      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(calls()).toEqual([
        { url: URL, method: 'PUT', body: { title: 'New title', body: 'We help.' } },
        { url: `${URL}/publish`, method: 'POST', body: undefined },
      ]);
      expect(screen.getByRole('status')).toHaveTextContent(msg(locale, 'editor.published'));
      expect(
        screen.getByRole('button', { name: msg(locale, 'editor.unpublish') }),
      ).toBeInTheDocument();
    });

    it('publishes without a save when nothing changed', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(reply(200, { data: view({ status: 'published' }) }));
      render(<ContentEditor entry={view()} />);
      await user.click(publishButton());
      await user.click(confirmIn('editor.publish'));
      await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
      expect(calls()).toEqual([{ url: `${URL}/publish`, method: 'POST', body: undefined }]);
    });

    it('does not publish when the confirmation is cancelled', async () => {
      const user = userEvent.setup();
      render(<ContentEditor entry={view()} />);
      await user.click(publishButton());
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: commonMsg(locale, 'actions.cancel'),
        }),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('explains that empty content cannot be published', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(
        reply(422, {
          error: {
            code: 'validation_failed',
            details: {
              fields: [{ path: 'body', code: 'empty_content', message: 'empty_content' }],
            },
          },
        }),
      );
      render(<ContentEditor entry={view({ title: null, body: null })} />);
      await user.click(publishButton());
      await user.click(confirmIn('editor.publish'));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        msg(locale, 'editor.errorPublishEmpty'),
      );
    });

    it('cannot publish an entry that was never saved and has no edits', () => {
      render(<ContentEditor entry={absent('about', 'en')} />);
      expect(publishButton()).toBeDisabled();
    });

    it('unpublishes a published entry after a destructive confirmation', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(reply(200, { data: view({ status: 'draft' }) }));
      render(<ContentEditor entry={view({ status: 'published' })} />);
      await user.click(screen.getByRole('button', { name: msg(locale, 'editor.unpublish') }));
      expect(
        screen.getByRole('dialog', { name: msg(locale, 'editor.unpublishTitle') }),
      ).toBeInTheDocument();
      const confirm = confirmIn('editor.unpublish');
      expect(confirm.className).toContain('bg-danger');
      await user.click(confirm);
      await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
      expect(calls()).toEqual([{ url: `${URL}/unpublish`, method: 'POST', body: undefined }]);
      expect(screen.getByRole('status')).toHaveTextContent(msg(locale, 'editor.unpublished'));
      expect(screen.queryByRole('button', { name: msg(locale, 'editor.unpublish') })).toBeNull();
    });

    it('shows the generic error when unpublish is refused', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(reply(409, { error: { code: 'not_published' } }));
      render(<ContentEditor entry={view({ status: 'published' })} />);
      await user.click(screen.getByRole('button', { name: msg(locale, 'editor.unpublish') }));
      await user.click(confirmIn('editor.unpublish'));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        msg(locale, 'editor.errorGeneric'),
      );
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });
});

describe('content components', () => {
  it.each(SOURCES)('%s uses logical direction utilities only', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
  });
});
