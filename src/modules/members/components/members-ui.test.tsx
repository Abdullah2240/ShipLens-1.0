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
import type { MemberListItem, TeamItem } from '../types';
import { MemberEditForm } from './MemberEditForm';
import { MembersFilters, membersHref } from './MembersFilters';
import { MembersTable } from './MembersTable';
import { TeamsPanel } from './TeamsPanel';

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
const NAMESPACES = ['common', 'members'];

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
  return lookup(locale, 'members', key).replace(
    /\{(\w+)\}/g,
    (_, name: string) => values[name] ?? `{${name}}`,
  );
}

const BRANCH_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';
const TEAM_FOOD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM_TEACH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM_OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function member(overrides: Partial<MemberListItem> = {}): MemberListItem {
  return {
    id: '0b6f3c5e-6a43-4e7d-9a52-6f1f0a1d2e01',
    memberCode: 'M00042',
    fullName: 'Ayesha Khan',
    email: 'ayesha@example.test',
    phone: '+92 300 1234567',
    teamId: TEAM_FOOD,
    teamName: 'Food drive',
    memberRole: 'team_lead',
    status: 'active',
    branchId: BRANCH_A,
    branchName: 'Lahore',
    joinedOn: '2026-03-14',
    ...overrides,
  };
}

const MEMBERS: MemberListItem[] = [
  member(),
  member({
    id: '0b6f3c5e-6a43-4e7d-9a52-6f1f0a1d2e02',
    memberCode: 'M00043',
    fullName: 'Bilal Ahmed',
    email: null,
    phone: '0321 7654321',
    teamId: null,
    teamName: null,
    memberRole: 'volunteer',
    status: 'left',
  }),
];

const TEAMS: TeamItem[] = [
  { id: TEAM_FOOD, name: 'Food drive', branchId: BRANCH_A, branchName: 'Lahore', memberCount: 12 },
  { id: TEAM_TEACH, name: 'Teaching', branchId: BRANCH_A, branchName: 'Lahore', memberCount: 0 },
];

const MIXED_TEAMS: TeamItem[] = [
  ...TEAMS,
  { id: TEAM_OTHER, name: 'Clinic', branchId: BRANCH_B, branchName: 'Karachi', memberCount: 3 },
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

describe('membersHref', () => {
  it('builds the list URL from the active filters and the page', () => {
    expect(membersHref({})).toBe('/people/members');
    expect(membersHref({ q: 'ali khan', role: 'mentor' }, 3)).toBe(
      '/people/members?q=ali+khan&role=mentor&page=3',
    );
    expect(membersHref({ teamId: TEAM_FOOD, status: 'active', pageSize: 50 }, 1)).toBe(
      `/people/members?teamId=${TEAM_FOOD}&status=active&pageSize=50`,
    );
    expect(membersHref({ q: 'x', pageSize: 25 }, 2)).toBe('/people/members?q=x&page=2');
  });
});

describe.each(LOCALES)('MembersFilters (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);

  it('is a plain GET form with translated labels and preserved values', () => {
    const { container } = renderWithIntl(
      <MembersFilters
        values={{ q: 'ayesha', teamId: TEAM_TEACH, role: 'mentor', status: 'inactive' }}
        teams={TEAMS}
        total={2}
      />,
      { locale, namespaces: NAMESPACES },
    );
    expect(container).toHaveAttribute('lang', locale);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute('method', 'get');
    expect(form?.querySelector('[name="page"]')).toBeNull();

    const search = screen.getByRole('searchbox', { name: m('list.searchLabel') });
    expect(search).toHaveAttribute('name', 'q');
    expect(search).toHaveValue('ayesha');
    expect(search).toHaveAttribute('placeholder', m('list.searchPlaceholder'));

    const team = screen.getByRole('combobox', { name: m('list.filterTeam') });
    expect(team).toHaveAttribute('name', 'teamId');
    expect(team).toHaveValue(TEAM_TEACH);
    expect(
      within(team)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([m('list.allTeams'), 'Food drive', 'Teaching']);
    expect(within(team).getByRole('option', { name: m('list.allTeams') })).toHaveValue('');

    const role = screen.getByRole('combobox', { name: m('list.filterRole') });
    expect(role).toHaveAttribute('name', 'role');
    expect(role).toHaveValue('mentor');
    expect(
      within(role)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      m('list.allRoles'),
      m('roles.volunteer'),
      m('roles.team_lead'),
      m('roles.coordinator'),
      m('roles.mentor'),
    ]);

    const status = screen.getByRole('combobox', { name: m('list.filterStatus') });
    expect(status).toHaveAttribute('name', 'status');
    expect(status).toHaveValue('inactive');
    expect(
      within(status)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      m('list.allStatuses'),
      lookup(locale, 'common', 'status.active'),
      lookup(locale, 'common', 'status.inactive'),
      lookup(locale, 'common', 'status.left'),
    ]);

    expect(screen.getByRole('button', { name: m('list.apply') })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('link', { name: m('list.clear') })).toHaveAttribute(
      'href',
      '/people/members',
    );
  });

  it('defaults every filter to "all" and hides the clear link when nothing is filtered', () => {
    renderWithIntl(<MembersFilters values={{}} teams={TEAMS} total={1} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByRole('searchbox', { name: m('list.searchLabel') })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: m('list.filterTeam') })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: m('list.filterRole') })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: m('list.filterStatus') })).toHaveValue('');
    expect(screen.queryByRole('link', { name: m('list.clear') })).toBeNull();
  });

  it('shows the translated result count', () => {
    renderWithIntl(<MembersFilters values={{}} teams={TEAMS} total={1234} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByRole('status')).toHaveTextContent('1,234');
  });

  it('groups team options by branch when teams span several branches', () => {
    renderWithIntl(<MembersFilters values={{}} teams={MIXED_TEAMS} total={3} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const team = screen.getByRole('combobox', { name: m('list.filterTeam') });
    const groups = team.querySelectorAll('optgroup');
    expect([...groups].map((g) => g.getAttribute('label'))).toEqual(['Karachi', 'Lahore']);
    expect(within(groups[0] as HTMLElement).getByRole('option', { name: 'Clinic' })).toHaveValue(
      TEAM_OTHER,
    );
  });
});

describe.each(LOCALES)('MembersTable (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);

  it('renders the member columns with translated headers', () => {
    const { container } = renderWithIntl(<MembersTable members={MEMBERS} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    const table = screen.getByRole('table', { name: m('list.caption') });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      m('columns.code'),
      m('columns.name'),
      m('columns.team'),
      m('columns.role'),
      m('columns.status'),
      m('columns.contact'),
    ]);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('isolates member codes, emails and phones left-to-right', () => {
    renderWithIntl(<MembersTable members={MEMBERS} />, { locale, namespaces: NAMESPACES });
    for (const text of ['M00042', 'M00043', 'ayesha@example.test', '+92 300 1234567']) {
      const node = screen.getByText(text);
      const isolated = node.tagName === 'BDI' || node.closest('[dir="ltr"]') !== null;
      expect(isolated, text).toBe(true);
    }
    expect(screen.getByText('ayesha@example.test')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('0321 7654321')).toHaveAttribute('dir', 'ltr');
  });

  it('links each name to the member page', () => {
    renderWithIntl(<MembersTable members={MEMBERS} />, { locale, namespaces: NAMESPACES });
    expect(screen.getByRole('link', { name: 'Ayesha Khan' })).toHaveAttribute(
      'href',
      `/people/members/${MEMBERS[0]?.id}`,
    );
    expect(screen.getByRole('link', { name: 'Bilal Ahmed' })).toHaveAttribute(
      'href',
      `/people/members/${MEMBERS[1]?.id}`,
    );
  });

  it('shows translated roles, statuses and the unassigned team', () => {
    renderWithIntl(<MembersTable members={MEMBERS} />, { locale, namespaces: NAMESPACES });
    const rows = screen.getAllByRole('row').slice(1);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText(m('roles.team_lead'))).toBeInTheDocument();
    expect(first.getByText('Food drive')).toBeInTheDocument();
    expect(first.getByText(lookup(locale, 'common', 'status.active'))).toHaveAttribute(
      'data-tone',
      'success',
    );
    const second = within(rows[1] as HTMLElement);
    expect(second.getByText(m('roles.volunteer'))).toBeInTheDocument();
    expect(second.getByText(m('detail.unassigned'))).toBeInTheDocument();
    expect(second.getByText(lookup(locale, 'common', 'status.left'))).toBeInTheDocument();
  });

  it('adds a branch column for the head office view', () => {
    renderWithIntl(<MembersTable members={MEMBERS} showBranch />, {
      locale,
      namespaces: NAMESPACES,
    });
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain(m('columns.branch'));
    expect(screen.getAllByText('Lahore')).toHaveLength(2);
  });

  it('renders an empty state when nothing matches', () => {
    renderWithIntl(<MembersTable members={[]} />, { locale, namespaces: NAMESPACES });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(m('list.emptyTitle'));
    expect(screen.getByText(m('list.emptyBody'))).toBeInTheDocument();
  });
});

const SAME_BRANCH_TEAMS = TEAMS.map(({ id, name }) => ({ id, name }));
const MEMBER = member();
const MEMBER_URL = `/api/v1/members/${MEMBER.id}`;

describe.each(LOCALES)('MemberEditForm (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);
  const status = (key: string) => lookup(locale, 'common', `status.${key}`);
  const render = (props: Partial<Parameters<typeof MemberEditForm>[0]> = {}) =>
    renderWithIntl(
      <MemberEditForm member={MEMBER} teams={SAME_BRANCH_TEAMS} canEdit {...props} />,
      { locale, namespaces: NAMESPACES },
    );

  it('shows the profile with contact details isolated left-to-right', () => {
    const { container } = render();
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(screen.getByRole('heading', { level: 1, name: 'Ayesha Khan' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: m('detail.back') })).toHaveAttribute(
      'href',
      '/people/members',
    );
    expect(screen.getByText('ayesha@example.test')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('+92 300 1234567')).toHaveAttribute('dir', 'ltr');
    for (const code of screen.getAllByText('M00042')) {
      expect(code.tagName === 'BDI' || code.closest('[dir="ltr"]') !== null).toBe(true);
    }
    expect(screen.getByText(formatDate('2026-03-14', locale))).toBeInTheDocument();
    expect(screen.getByText(m('detail.email'))).toBeInTheDocument();
    expect(screen.getByText(m('detail.phone'))).toBeInTheDocument();
  });

  it('marks missing contact details as not provided', () => {
    render({ member: member({ email: null, phone: null, joinedOn: null }) });
    expect(screen.getAllByText(m('detail.notProvided')).length).toBeGreaterThanOrEqual(2);
  });

  it('renders read-only values and the notice without a form when editing is not allowed', () => {
    const { container } = render({ canEdit: false });
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: m('edit.save') })).toBeNull();
    expect(screen.getByText(m('detail.readOnlyNotice'))).toBeInTheDocument();
    // The header also names the team (in its own isolate), so look inside the team fact.
    const teamFact = screen.getByText(m('edit.team')).closest('div')!;
    expect(within(teamFact).getByText('Food drive')).toBeInTheDocument();
    expect(screen.getByText(m('roles.team_lead'))).toBeInTheDocument();
    expect(screen.getAllByText(status('active')).length).toBeGreaterThanOrEqual(1);
  });

  it('offers only the given teams plus unassigned, every role and every status', () => {
    render();
    const team = screen.getByRole('combobox', { name: m('edit.team') });
    expect(team).toHaveValue(TEAM_FOOD);
    expect(
      within(team)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([m('detail.unassigned'), 'Food drive', 'Teaching']);
    const role = screen.getByRole('combobox', { name: m('edit.role') });
    expect(role).toHaveValue('team_lead');
    expect(within(role).getAllByRole('option')).toHaveLength(4);
    const statusSelect = screen.getByRole('combobox', { name: m('edit.status') });
    expect(statusSelect).toHaveValue('active');
    expect(
      within(statusSelect)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([status('active'), status('inactive'), status('left')]);
  });

  it('keeps Save disabled until something changes, then sends only the changed fields', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(200, { data: { ...MEMBER, memberRole: 'mentor', teamId: null, teamName: null } }),
    );
    render();
    const save = screen.getByRole('button', { name: m('edit.save') });
    expect(save).toBeDisabled();

    await user.selectOptions(screen.getByRole('combobox', { name: m('edit.role') }), 'mentor');
    await user.selectOptions(screen.getByRole('combobox', { name: m('edit.team') }), '');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(screen.getByText(m('edit.saved'))).toBeInTheDocument());
    expect(calls()).toEqual([
      {
        url: MEMBER_URL,
        method: 'PATCH',
        contentType: 'application/json',
        body: { teamId: null, memberRole: 'mentor' },
      },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: m('edit.save') })).toBeDisabled();
  });

  it('shows the team message when the server rejects the team', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(422, {
        error: {
          code: 'validation_failed',
          details: { fields: [{ path: 'teamId', code: 'invalid_team', message: 'invalid_team' }] },
        },
      }),
    );
    render();
    await user.selectOptions(screen.getByRole('combobox', { name: m('edit.team') }), TEAM_TEACH);
    await user.click(screen.getByRole('button', { name: m('edit.save') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(m('edit.teamInvalid'));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('shows the generic error for any other failure', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(500, { error: { code: 'internal' } }));
    render();
    await user.selectOptions(screen.getByRole('combobox', { name: m('edit.status') }), 'inactive');
    await user.click(screen.getByRole('button', { name: m('edit.save') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(m('edit.error'));
    expect(calls()[0]?.body).toEqual({ status: 'inactive' });
  });

  it('asks for confirmation before marking a member as left', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(200, { data: { ...MEMBER, status: 'left' } }));
    render();
    await user.selectOptions(screen.getByRole('combobox', { name: m('edit.status') }), 'left');
    await user.click(screen.getByRole('button', { name: m('edit.save') }));

    const dialog = screen.getByRole('dialog', { name: m('edit.leftTitle') });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveTextContent(m('edit.leftBody', { name: 'Ayesha Khan' }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: m('edit.leftConfirm') }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([
      {
        url: MEMBER_URL,
        method: 'PATCH',
        contentType: 'application/json',
        body: { status: 'left' },
      },
    ]);
  });

  it('sends nothing when the left confirmation is cancelled', async () => {
    const user = userEvent.setup();
    render();
    await user.selectOptions(screen.getByRole('combobox', { name: m('edit.status') }), 'left');
    await user.click(screen.getByRole('button', { name: m('edit.save') }));
    const dialog = screen.getByRole('dialog', { name: m('edit.leftTitle') });
    await user.click(
      within(dialog).getByRole('button', { name: lookup(locale, 'common', 'actions.cancel') }),
    );
    expect(dialog).not.toHaveAttribute('open');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const BRANCH_OPTIONS = [
  { id: BRANCH_B, name: 'Karachi' },
  { id: BRANCH_A, name: 'Lahore' },
];

describe.each(LOCALES)('TeamsPanel (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => msg(locale, key, values);
  const renameInput = () =>
    screen.queryByRole('textbox', { name: m('teams.renameLabel', { name: 'Teaching' }) });

  it('lists teams with member counts and no controls for read-only roles', () => {
    const { container } = renderWithIntl(<TeamsPanel teams={TEAMS} canManage={false} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    const table = screen.getByRole('table', { name: m('teams.caption') });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([m('teams.name'), m('teams.members')]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByText('Food drive')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('12')).toBeInTheDocument();
    expect(screen.getByText(m('teams.readOnlyNotice'))).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('creates a team in the actor branch and refreshes', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(201, { data: { id: TEAM_OTHER, name: 'Clinic' } }));
    renderWithIntl(<TeamsPanel teams={TEAMS} canManage />, { locale, namespaces: NAMESPACES });
    expect(screen.queryByText(m('teams.readOnlyNotice'))).toBeNull();
    expect(screen.queryByRole('combobox', { name: m('teams.branchLabel') })).toBeNull();

    const name = screen.getByRole('textbox', { name: m('teams.nameLabel') });
    expect(name).toHaveAttribute('placeholder', m('teams.createPlaceholder'));
    await user.type(name, '  Clinic ');
    await user.click(screen.getByRole('button', { name: m('teams.create') }));

    await waitFor(() => expect(screen.getByText(m('teams.created'))).toBeInTheDocument());
    expect(calls()).toEqual([
      {
        url: '/api/v1/teams',
        method: 'POST',
        contentType: 'application/json',
        body: { name: 'Clinic' },
      },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(name).toHaveValue('');
  });

  it('asks Super Admin for a branch and shows the branch column', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(201, { data: { id: TEAM_OTHER } }));
    renderWithIntl(<TeamsPanel teams={MIXED_TEAMS} canManage branches={BRANCH_OPTIONS} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain(
      m('teams.branch'),
    );
    const branch = screen.getByRole('combobox', { name: m('teams.branchLabel') });
    expect(branch).toBeRequired();
    expect(
      within(branch)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([m('teams.chooseBranch'), 'Karachi', 'Lahore']);
    await user.type(screen.getByRole('textbox', { name: m('teams.nameLabel') }), 'Clinic');
    await user.selectOptions(branch, BRANCH_B);
    await user.click(screen.getByRole('button', { name: m('teams.create') }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(calls()[0]?.body).toEqual({ name: 'Clinic', branchId: BRANCH_B });
  });

  it('shows the duplicate message on 409', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(409, { error: { code: 'duplicate_team' } }));
    renderWithIntl(<TeamsPanel teams={TEAMS} canManage />, { locale, namespaces: NAMESPACES });
    await user.type(screen.getByRole('textbox', { name: m('teams.nameLabel') }), 'Teaching');
    await user.click(screen.getByRole('button', { name: m('teams.create') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(m('teams.duplicate'));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('checks the name length before sending', async () => {
    const user = userEvent.setup();
    renderWithIntl(<TeamsPanel teams={TEAMS} canManage />, { locale, namespaces: NAMESPACES });
    await user.type(screen.getByRole('textbox', { name: m('teams.nameLabel') }), ' x ');
    await user.click(screen.getByRole('button', { name: m('teams.create') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(m('teams.nameInvalid'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renames a team inline', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(200, { data: { id: TEAM_TEACH, name: 'Tutoring' } }));
    renderWithIntl(<TeamsPanel teams={TEAMS} canManage />, { locale, namespaces: NAMESPACES });
    await user.click(
      screen.getByRole('button', { name: m('teams.renameAction', { name: 'Teaching' }) }),
    );
    const input = renameInput();
    expect(input).toHaveValue('Teaching');
    await user.clear(input as HTMLElement);
    await user.type(input as HTMLElement, 'Tutoring');
    await user.click(screen.getByRole('button', { name: m('teams.save') }));

    await waitFor(() => expect(screen.getByText(m('teams.renamed'))).toBeInTheDocument());
    expect(calls()).toEqual([
      {
        url: `/api/v1/teams/${TEAM_TEACH}`,
        method: 'PATCH',
        contentType: 'application/json',
        body: { name: 'Tutoring' },
      },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(renameInput()).toBeNull();
  });

  it('keeps the rename open on 409 and cancel restores the row', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(409, { error: { code: 'duplicate_team' } }));
    renderWithIntl(<TeamsPanel teams={TEAMS} canManage />, { locale, namespaces: NAMESPACES });
    await user.click(
      screen.getByRole('button', { name: m('teams.renameAction', { name: 'Teaching' }) }),
    );
    const input = renameInput() as HTMLElement;
    await user.clear(input);
    await user.type(input, 'Food drive');
    await user.click(screen.getByRole('button', { name: m('teams.save') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(m('teams.duplicate'));
    expect(input).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: m('teams.cancel') }));
    expect(renameInput()).toBeNull();
    expect(screen.getByText('Teaching')).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('shows the empty state and keeps the create form for managers', () => {
    renderWithIntl(<TeamsPanel teams={[]} canManage />, { locale, namespaces: NAMESPACES });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(m('teams.empty'))).toBeInTheDocument();
    expect(screen.getByText(m('teams.emptyBody'))).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: m('teams.nameLabel') })).toBeInTheDocument();
  });

  it('shows the read-only empty state without controls', () => {
    renderWithIntl(<TeamsPanel teams={[]} canManage={false} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByText(m('teams.empty'))).toBeInTheDocument();
    expect(screen.getByText(m('teams.emptyReadOnly'))).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('members component sources', () => {
  it.each(['MembersFilters.tsx', 'MembersTable.tsx', 'MemberEditForm.tsx', 'TeamsPanel.tsx'])(
    '%s uses logical utilities only',
    (file) => {
      const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
      expect(findPhysicalDirection(source, file)).toEqual([]);
    },
  );

  it('keeps the filters free of client scripting', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, 'MembersFilters.tsx'), 'utf8');
    expect(source).not.toMatch(/^['"]use client['"]/m);
  });
});
