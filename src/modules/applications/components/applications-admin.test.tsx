// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useState, type ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { formatDateTime } from '@/platform/i18n/format';
import type { ApplicationDetail, ApplicationListItem } from '../review-types';
import { ApplicationDecision } from './ApplicationDecision';
import { ApplicationDetailView } from './ApplicationDetailView';
import {
  ApplicationStatusTabs,
  applicationTabFrom,
  applicationsHref,
} from './ApplicationStatusTabs';
import { ApplicationsTable } from './ApplicationsTable';

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
const NAMESPACES = ['common', 'shell', 'applications'];

function lookup(locale: Locale, ns: string, key: string): string {
  const file = path.resolve(import.meta.dirname, `../../../../messages/${locale}/${ns}.json`);
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
      JSON.parse(readFileSync(file, 'utf8')) as unknown,
    );
  if (typeof value !== 'string') throw new Error(`missing ${ns} message ${locale}:${key}`);
  return value;
}

function msg(locale: Locale, key: string, values: Record<string, string> = {}): string {
  return lookup(locale, 'applications', `admin.${key}`).replace(
    /\{(\w+)\}/g,
    (_, name: string) => values[name] ?? `{${name}}`,
  );
}

const BRANCH_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '0b6f3c5e-6a43-4e7d-9a52-6f1f0a1d2e01';

function item(overrides: Partial<ApplicationListItem> = {}): ApplicationListItem {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    fullName: 'Zara Hussain',
    email: 'zara@example.test',
    phone: '+923001234567',
    branchId: BRANCH_A,
    branchName: 'Lahore',
    status: 'pending',
    createdAt: '2026-10-30T09:15:00.000Z',
    decidedAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    ...item(),
    message: 'I can teach maths.\nWeekends only.',
    decisionNote: null,
    decidedByName: null,
    memberId: null,
    memberCode: null,
    ...overrides,
  };
}

const ITEMS: ApplicationListItem[] = [
  item(),
  item({
    id: 'a0000000-0000-4000-8000-000000000002',
    fullName: 'Kamran Shah',
    email: 'kamran@example.test',
    phone: null,
    branchId: BRANCH_B,
    branchName: 'Karachi',
    status: 'declined',
    createdAt: '2026-10-28T18:40:00.000Z',
    decidedAt: '2026-10-29T06:00:00.000Z',
  }),
];

const ACCEPTED = detail({
  status: 'accepted',
  decidedAt: '2026-10-31T20:30:00.000Z',
  decidedByName: 'Hira Raza',
  decisionNote: 'Welcome aboard.',
  memberId: MEMBER_ID,
  memberCode: 'M00051',
});

const DECLINED = detail({
  status: 'declined',
  decidedAt: '2026-10-31T07:05:00.000Z',
  decidedByName: 'Hira Raza',
  decisionNote: 'Not recruiting for teaching\nthis month.',
});

// Physical-direction utilities, with any variant prefix (for example `hover:ml-2`).
const PHYSICAL_CLASS =
  /(^|\s)(?:[\w-]+:)*-?(?:ml|mr|pl|pr|left|right)-|(^|\s)text-(?:left|right)(\s|$)/;

function physicalClasses(root: HTMLElement): string[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>('[class]'))]
    .map((node) => node.getAttribute('class') ?? '')
    .filter((value) => PHYSICAL_CLASS.test(value));
}

function isIsolatedLtr(node: HTMLElement): boolean {
  return node.closest('[dir="ltr"]') !== null;
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  router.refresh.mockReset();
  fetchMock = vi.fn();
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

describe('applicationTabFrom and applicationsHref', () => {
  it('defaults to pending and accepts the three statuses and all', () => {
    expect(applicationTabFrom(undefined)).toBe('pending');
    expect(applicationTabFrom('')).toBe('pending');
    expect(applicationTabFrom('unknown')).toBe('pending');
    expect(applicationTabFrom('accepted')).toBe('accepted');
    expect(applicationTabFrom(['declined', 'accepted'])).toBe('declined');
    expect(applicationTabFrom('all')).toBe('all');
  });

  it('keeps only the status in the URL and drops page 1 and the default page size', () => {
    expect(applicationsHref('pending')).toBe('/people/applications');
    expect(applicationsHref('accepted')).toBe('/people/applications?status=accepted');
    expect(applicationsHref('all', 3)).toBe('/people/applications?status=all&page=3');
    expect(applicationsHref('pending', 2)).toBe('/people/applications?page=2');
    expect(applicationsHref('declined', 1, 25)).toBe('/people/applications?status=declined');
    expect(applicationsHref('declined', 2, 50)).toBe(
      '/people/applications?status=declined&pageSize=50&page=2',
    );
  });
});

describe.each(LOCALES)('ApplicationStatusTabs (%s)', (locale) => {
  const m = (key: string) => msg(locale, key);

  it('links the four views and marks only the active one as current', () => {
    const { container } = renderWithIntl(<ApplicationStatusTabs active="accepted" />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('lang', locale);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');

    const nav = screen.getByRole('navigation', { name: m('list.tabsLabel') });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      m('list.tabPending'),
      m('list.tabAccepted'),
      m('list.tabDeclined'),
      m('list.tabAll'),
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/people/applications',
      '/people/applications?status=accepted',
      '/people/applications?status=declined',
      '/people/applications?status=all',
    ]);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      'page',
      null,
      null,
    ]);
    expect(physicalClasses(container)).toEqual([]);
  });

  it('marks pending as current by default', () => {
    renderWithIntl(<ApplicationStatusTabs active="pending" />, { locale, namespaces: NAMESPACES });
    expect(screen.getByRole('link', { name: m('list.tabPending') })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe.each(LOCALES)('ApplicationsTable (%s)', (locale) => {
  const m = (key: string) => msg(locale, key);

  it('renders the applicant columns with translated headers', () => {
    const { container } = renderWithIntl(<ApplicationsTable applications={ITEMS} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    const table = screen.getByRole('table', { name: m('list.caption') });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      m('columns.applicant'),
      m('columns.contact'),
      m('columns.received'),
      m('columns.status'),
    ]);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(physicalClasses(container)).toEqual([]);
  });

  it('adds a branch column for the head office view', () => {
    renderWithIntl(<ApplicationsTable applications={ITEMS} showBranch />, {
      locale,
      namespaces: NAMESPACES,
    });
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      m('columns.applicant'),
      m('columns.contact'),
      m('columns.branch'),
      m('columns.received'),
      m('columns.status'),
    ]);
    expect(screen.getByText('Karachi')).toBeInTheDocument();
  });

  it('links each applicant to the application page', () => {
    renderWithIntl(<ApplicationsTable applications={ITEMS} />, { locale, namespaces: NAMESPACES });
    expect(screen.getByRole('link', { name: 'Zara Hussain' })).toHaveAttribute(
      'href',
      `/people/applications/${ITEMS[0]?.id}`,
    );
    expect(screen.getByRole('link', { name: 'Kamran Shah' })).toHaveAttribute(
      'href',
      `/people/applications/${ITEMS[1]?.id}`,
    );
  });

  it('isolates emails and phones left-to-right', () => {
    renderWithIntl(<ApplicationsTable applications={ITEMS} />, { locale, namespaces: NAMESPACES });
    for (const text of ['zara@example.test', '+923001234567', 'kamran@example.test']) {
      expect(screen.getByText(text)).toHaveAttribute('dir', 'ltr');
    }
  });

  it('shows the received time in Pakistan time and a translated status', () => {
    renderWithIntl(<ApplicationsTable applications={ITEMS} />, { locale, namespaces: NAMESPACES });
    const received = formatDateTime(new Date('2026-10-30T09:15:00.000Z'), locale);
    const time = screen.getByText(received);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-10-30T09:15:00.000Z');
    expect(screen.getByText(lookup(locale, 'common', 'status.pending'))).toBeInTheDocument();
    expect(screen.getByText(lookup(locale, 'common', 'status.declined'))).toBeInTheDocument();
  });

  it('renders the admin empty state when nothing matches', () => {
    renderWithIntl(<ApplicationsTable applications={[]} />, { locale, namespaces: NAMESPACES });
    expect(screen.queryByRole('table')).toBeNull();
    const empty = screen.getByRole('status');
    expect(empty).toHaveTextContent(m('list.empty.title'));
    expect(empty).toHaveTextContent(m('list.empty.body'));
  });
});

describe.each(LOCALES)('ApplicationDetailView (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);

  it('shows the applicant, contact details left-to-right, branch, received time and status', () => {
    const { container } = renderWithIntl(<ApplicationDetailView application={detail()} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('lang', locale);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(screen.getByRole('heading', { level: 1, name: 'Zara Hussain' })).toBeInTheDocument();
    expect(screen.getByText('zara@example.test')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('+923001234567')).toHaveAttribute('dir', 'ltr');
    expect(screen.getAllByText('Lahore').length).toBeGreaterThan(0);
    const received = formatDateTime(new Date('2026-10-30T09:15:00.000Z'), locale);
    expect(screen.getAllByText(received)[0]?.closest('time')).toHaveAttribute(
      'dateTime',
      '2026-10-30T09:15:00.000Z',
    );
    expect(screen.getByText(lookup(locale, 'common', 'status.pending'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: m('detail.back') })).toHaveAttribute(
      'href',
      '/people/applications',
    );
    expect(physicalClasses(container)).toEqual([]);
  });

  it('renders the message as pre-wrapped plain text', () => {
    renderWithIntl(<ApplicationDetailView application={detail()} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const message = screen.getByText(/I can teach maths\./);
    expect(message.textContent).toBe('I can teach maths.\nWeekends only.');
    expect(message.className).toContain('whitespace-pre-wrap');
  });

  it('never turns applicant text into markup', () => {
    const hostile = detail({
      fullName: '<b>Bold</b> name',
      message: '<script>x</script>',
    });
    const { container } = renderWithIntl(<ApplicationDetailView application={hostile} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByText('<script>x</script>')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('<b>Bold</b> name');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('says when there is no message or phone', () => {
    renderWithIntl(<ApplicationDetailView application={detail({ message: null, phone: null })} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByText(m('detail.noMessage'))).toBeInTheDocument();
    expect(screen.getByText(m('detail.notProvided'))).toBeInTheDocument();
  });

  it('shows the waiting notice while pending, or the decision slot when given', () => {
    const { unmount } = renderWithIntl(<ApplicationDetailView application={detail()} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByText(m('detail.awaiting'))).toBeInTheDocument();
    expect(screen.queryByText(m('detail.decidedBy'))).toBeNull();
    unmount();

    renderWithIntl(
      <ApplicationDetailView
        application={detail()}
        decision={<button type="button">decide here</button>}
      />,
      { locale, namespaces: NAMESPACES },
    );
    expect(screen.getByRole('button', { name: 'decide here' })).toBeInTheDocument();
    expect(screen.queryByText(m('detail.awaiting'))).toBeNull();
  });

  it('shows who declined, when, and the note, with no member link', () => {
    renderWithIntl(<ApplicationDetailView application={DECLINED} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByText(lookup(locale, 'common', 'status.declined'))).toBeInTheDocument();
    expect(screen.getByText(m('detail.decidedBy'))).toBeInTheDocument();
    expect(screen.getByText('Hira Raza')).toBeInTheDocument();
    const decided = formatDateTime(new Date('2026-10-31T07:05:00.000Z'), locale);
    expect(screen.getByText(decided).closest('time')).toHaveAttribute(
      'dateTime',
      '2026-10-31T07:05:00.000Z',
    );
    const note = screen.getByText(/Not recruiting for teaching/);
    expect(note.textContent).toBe('Not recruiting for teaching\nthis month.');
    expect(note.className).toContain('whitespace-pre-wrap');
    expect(screen.queryByRole('link', { name: m('detail.viewMember') })).toBeNull();
    expect(screen.queryByText(m('detail.awaiting'))).toBeNull();
  });

  it('shows the new member code left-to-right with a link to the member', () => {
    renderWithIntl(<ApplicationDetailView application={ACCEPTED} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const code = screen.getByText('M00051');
    expect(code.tagName).toBe('BDI');
    expect(isIsolatedLtr(code)).toBe(true);
    expect(screen.getByRole('link', { name: m('detail.viewMember') })).toHaveAttribute(
      'href',
      `/people/members/${MEMBER_ID}`,
    );
    expect(screen.getByText('Welcome aboard.')).toBeInTheDocument();
  });
});

const APP_ID = 'a0000000-0000-4000-8000-000000000001';

function renderDecision(locale: Locale, status: ApplicationDetail['status'] = 'pending') {
  return renderWithIntl(
    <ApplicationDecision applicationId={APP_ID} applicantName="Zara Hussain" status={status} />,
    { locale, namespaces: NAMESPACES },
  );
}

function openDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('dialog[open]');
  if (!dialog) throw new Error('no open dialog');
  return dialog;
}

describe.each(LOCALES)('ApplicationDecision (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);

  it('renders nothing for a decided application', () => {
    for (const status of ['accepted', 'declined'] as const) {
      const { container, unmount } = renderDecision(locale, status);
      expect(container.querySelector('button')).toBeNull();
      expect(container.textContent).toBe('');
      unmount();
    }
  });

  it('offers accept and decline for a pending application, with logical classes only', () => {
    const { container } = renderDecision(locale);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(screen.getByRole('button', { name: m('decision.accept') })).toBeEnabled();
    expect(screen.getByRole('button', { name: m('decision.decline') })).toBeEnabled();
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(physicalClasses(container)).toEqual([]);
  });

  it('asks before accepting and sends nothing when cancelled', async () => {
    const user = userEvent.setup();
    renderDecision(locale);
    await user.click(screen.getByRole('button', { name: m('decision.accept') }));
    const dialog = openDialog();
    expect(within(dialog).getByRole('heading', { name: m('decision.acceptTitle') })).toBeVisible();
    expect(dialog).toHaveTextContent(m('decision.acceptBody', { name: 'Zara Hussain' }));
    await user.click(
      within(dialog).getByRole('button', { name: lookup(locale, 'common', 'actions.cancel') }),
    );
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts once, shows the new member code with a link, and refreshes', async () => {
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    renderDecision(locale);
    await user.click(screen.getByRole('button', { name: m('decision.accept') }));
    const confirm = within(openDialog()).getByRole('button', {
      name: m('decision.confirmAccept'),
    });
    await user.dblClick(confirm);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/applications/${APP_ID}/accept`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(screen.getByRole('button', { name: m('decision.accept') })).toBeDisabled();
    expect(screen.getByRole('button', { name: m('decision.decline') })).toBeDisabled();
    expect(screen.getByText(m('decision.working'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: m('decision.accept') }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(reply(200, { data: { memberId: MEMBER_ID, memberCode: 'M00052' } }));
    expect(
      await screen.findByText(m('decision.accepted', { name: 'Zara Hussain' })),
    ).toBeInTheDocument();
    const code = screen.getByText('M00052');
    expect(code.tagName).toBe('BDI');
    expect(isIsolatedLtr(code)).toBe(true);
    expect(screen.getByRole('link', { name: m('detail.viewMember') })).toHaveAttribute(
      'href',
      `/people/members/${MEMBER_ID}`,
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: m('decision.accept') })).toBeNull();
  });

  it('keeps the accepted notice after the page refreshes with the decided status', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, { data: { memberId: MEMBER_ID, memberCode: 'M00052' } }),
    );
    const user = userEvent.setup();
    // The page refresh re-renders the controls with the decided status.
    function Refreshing() {
      const [status, setStatus] = useState<ApplicationDetail['status']>('pending');
      router.refresh.mockImplementation(() => setStatus('accepted'));
      return (
        <ApplicationDecision applicationId={APP_ID} applicantName="Zara Hussain" status={status} />
      );
    }
    renderWithIntl(<Refreshing />, { locale, namespaces: NAMESPACES });
    await user.click(screen.getByRole('button', { name: m('decision.accept') }));
    await user.click(
      within(openDialog()).getByRole('button', { name: m('decision.confirmAccept') }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText('M00052')).toBeInTheDocument();
  });

  it('declines with a trimmed note as JSON and refreshes', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { data: { ok: true } }));
    const user = userEvent.setup();
    renderDecision(locale);
    await user.click(screen.getByRole('button', { name: m('decision.decline') }));
    const dialog = openDialog();
    expect(within(dialog).getByRole('heading', { name: m('decision.declineTitle') })).toBeVisible();
    expect(dialog).toHaveTextContent(m('decision.declineBody', { name: 'Zara Hussain' }));
    const note = within(dialog).getByLabelText(m('decision.noteLabel'));
    expect(note.tagName).toBe('TEXTAREA');
    expect(note).toHaveAttribute('maxLength', '500');
    await user.type(note, '  Not this term.  ');
    await user.click(within(dialog).getByRole('button', { name: m('decision.confirmDecline') }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/applications/${APP_ID}/decline`);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ note: 'Not this term.' });
    expect(await screen.findByText(m('decision.declined'))).toBeInTheDocument();
  });

  it('sends an empty decline body when no note is given', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { data: { ok: true } }));
    const user = userEvent.setup();
    renderDecision(locale);
    await user.click(screen.getByRole('button', { name: m('decision.decline') }));
    await user.click(
      within(openDialog()).getByRole('button', { name: m('decision.confirmDecline') }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('explains a lost race and refreshes on 409', async () => {
    fetchMock.mockResolvedValueOnce(reply(409, { error: { code: 'already_decided' } }));
    const user = userEvent.setup();
    renderDecision(locale);
    await user.click(screen.getByRole('button', { name: m('decision.accept') }));
    await user.click(
      within(openDialog()).getByRole('button', { name: m('decision.confirmAccept') }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(m('decision.alreadyDecided'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a server error', () => Promise.resolve(reply(500, { error: { code: 'internal_error' } }))],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('shows the generic error and allows a retry after %s', async (_label, outcome) => {
    fetchMock.mockImplementationOnce(outcome);
    const user = userEvent.setup();
    renderDecision(locale);
    await user.click(screen.getByRole('button', { name: m('decision.decline') }));
    await user.click(
      within(openDialog()).getByRole('button', { name: m('decision.confirmDecline') }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(m('decision.error'));
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: m('decision.decline') })).toBeEnabled();
    expect(screen.getByRole('button', { name: m('decision.accept') })).toBeEnabled();
  });
});

describe('applications messages', () => {
  it.each(LOCALES)(
    'keeps the public form and thanks keys next to the admin keys (%s)',
    (locale) => {
      for (const key of ['form.title', 'form.submit', 'form.errors.generic', 'thanks.title']) {
        expect(lookup(locale, 'applications', key).length).toBeGreaterThan(0);
      }
      expect(msg(locale, 'decision.acceptBody', { name: 'Zara' })).toContain('Zara');
      expect(msg(locale, 'decision.declineBody', { name: 'Zara' })).toContain('Zara');
    },
  );
});

describe('applications admin component sources', () => {
  it.each([
    'ApplicationsTable.tsx',
    'ApplicationStatusTabs.tsx',
    'ApplicationDetailView.tsx',
    'ApplicationDecision.tsx',
  ])('%s uses logical utilities only and imports no server module index', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
    expect(source).not.toMatch(/from '@\/modules\/applications'/);
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
