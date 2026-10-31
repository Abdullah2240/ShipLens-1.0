// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { formatDateTime } from '@/platform/i18n/format';
import type { EventView } from '../event-types';
import { EventEditor } from './EventEditor';
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
const BRANCH_B = { id: '0b5c7a10-aaaa-4bbb-8ccc-000000000002', name: 'Saddar' };
const BRANCHES = [BRANCH_A, BRANCH_B];

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

const SOURCES = ['EventsTable.tsx', 'EventEditor.tsx'];

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

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function invalid(fields: { path: string; code: string; message: string }[]): Response {
  return reply(422, { error: { code: 'validation_failed', details: { fields } } });
}

const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  }));

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

  describe('EventEditor', () => {
    const URL = `/api/v1/content/events/${ID}`;
    const field = (key: string) => screen.getByLabelText(msg(locale, `events.editor.${key}`));
    const button = (key: string) =>
      screen.getByRole('button', { name: msg(locale, `events.editor.${key}`) });
    const queryButton = (key: string) =>
      screen.queryByRole('button', { name: msg(locale, `events.editor.${key}`) });
    const confirmIn = (key: string) =>
      within(screen.getByRole('dialog')).getByRole('button', {
        name: msg(locale, `events.editor.${key}`),
      });
    const setValue = (element: HTMLElement, value: string) =>
      fireEvent.change(element, { target: { value } });

    describe('new event', () => {
      it('shows empty bilingual fields, Pakistan-time inputs and the branch select', () => {
        const { container } = render(<EventEditor event={null} branches={BRANCHES} />);
        expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
        expect(
          screen.getByRole('heading', { level: 1, name: msg(locale, 'events.editor.newTitle') }),
        ).toBeInTheDocument();
        expect(field('titleEn')).toHaveValue('');
        expect(field('titleEn')).toHaveAttribute('lang', 'en');
        expect(field('titleEn')).toHaveAttribute('dir', 'ltr');
        for (const key of ['titleUr', 'summaryUr']) {
          expect(field(key)).toHaveAttribute('lang', 'ur');
          expect(field(key)).toHaveAttribute('dir', 'rtl');
        }
        for (const key of ['startsAt', 'endsAt']) {
          expect(field(key)).toHaveAttribute('type', 'datetime-local');
          expect(field(key)).toHaveValue('');
          expect(field(key)).toHaveAccessibleDescription(msg(locale, 'events.editor.pktNote'));
        }
        expect(screen.getByText(msg(locale, 'events.editor.pktNote'))).toBeVisible();
        const select = field('branch') as HTMLSelectElement;
        expect(select).toHaveValue('');
        expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
          ['', msg(locale, 'events.editor.noBranch')],
          [BRANCH_A.id, BRANCH_A.name],
          [BRANCH_B.id, BRANCH_B.name],
        ]);
        expect(queryButton('publish')).toBeNull();
        expect(queryButton('unpublish')).toBeNull();
        expect(
          screen.getByRole('link', { name: msg(locale, 'events.editor.back') }),
        ).toHaveAttribute('href', '/content/events');
      });

      it('creates a draft with times converted to UTC and opens it', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(reply(201, { data: event({ id: 'created-id' }) }));
        render(<EventEditor event={null} branches={BRANCHES} />);
        expect(button('create')).toBeDisabled();
        await user.type(field('titleEn'), 'Health camp');
        await user.type(field('titleUr'), 'طبی کیمپ');
        await user.type(field('location'), 'Community hall');
        setValue(field('startsAt'), '2026-11-15T14:30');
        setValue(field('endsAt'), '2026-11-15T17:00');
        await user.selectOptions(field('branch'), BRANCH_B.id);
        expect(button('create')).toBeEnabled();
        await user.click(button('create'));

        await waitFor(() => expect(router.push).toHaveBeenCalledWith('/content/events/created-id'));
        expect(calls()).toEqual([
          {
            url: '/api/v1/content/events',
            method: 'POST',
            body: {
              titleEn: 'Health camp',
              titleUr: 'طبی کیمپ',
              summaryEn: null,
              summaryUr: null,
              location: 'Community hall',
              startsAt: '2026-11-15T09:30:00.000Z',
              endsAt: '2026-11-15T12:00:00.000Z',
              branchId: BRANCH_B.id,
            },
          },
        ]);
      });

      it('converts an early-morning Pakistan time to the previous UTC day', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(reply(201, { data: event({ id: 'created-id' }) }));
        render(<EventEditor event={null} branches={BRANCHES} />);
        await user.type(field('titleEn'), 'Sehri meal');
        setValue(field('startsAt'), '2026-11-15T03:00');
        await user.click(button('create'));
        await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
        expect(calls()[0]!.body).toMatchObject({ startsAt: '2026-11-14T22:00:00.000Z' });
      });

      it('sends no branch and no times when they are left empty', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(reply(201, { data: event({ id: 'created-id' }) }));
        render(<EventEditor event={null} branches={BRANCHES} />);
        await user.type(field('titleEn'), 'Open day');
        await user.click(button('create'));
        await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
        expect(calls()[0]!.body).toEqual({
          titleEn: 'Open day',
          titleUr: null,
          summaryEn: null,
          summaryUr: null,
          location: null,
          startsAt: null,
          endsAt: null,
          branchId: null,
        });
      });

      it('shows an inline error when the end is before the start', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(
          invalid([{ path: 'endsAt', code: 'custom', message: 'ends_before_start' }]),
        );
        render(<EventEditor event={null} branches={BRANCHES} />);
        await user.type(field('titleEn'), 'Health camp');
        setValue(field('startsAt'), '2026-11-15T14:30');
        setValue(field('endsAt'), '2026-11-15T10:00');
        await user.click(button('create'));

        expect(await screen.findByRole('alert')).toHaveTextContent(
          msg(locale, 'events.editor.errorFields'),
        );
        expect(field('endsAt')).toHaveAttribute('aria-invalid', 'true');
        expect(field('endsAt')).toHaveAccessibleDescription(
          expect.stringContaining(msg(locale, 'events.editor.errorEndsBeforeStart')),
        );
        expect(field('startsAt')).not.toHaveAttribute('aria-invalid');
        expect(router.push).not.toHaveBeenCalled();
      });

      it('shows the generic error when the network fails', async () => {
        const user = userEvent.setup();
        fetchMock.mockRejectedValueOnce(new TypeError('offline'));
        render(<EventEditor event={null} branches={BRANCHES} />);
        await user.type(field('titleEn'), 'Health camp');
        await user.click(button('create'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
          msg(locale, 'events.editor.errorGeneric'),
        );
        expect(router.push).not.toHaveBeenCalled();
      });
    });

    describe('existing event', () => {
      it('prefills the draft with times shown in Pakistan time', () => {
        render(<EventEditor event={event()} branches={BRANCHES} />);
        expect(
          screen.getByRole('heading', { level: 1, name: msg(locale, 'events.editor.editTitle') }),
        ).toBeInTheDocument();
        expect(field('titleEn')).toHaveValue('Health camp');
        expect(field('titleUr')).toHaveValue('طبی کیمپ');
        expect(field('summaryEn')).toHaveValue('Free check-ups.');
        expect(field('summaryUr')).toHaveValue('مفت معائنہ');
        expect(field('location')).toHaveValue('Community hall');
        expect(field('startsAt')).toHaveValue('2026-11-15T14:30');
        expect(field('endsAt')).toHaveValue('2026-11-15T17:00');
        expect(field('branch')).toHaveValue(BRANCH_A.id);
        expect(screen.getByText(msg(locale, 'state.draft'))).toBeInTheDocument();
        expect(button('save')).toBeDisabled();
        expect(queryButton('unpublish')).toBeNull();
        expect(
          screen.getByRole('link', { name: msg(locale, 'events.editor.publicLink') }),
        ).toHaveAttribute('href', '/events');
      });

      it('shows the published state, date and unpublished-changes notice', () => {
        const publishedAt = '2026-10-19T08:00:00.000Z';
        render(
          <EventEditor
            event={event({ status: 'published', publishedAt, hasUnpublishedChanges: true })}
            branches={BRANCHES}
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
        expect(
          screen.getByText(msg(locale, 'events.editor.unpublishedChangesNotice')),
        ).toBeInTheDocument();
        expect(button('unpublish')).toBeInTheDocument();
      });

      it('saves only the changed fields with PATCH, converting times to UTC', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(
          reply(200, {
            data: event({ location: 'Main hall', startsAt: '2026-11-15T10:00:00.000Z' }),
          }),
        );
        render(<EventEditor event={event()} branches={BRANCHES} />);
        await user.clear(field('location'));
        await user.type(field('location'), 'Main hall');
        setValue(field('startsAt'), '2026-11-15T15:00');
        expect(button('save')).toBeEnabled();
        await user.click(button('save'));

        await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
        expect(calls()).toEqual([
          {
            url: URL,
            method: 'PATCH',
            body: { location: 'Main hall', startsAt: '2026-11-15T10:00:00.000Z' },
          },
        ]);
        expect(screen.getByRole('status')).toHaveTextContent(msg(locale, 'events.editor.saved'));
        expect(button('save')).toBeDisabled();
      });

      it('clears a time and an optional text with null', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(reply(200, { data: event({ endsAt: null }) }));
        render(<EventEditor event={event()} branches={BRANCHES} />);
        setValue(field('endsAt'), '');
        await user.clear(field('summaryUr'));
        await user.click(button('save'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(calls()[0]!.body).toEqual({ summaryUr: null, endsAt: null });
      });

      it('changes the branch and clears it with "no branch"', async () => {
        const user = userEvent.setup();
        fetchMock
          .mockResolvedValueOnce(
            reply(200, { data: event({ branchId: BRANCH_B.id, branchName: BRANCH_B.name }) }),
          )
          .mockResolvedValueOnce(reply(200, { data: event({ branchId: null, branchName: null }) }));
        render(<EventEditor event={event()} branches={BRANCHES} />);
        await user.selectOptions(field('branch'), BRANCH_B.id);
        await user.click(button('save'));
        await waitFor(() => expect(button('save')).toBeDisabled());
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await user.selectOptions(field('branch'), '');
        await user.click(button('save'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(calls().map((c) => c.body)).toEqual([{ branchId: BRANCH_B.id }, { branchId: null }]);
      });

      it('keeps a branch that is no longer Active unless the editor changes it', async () => {
        const user = userEvent.setup();
        const closed = { id: '0b5c7a10-aaaa-4bbb-8ccc-0000000000ff', name: 'Old town' };
        fetchMock.mockResolvedValueOnce(reply(200, { data: event() }));
        render(
          <EventEditor
            event={event({ branchId: closed.id, branchName: closed.name })}
            branches={BRANCHES}
          />,
        );
        const select = field('branch') as HTMLSelectElement;
        expect(select).toHaveValue(closed.id);
        expect(select.selectedOptions[0]).toHaveTextContent(
          msg(locale, 'events.editor.branchInactive', { name: closed.name }),
        );
        await user.type(field('summaryEn'), ' Bring your card.');
        await user.click(button('save'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(calls()[0]!.body).toEqual({ summaryEn: 'Free check-ups. Bring your card.' });
      });

      it('shows the generic error when a save fails', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(reply(500, { error: { code: 'internal_error' } }));
        render(<EventEditor event={event()} branches={BRANCHES} />);
        await user.type(field('location'), ' B');
        await user.click(button('save'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
          msg(locale, 'events.editor.errorGeneric'),
        );
        expect(router.refresh).not.toHaveBeenCalled();
      });

      it('publishes after confirmation, saving unsaved edits first', async () => {
        const user = userEvent.setup();
        fetchMock
          .mockResolvedValueOnce(reply(200, { data: event({ titleEn: 'Eye camp' }) }))
          .mockResolvedValueOnce(
            reply(200, {
              data: event({
                titleEn: 'Eye camp',
                status: 'published',
                publishedAt: '2026-10-31T10:00:00.000Z',
              }),
            }),
          );
        render(<EventEditor event={event()} branches={BRANCHES} />);
        await user.clear(field('titleEn'));
        await user.type(field('titleEn'), 'Eye camp');
        await user.click(button('publish'));

        expect(
          screen.getByRole('dialog', { name: msg(locale, 'events.editor.publishTitle') }),
        ).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
        await user.click(confirmIn('publish'));

        await waitFor(() => expect(router.refresh).toHaveBeenCalled());
        expect(calls()).toEqual([
          { url: URL, method: 'PATCH', body: { titleEn: 'Eye camp' } },
          { url: `${URL}/publish`, method: 'POST', body: undefined },
        ]);
        expect(screen.getByRole('status')).toHaveTextContent(
          msg(locale, 'events.editor.published'),
        );
        expect(button('unpublish')).toBeInTheDocument();
      });

      it('publishes without a save when nothing changed', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(reply(200, { data: event({ status: 'published' }) }));
        render(<EventEditor event={event()} branches={BRANCHES} />);
        await user.click(button('publish'));
        await user.click(confirmIn('publish'));
        await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
        expect(calls()).toEqual([{ url: `${URL}/publish`, method: 'POST', body: undefined }]);
      });

      it('cannot publish a published event with nothing new', () => {
        render(<EventEditor event={event({ status: 'published' })} branches={BRANCHES} />);
        expect(button('publish')).toBeDisabled();
      });

      it('does not publish when the confirmation is cancelled', async () => {
        const user = userEvent.setup();
        render(<EventEditor event={event()} branches={BRANCHES} />);
        await user.click(button('publish'));
        await user.click(
          within(screen.getByRole('dialog')).getByRole('button', {
            name: commonMsg(locale, 'actions.cancel'),
          }),
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('marks fields that are required before publishing', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(
          invalid([
            { path: 'startsAt', code: 'required_to_publish', message: 'required_to_publish' },
          ]),
        );
        render(<EventEditor event={event({ startsAt: null, endsAt: null })} branches={BRANCHES} />);
        await user.click(button('publish'));
        await user.click(confirmIn('publish'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
          msg(locale, 'events.editor.errorFields'),
        );
        expect(field('startsAt')).toHaveAttribute('aria-invalid', 'true');
        expect(field('startsAt')).toHaveAccessibleDescription(
          expect.stringContaining(msg(locale, 'events.editor.errorRequiredToPublish')),
        );
        expect(router.refresh).not.toHaveBeenCalled();
      });

      it('does not publish when saving the edits fails', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(
          invalid([{ path: 'endsAt', code: 'ends_before_start', message: 'ends_before_start' }]),
        );
        render(<EventEditor event={event()} branches={BRANCHES} />);
        setValue(field('endsAt'), '2026-11-15T09:00');
        await user.click(button('publish'));
        await user.click(confirmIn('publish'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
          msg(locale, 'events.editor.errorFields'),
        );
        expect(calls()).toEqual([
          { url: URL, method: 'PATCH', body: { endsAt: '2026-11-15T04:00:00.000Z' } },
        ]);
        expect(field('endsAt')).toHaveAccessibleDescription(
          expect.stringContaining(msg(locale, 'events.editor.errorEndsBeforeStart')),
        );
      });

      it('unpublishes a published event after a destructive confirmation', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(reply(200, { data: event({ status: 'draft' }) }));
        render(<EventEditor event={event({ status: 'published' })} branches={BRANCHES} />);
        await user.click(button('unpublish'));
        expect(
          screen.getByRole('dialog', { name: msg(locale, 'events.editor.unpublishTitle') }),
        ).toBeInTheDocument();
        const confirm = confirmIn('unpublish');
        expect(confirm.className).toContain('bg-danger');
        await user.click(confirm);
        await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
        expect(calls()).toEqual([{ url: `${URL}/unpublish`, method: 'POST', body: undefined }]);
        expect(screen.getByRole('status')).toHaveTextContent(
          msg(locale, 'events.editor.unpublished'),
        );
        expect(queryButton('unpublish')).toBeNull();
      });

      it('shows the generic error when unpublish is refused', async () => {
        const user = userEvent.setup();
        fetchMock.mockResolvedValueOnce(reply(409, { error: { code: 'not_published' } }));
        render(<EventEditor event={event({ status: 'published' })} branches={BRANCHES} />);
        await user.click(button('unpublish'));
        await user.click(confirmIn('unpublish'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
          msg(locale, 'events.editor.errorGeneric'),
        );
        expect(router.refresh).not.toHaveBeenCalled();
      });
    });
  });
});

describe('event components', () => {
  it.each(SOURCES)('%s uses logical direction utilities only', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
  });
});
