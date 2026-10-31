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
import type { BranchListItem } from '../types';
import { BranchCreateForm } from './BranchCreateForm';
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

describe('branch component sources', () => {
  it.each(['BranchesTable.tsx', 'BranchCreateForm.tsx', 'form-kit.tsx'])(
    '%s uses logical utilities only',
    (file) => {
      const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
      expect(findPhysicalDirection(source, file)).toEqual([]);
    },
  );

  it('client components never import the server index', () => {
    for (const file of ['BranchCreateForm.tsx', 'form-kit.tsx', 'BranchesTable.tsx']) {
      const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
      expect(source).not.toMatch(/from '@\/modules\/branches'/);
    }
  });
});
