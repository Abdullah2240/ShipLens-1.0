// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import type { MemberListItem, TeamItem } from '../types';
import { MembersFilters, membersHref } from './MembersFilters';
import { MembersTable } from './MembersTable';

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

beforeEach(() => {
  vi.clearAllMocks();
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

describe('members component sources', () => {
  it.each(['MembersFilters.tsx', 'MembersTable.tsx'])('%s uses logical utilities only', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
  });

  it('keeps the filters free of client scripting', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, 'MembersFilters.tsx'), 'utf8');
    expect(source).not.toMatch(/^['"]use client['"]/m);
  });
});
