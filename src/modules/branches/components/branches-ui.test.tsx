// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { formatDate } from '@/platform/i18n/format';
import type { BranchDetail, BranchListItem, LeadCandidate } from '../types';
import { BranchCreateForm } from './BranchCreateForm';
import { BranchDetailsForm } from './BranchDetailsForm';
import { BranchLeadsPanel } from './BranchLeadsPanel';
import { BranchStatusControl } from './BranchStatusControl';
import { BranchesTable } from './BranchesTable';

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
const NAMESPACES = ['common', 'branches'];

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

/** Simple-argument interpolation; plural messages are not used through this helper. */
function msg(locale: Locale, key: string, values: Record<string, string> = {}): string {
  return lookup(locale, 'branches', key).replace(
    /\{(\w+)\}/g,
    (_, name: string) => values[name] ?? `{${name}}`,
  );
}

const statusLabel = (locale: Locale, status: string) =>
  lookup(locale, 'common', `status.${status}`);

const BRANCH_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';

function branchItem(overrides: Partial<BranchListItem> = {}): BranchListItem {
  return {
    id: BRANCH_A,
    code: 'BR001',
    name: 'Lahore Central',
    city: 'Lahore',
    status: 'active',
    leadCount: 2,
    createdAt: '2026-03-14T07:30:00.000Z',
    ...overrides,
  };
}

const BRANCHES: BranchListItem[] = [
  branchItem(),
  branchItem({
    id: BRANCH_B,
    code: 'BR1002',
    name: 'Hyderabad East',
    city: null,
    status: 'forming',
    leadCount: 0,
    createdAt: '2026-10-30T20:15:00.000Z',
  }),
];

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
    contentType: new Headers(init?.headers).get('content-type'),
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

describe.each(LOCALES)('BranchesTable (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);

  it('lists code, linked name, city, status, lead count and created date', () => {
    const { container } = renderWithIntl(<BranchesTable branches={BRANCHES} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');

    const table = screen.getByRole('table', { name: m('register.caption') });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(
      ['code', 'name', 'city', 'status', 'leads', 'created'].map((key) => m(`columns.${key}`)),
    );

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);

    const code = first.getByText('BR001');
    expect(code.tagName).toBe('BDI');
    expect(code).toHaveAttribute('dir', 'ltr');
    expect(code.className).toContain('font-mono');

    expect(first.getByRole('link', { name: 'Lahore Central' })).toHaveAttribute(
      'href',
      `/admin/branches/${BRANCH_A}`,
    );
    expect(first.getByText('Lahore')).toBeInTheDocument();
    expect(first.getByText(statusLabel(locale, 'active'))).toBeInTheDocument();
    expect(first.getByText('2')).toBeInTheDocument();

    const created = formatDate(new Date('2026-03-14T07:30:00.000Z'), locale);
    expect(created).toMatch(/2026/);
    expect(created).not.toMatch(/[٠-٩۰-۹]/);
    expect(first.getByText(created)).toHaveAttribute('datetime', '2026-03-14T07:30:00.000Z');

    const second = within(rows[1]!);
    expect(second.getByText('BR1002')).toHaveAttribute('dir', 'ltr');
    expect(second.getByText(statusLabel(locale, 'forming'))).toBeInTheDocument();
    expect(second.getByText(m('detail.notSet'))).toHaveClass('sr-only');
    // 01:15 PKT on 31 Oct, not the UTC calendar day.
    expect(second.getByText(formatDate('2026-10-31', locale))).toBeInTheDocument();
  });

  it('shows the empty state instead of a table', () => {
    renderWithIntl(<BranchesTable branches={[]} />, { locale, namespaces: NAMESPACES });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(m('register.empty'))).toBeInTheDocument();
    expect(screen.getByText(m('register.emptyBody'))).toBeInTheDocument();
  });
});

describe.each(LOCALES)('BranchCreateForm (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);
  const nameBox = () => screen.getByRole('textbox', { name: m('create.name') });
  const submit = () => screen.getByRole('button', { name: m('create.submit') });

  it('validates on the client before sending anything', async () => {
    const user = userEvent.setup();
    renderWithIntl(<BranchCreateForm />, { locale, namespaces: NAMESPACES });
    await user.type(nameBox(), ' A ');
    await user.click(submit());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(m('errors.too_short'))).toBeInTheDocument();
    expect(nameBox()).toHaveFocus();

    await user.type(nameBox(), 'bc');
    expect(nameBox()).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(m('errors.too_short'))).toBeNull();
  });

  it('posts trimmed JSON, shows the new code and refreshes', async () => {
    const user = userEvent.setup();
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    renderWithIntl(<BranchCreateForm />, { locale, namespaces: NAMESPACES });

    await user.type(nameBox(), '  Hyderabad East ');
    await user.type(screen.getByRole('textbox', { name: /city|شہر/i }), 'Hyderabad');
    await user.click(submit());

    const busy = screen.getByRole('button', { name: m('create.submitting') });
    expect(busy).toBeDisabled();
    expect(calls()).toEqual([
      {
        url: '/api/v1/branches',
        method: 'POST',
        contentType: 'application/json',
        body: { name: 'Hyderabad East', city: 'Hyderabad', summary: null },
      },
    ]);

    resolve(reply(201, { data: { ...branchItem({ code: 'BR007' }), status: 'forming' } }));
    const status = await screen.findByRole('status');
    await waitFor(() => expect(status.textContent).toContain('BR007'));
    expect(status.textContent?.replace(/[⁦-⁩]/g, '')).toBe(m('create.success', { code: 'BR007' }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(nameBox()).toHaveValue('');
    expect(submit()).toBeEnabled();
  });

  it('shows a duplicate name on the name field', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(409, { error: { code: 'duplicate_branch_name', message: 'Conflict' } }),
    );
    renderWithIntl(<BranchCreateForm />, { locale, namespaces: NAMESPACES });
    await user.type(nameBox(), 'Lahore Central');
    await user.click(submit());
    expect(await screen.findByText(m('errors.duplicate_branch_name'))).toBeInTheDocument();
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(nameBox().getAttribute('aria-describedby')).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('shows the generic message for other failures', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(500, { error: { code: 'internal' } }));
    renderWithIntl(<BranchCreateForm />, { locale, namespaces: NAMESPACES });
    await user.type(nameBox(), 'Quetta');
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(m('errors.generic'));

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(m('errors.generic'));
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

const USER_LEAD = '33333333-3333-4333-8333-333333333333';
const USER_OTHER = '55555555-5555-4555-8555-555555555555';
const USER_FREE = '66666666-6666-4666-8666-666666666666';

function branchDetail(overrides: Partial<BranchDetail> = {}): BranchDetail {
  return {
    ...branchItem(),
    summary: 'Weekly food drive in Gulberg.',
    updatedAt: '2026-10-01T05:00:00.000Z',
    leads: [
      {
        userId: USER_LEAD,
        name: 'Omar Siddiqui',
        email: 'lead@shiplens.test',
        role: 'branch_lead',
      },
    ],
    allowedTransitions: ['paused', 'closed'],
    openReportCount: 0,
    ...overrides,
  };
}

describe.each(LOCALES)('BranchDetailsForm (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);
  const save = () => screen.getByRole('button', { name: m('edit.save') });
  const summaryBox = () => screen.getByRole('textbox', { name: m('detail.summary') });
  const cityBox = () => screen.getByRole('textbox', { name: m('create.city') });

  it('is a read-only list without edit rights', () => {
    const { container } = renderWithIntl(
      <BranchDetailsForm branch={branchDetail()} canEdit={false} />,
      { locale, namespaces: NAMESPACES },
    );
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(screen.getByText(m('detail.readOnlyNotice'))).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('BR001').tagName).toBe('BDI');
    expect(screen.getByText(m('detail.codeHint'))).toBeInTheDocument();
    expect(screen.getByText('Weekly food drive in Gulberg.')).toBeInTheDocument();
    expect(screen.getByText(formatDate('2026-03-14', locale))).toBeInTheDocument();
  });

  it('shows the missing summary text when there is none', () => {
    renderWithIntl(<BranchDetailsForm branch={branchDetail({ summary: null })} canEdit={false} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByText(m('detail.noSummary'))).toBeInTheDocument();
  });

  it('sends only the changed fields and confirms the save', async () => {
    const user = userEvent.setup();
    const updated = branchDetail({ summary: 'Food drive and tutoring.', city: null });
    fetchMock.mockResolvedValueOnce(reply(200, { data: updated }));
    renderWithIntl(<BranchDetailsForm branch={branchDetail()} canEdit />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByText('BR001')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(m('detail.codeHint'))).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(screen.getByText(m('edit.noChanges'))).toBeInTheDocument();

    await user.clear(summaryBox());
    await user.type(summaryBox(), ' Food drive and tutoring. ');
    await user.clear(cityBox());
    expect(screen.getByText(m('edit.unsaved'))).toBeInTheDocument();
    expect(save()).toBeEnabled();
    await user.click(save());

    expect(calls()).toEqual([
      {
        url: `/api/v1/branches/${BRANCH_A}`,
        method: 'PATCH',
        contentType: 'application/json',
        body: { city: null, summary: 'Food drive and tutoring.' },
      },
    ]);
    expect(await screen.findByText(m('edit.saved'))).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(summaryBox()).toHaveValue('Food drive and tutoring.');
    expect(save()).toBeDisabled();
  });

  it('checks the name before sending', async () => {
    const user = userEvent.setup();
    renderWithIntl(<BranchDetailsForm branch={branchDetail()} canEdit />, {
      locale,
      namespaces: NAMESPACES,
    });
    const nameBox = screen.getByRole('textbox', { name: m('create.name') });
    await user.clear(nameBox);
    await user.type(nameBox, 'X');
    await user.click(save());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nameBox).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(m('errors.too_short'))).toBeInTheDocument();
  });

  it('explains a refusal because the branch closed meanwhile', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(409, { error: { code: 'branch_closed', message: 'Conflict' } }),
    );
    renderWithIntl(<BranchDetailsForm branch={branchDetail()} canEdit />, {
      locale,
      namespaces: NAMESPACES,
    });
    await user.type(summaryBox(), ' More.');
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(m('errors.branch_closed'));
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows a duplicate name on the name field', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(409, { error: { code: 'duplicate_branch_name', message: 'Conflict' } }),
    );
    renderWithIntl(<BranchDetailsForm branch={branchDetail()} canEdit />, {
      locale,
      namespaces: NAMESPACES,
    });
    const nameBox = screen.getByRole('textbox', { name: m('create.name') });
    await user.type(nameBox, ' Two');
    await user.click(save());
    expect(await screen.findByText(m('errors.duplicate_branch_name'))).toBeInTheDocument();
    expect(nameBox).toHaveAttribute('aria-invalid', 'true');
  });

  it('offers no inputs on a closed branch', () => {
    renderWithIntl(
      <BranchDetailsForm
        branch={branchDetail({ status: 'closed', allowedTransitions: [] })}
        canEdit
      />,
      { locale, namespaces: NAMESPACES },
    );
    expect(screen.getByText(m('detail.closedNotice'))).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe.each(LOCALES)('BranchStatusControl (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);
  const moveTo = (status: string) => m('status.moveTo', { status: statusLabel(locale, status) });

  it('marks the current step and offers only the allowed moves', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(200, {
        data: branchDetail({ status: 'active', allowedTransitions: ['paused', 'closed'] }),
      }),
    );
    renderWithIntl(
      <BranchStatusControl
        branchId={BRANCH_A}
        status="forming"
        allowedTransitions={['active', 'closed']}
        canTransition
        name="Lahore Central"
      />,
      { locale, namespaces: NAMESPACES },
    );
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((li) => li.textContent)).toEqual(
      ['forming', 'active', 'paused', 'closed'].map((s) => statusLabel(locale, s)),
    );
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps.filter((li) => li.hasAttribute('aria-current'))).toHaveLength(1);
    expect(screen.getByText(m('statusHelp.forming'))).toBeInTheDocument();

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      moveTo('active'),
      moveTo('closed'),
    ]);

    // Activating needs no confirmation.
    await user.click(screen.getByRole('button', { name: moveTo('active') }));
    expect(calls()).toEqual([
      {
        url: `/api/v1/branches/${BRANCH_A}/status`,
        method: 'POST',
        contentType: 'application/json',
        body: { to: 'active' },
      },
    ]);
    expect(
      await screen.findByText(m('status.moved', { status: statusLabel(locale, 'active') })),
    ).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: moveTo('paused') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: moveTo('active') })).toBeNull();
  });

  it('asks before closing, with a destructive confirmation', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(200, { data: branchDetail({ status: 'closed', allowedTransitions: [] }) }),
    );
    renderWithIntl(
      <BranchStatusControl
        branchId={BRANCH_A}
        status="active"
        allowedTransitions={['paused', 'closed']}
        canTransition
        name="Lahore Central"
      />,
      { locale, namespaces: NAMESPACES },
    );
    await user.click(screen.getByRole('button', { name: moveTo('closed') }));
    const dialog = screen.getByRole('dialog', { name: m('status.confirmCloseTitle') });
    expect(dialog).toHaveTextContent(m('status.confirmCloseBody', { name: 'Lahore Central' }));
    await user.click(
      within(dialog).getByRole('button', { name: lookup(locale, 'common', 'actions.cancel') }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: moveTo('closed') }));
    const again = screen.getByRole('dialog', { name: m('status.confirmCloseTitle') });
    const confirm = within(again).getByRole('button', { name: m('status.confirmCloseAction') });
    expect(confirm.className).toContain('bg-danger');
    await user.click(confirm);
    expect(calls().map((c) => c.body)).toEqual([{ to: 'closed' }]);
    expect(await screen.findByText(m('status.noMoves'))).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[3]).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button', { name: moveTo('paused') })).toBeNull();
  });

  it('asks before pausing', async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <BranchStatusControl
        branchId={BRANCH_A}
        status="active"
        allowedTransitions={['paused', 'closed']}
        canTransition
        name="Lahore Central"
      />,
      { locale, namespaces: NAMESPACES },
    );
    await user.click(screen.getByRole('button', { name: moveTo('paused') }));
    const dialog = screen.getByRole('dialog', { name: m('status.confirmPauseTitle') });
    expect(dialog).toHaveTextContent(m('status.confirmPauseBody', { name: 'Lahore Central' }));
    expect(
      within(dialog).getByRole('button', { name: m('status.confirmPauseAction') }).className,
    ).not.toContain('bg-danger');
  });

  it.each(['branch_has_open_reports', 'invalid_transition'])(
    'shows a refused move (%s) in an alert',
    async (code) => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(reply(409, { error: { code, message: 'Conflict' } }));
      renderWithIntl(
        <BranchStatusControl
          branchId={BRANCH_A}
          status="forming"
          allowedTransitions={['active', 'closed']}
          canTransition
          name="Lahore Central"
        />,
        { locale, namespaces: NAMESPACES },
      );
      await user.click(screen.getByRole('button', { name: moveTo('active') }));
      expect(await screen.findByRole('alert')).toHaveTextContent(m(`errors.${code}`));
      expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step');
      expect(router.refresh).toHaveBeenCalledTimes(code === 'invalid_transition' ? 1 : 0);
    },
  );

  it('renders no move buttons without the right or on a closed branch', () => {
    const { unmount } = renderWithIntl(
      <BranchStatusControl
        branchId={BRANCH_A}
        status="active"
        allowedTransitions={['paused', 'closed']}
        canTransition={false}
        name="Lahore Central"
      />,
      { locale, namespaces: NAMESPACES },
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step');
    unmount();

    renderWithIntl(
      <BranchStatusControl
        branchId={BRANCH_A}
        status="closed"
        allowedTransitions={[]}
        canTransition
        name="Lahore Central"
      />,
      { locale, namespaces: NAMESPACES },
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(m('status.noMoves'))).toBeInTheDocument();
  });
});

const CANDIDATES: LeadCandidate[] = [
  {
    userId: USER_LEAD,
    name: 'Omar Siddiqui',
    email: 'lead@shiplens.test',
    role: 'branch_lead',
    branchId: BRANCH_A,
    branchName: 'Lahore Central',
  },
  {
    userId: USER_OTHER,
    name: 'Zara Iqbal',
    email: 'lead.karachi@shiplens.test',
    role: 'branch_lead',
    branchId: BRANCH_B,
    branchName: 'Hyderabad East',
  },
  {
    userId: USER_FREE,
    name: 'Hira Raza',
    email: 'hr@shiplens.test',
    role: 'hr_lead',
    branchId: null,
    branchName: null,
  },
];

describe.each(LOCALES)('BranchLeadsPanel (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);
  const leads = branchDetail().leads;

  it('lists leads by role with emails kept left to right', () => {
    renderWithIntl(
      <BranchLeadsPanel branchId={BRANCH_A} leads={leads} canAssign={false} closed={false} />,
      { locale, namespaces: NAMESPACES },
    );
    const branchLeads = screen.getByRole('list', { name: m('leads.branchLead') });
    expect(within(branchLeads).getByText('Omar Siddiqui')).toBeInTheDocument();
    expect(within(branchLeads).getByText('lead@shiplens.test')).toHaveAttribute('dir', 'ltr');
    expect(screen.queryByRole('list', { name: m('leads.hrLead') })).toBeNull();
    expect(screen.getByText(m('leads.none'))).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('assigns a candidate grouped by role, with the move warning', async () => {
    const user = userEvent.setup();
    const after = [
      ...leads,
      { userId: USER_FREE, name: 'Hira Raza', email: 'hr@shiplens.test', role: 'hr_lead' as const },
    ];
    fetchMock.mockResolvedValueOnce(reply(200, { data: branchDetail({ leads: after }) }));
    renderWithIntl(
      <BranchLeadsPanel
        branchId={BRANCH_A}
        leads={leads}
        candidates={CANDIDATES}
        canAssign
        closed={false}
      />,
      { locale, namespaces: NAMESPACES },
    );
    const select = screen.getByRole('combobox', { name: m('leads.candidate') });
    const groups = select.querySelectorAll('optgroup');
    expect([...groups].map((g) => g.label)).toEqual([m('leads.branchLead'), m('leads.hrLead')]);
    // People already leading this branch are not offered again.
    expect(select.textContent).not.toContain('Omar Siddiqui');
    const other = within(select).getByRole('option', { name: /Zara Iqbal/ });
    expect(other.textContent).toContain(
      m('leads.candidateCurrentBranch', { branch: 'Hyderabad East' }),
    );
    expect(within(select).getByRole('option', { name: /Hira Raza/ }).textContent).toContain(
      m('leads.candidateNoBranch'),
    );
    expect(screen.getByText(m('leads.moveWarning'))).toBeInTheDocument();

    const assign = screen.getByRole('button', { name: m('leads.assign') });
    expect(assign).toBeDisabled();
    await user.selectOptions(select, USER_FREE);
    await user.click(assign);
    expect(calls()).toEqual([
      {
        url: `/api/v1/branches/${BRANCH_A}/leads`,
        method: 'POST',
        contentType: 'application/json',
        body: { userId: USER_FREE },
      },
    ]);
    expect(await screen.findByText(m('leads.assigned'))).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    const hrLeads = screen.getByRole('list', { name: m('leads.hrLead') });
    expect(within(hrLeads).getByText('hr@shiplens.test')).toHaveAttribute('dir', 'ltr');
  });

  it('explains an ineligible person', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(422, {
        error: {
          code: 'validation_failed',
          message: 'Invalid',
          details: { fields: [{ path: 'userId', code: 'invalid_user' }] },
        },
      }),
    );
    renderWithIntl(
      <BranchLeadsPanel
        branchId={BRANCH_A}
        leads={leads}
        candidates={CANDIDATES}
        canAssign
        closed={false}
      />,
      { locale, namespaces: NAMESPACES },
    );
    await user.selectOptions(screen.getByRole('combobox'), USER_OTHER);
    await user.click(screen.getByRole('button', { name: m('leads.assign') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(m('errors.invalid_user'));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('offers no assignment on a closed branch or without candidates', () => {
    const { unmount } = renderWithIntl(
      <BranchLeadsPanel
        branchId={BRANCH_A}
        leads={leads}
        candidates={CANDIDATES}
        canAssign
        closed
      />,
      { locale, namespaces: NAMESPACES },
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    unmount();
    renderWithIntl(
      <BranchLeadsPanel branchId={BRANCH_A} leads={leads} canAssign closed={false} />,
      { locale, namespaces: NAMESPACES },
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

const COMPONENT_FILES = [
  'BranchesTable.tsx',
  'BranchCreateForm.tsx',
  'BranchDetailsForm.tsx',
  'BranchStatusControl.tsx',
  'BranchLeadsPanel.tsx',
  'form-kit.tsx',
];

describe('branch component sources', () => {
  it.each(COMPONENT_FILES)('%s uses logical utilities only', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
  });

  it.each(COMPONENT_FILES)('%s never imports the server index', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(source).not.toMatch(/from '@\/modules\/branches'/);
  });
});
