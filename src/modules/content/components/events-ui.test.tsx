// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { formatDateTime } from '@/platform/i18n/format';
import type { EventView } from '../event-types';
import { EventsTable } from './EventsTable';

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

const ID = '7d1f2c3e-1111-4a5b-8c9d-0e1f2a3b4c5d';
const BRANCH_A = { id: '0b5c7a10-aaaa-4bbb-8ccc-000000000001', name: 'Gulberg' };

function event(overrides: Partial<EventView> = {}): EventView {
  return {
    id: ID,
    slug: 'evt-1a2b3c4d',
    titleEn: 'Health camp',
    titleUr: 'طبی کیمپ',
    summaryEn: 'Free check-ups.',
    summaryUr: 'مفت معائنہ',
    location: 'Community hall',
    startsAt: '2026-11-15T09:30:00.000Z',
    endsAt: '2026-11-15T12:00:00.000Z',
    branchId: BRANCH_A.id,
    branchName: BRANCH_A.name,
    status: 'draft',
    hasUnpublishedChanges: false,
    publishedAt: null,
    updatedAt: '2026-10-20T09:15:00.000Z',
    ...overrides,
  };
}

const EVENTS: EventView[] = [
  event({
    id: 'e1',
    titleEn: 'Iftar drive',
    status: 'published',
    publishedAt: '2026-10-19T08:00:00.000Z',
  }),
  event({
    id: 'e2',
    titleEn: 'Health camp',
    status: 'published',
    hasUnpublishedChanges: true,
    publishedAt: '2026-10-19T08:00:00.000Z',
  }),
  event({
    id: 'e3',
    titleEn: null,
    titleUr: 'اردو صرف',
    location: null,
    startsAt: null,
    endsAt: null,
  }),
];

const SOURCES = ['EventsTable.tsx'];

const fetchMock = vi.fn<typeof fetch>();

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

describe.each(LOCALES)('event screens (%s)', (locale) => {
  const render = (ui: React.ReactElement) => renderWithIntl(ui, { locale, namespaces: NAMESPACES });

  describe('EventsTable', () => {
    const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLTableRowElement;

    it('lists events with title links, start time, venue and state', () => {
      const { container } = render(<EventsTable events={EVENTS} />);
      expect(container).toHaveAttribute('lang', locale);
      expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      const table = screen.getByRole('table', { name: msg(locale, 'events.caption') });
      expect(within(table).getAllByRole('row')).toHaveLength(4);
      for (const header of ['title', 'starts', 'venue', 'status']) {
        expect(
          within(table).getByRole('columnheader', {
            name: msg(locale, `events.columns.${header}`),
          }),
        ).toBeInTheDocument();
      }
      expect(screen.getByRole('link', { name: 'Iftar drive' })).toHaveAttribute(
        'href',
        '/content/events/e1',
      );
      const cells = rowOf('Iftar drive').querySelectorAll('td');
      const start = formatDateTime(new Date('2026-11-15T09:30:00.000Z'), locale);
      expect(cells[1]).toHaveTextContent(start);
      expect(cells[1]!.querySelector('time')).toHaveAttribute(
        'dateTime',
        '2026-11-15T09:30:00.000Z',
      );
      expect(cells[1]!.querySelector('bdi')).toHaveTextContent(start);
      expect(cells[2]).toHaveTextContent('Community hall');
      expect(cells[3]).toHaveTextContent(msg(locale, 'state.published'));
      expect(cells[3]).not.toHaveTextContent(msg(locale, 'state.unpublishedChanges'));
    });

    it('marks unpublished changes and drafts', () => {
      render(<EventsTable events={EVENTS} />);
      const changed = rowOf('Health camp').querySelectorAll('td')[3]!;
      expect(changed).toHaveTextContent(msg(locale, 'state.published'));
      expect(changed).toHaveTextContent(msg(locale, 'state.unpublishedChanges'));
      const draft = rowOf('اردو صرف').querySelectorAll('td')[3]!;
      expect(draft).toHaveTextContent(msg(locale, 'state.draft'));
    });

    it('falls back to the Urdu title in Urdu direction and shows missing date and venue', () => {
      render(<EventsTable events={EVENTS} />);
      const link = screen.getByRole('link', { name: 'اردو صرف' });
      expect(link).toHaveAttribute('href', '/content/events/e3');
      expect(link.querySelector('[lang="ur"]')).toHaveAttribute('dir', 'rtl');
      const cells = rowOf('اردو صرف').querySelectorAll('td');
      expect(cells[1]).toHaveTextContent(msg(locale, 'events.noDate'));
      expect(cells[2]).toHaveTextContent('—');
    });

    it('shows the untitled label when neither title is set', () => {
      render(<EventsTable events={[event({ id: 'e9', titleEn: null, titleUr: null })]} />);
      expect(screen.getByRole('link', { name: msg(locale, 'events.untitled') })).toHaveAttribute(
        'href',
        '/content/events/e9',
      );
    });

    it('offers a new event button', () => {
      render(<EventsTable events={EVENTS} />);
      expect(screen.getByRole('link', { name: msg(locale, 'events.new') })).toHaveAttribute(
        'href',
        '/content/events/new',
      );
    });

    it('shows the empty state with a new event link when there are no events', () => {
      render(<EventsTable events={[]} />);
      expect(screen.queryByRole('table')).toBeNull();
      const empty = screen.getByRole('status');
      expect(empty).toHaveTextContent(msg(locale, 'events.empty.title'));
      expect(empty).toHaveTextContent(msg(locale, 'events.empty.body'));
      expect(within(empty).getByRole('link', { name: msg(locale, 'events.new') })).toHaveAttribute(
        'href',
        '/content/events/new',
      );
    });
  });
});

describe('event components', () => {
  it.each(SOURCES)('%s uses logical direction utilities only', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
  });
});
