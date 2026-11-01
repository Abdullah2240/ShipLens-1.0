// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { formatDate, formatMoney } from '@/platform/i18n/format';
import type { CollectionEditability } from '../lock';
import type { CollectionItem, CurrentWeek } from '../types';
import { CollectionFiltersForm } from './CollectionFiltersForm';
import { CollectionForm } from './CollectionForm';
import { CollectionsTable } from './CollectionsTable';
import { CurrentWeekCard } from './CurrentWeekCard';
import { LockBadge } from './LockBadge';
import { VoidCollectionDialog } from './VoidCollectionDialog';

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
const NAMESPACES = ['common', 'collections'];
const MESSAGES = path.resolve(import.meta.dirname, '../../../../messages');

function messages(locale: Locale, ns: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(MESSAGES, locale, `${ns}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

// Messages are read from disk at run time, so keys are plain strings here.
function translator(locale: Locale): Translate {
  return createTranslator({
    locale,
    messages: { collections: messages(locale, 'collections') },
    namespace: 'collections',
  }) as unknown as Translate;
}

function statusLabel(locale: Locale, status: string): string {
  return (messages(locale, 'common').status as Record<string, string>)[status] ?? status;
}

const COMPONENT_FILES = [
  'LockBadge.tsx',
  'CurrentWeekCard.tsx',
  'CollectionsTable.tsx',
  'CollectionForm.tsx',
  'VoidCollectionDialog.tsx',
  'CollectionFiltersForm.tsx',
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

describe('collection components source', () => {
  it.each(COMPONENT_FILES)('%s uses logical direction utilities only', (file) => {
    const source = readFileSync(path.join(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source)).toEqual([]);
  });
});

describe.each(LOCALES)('LockBadge (%s)', (locale) => {
  const t = translator(locale);
  const render = (editability: CollectionEditability, daysLeft = 0) =>
    renderWithIntl(
      <LockBadge editability={editability} daysLeft={daysLeft} lastEditableOn="2026-10-12" />,
      { locale, namespaces: NAMESPACES },
    );
  const badge = (container: HTMLElement) =>
    container.querySelector('[data-lock-state]') as HTMLElement;

  it('counts down the days left with the plural form', () => {
    const { container } = render('editable', 3);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(badge(container)).toHaveTextContent(t('lock.locksIn', { days: 3 }));
    expect(badge(container).textContent).toContain('3');
    if (locale === 'en') expect(badge(container)).toHaveTextContent('Locks in 3 days');
  });

  it('uses the singular for one day', () => {
    const { container } = render('editable', 1);
    expect(badge(container)).toHaveTextContent(t('lock.locksIn', { days: 1 }));
    if (locale === 'en') expect(badge(container)).toHaveTextContent('Locks in 1 day');
  });

  it('says it locks tonight on the last day', () => {
    const { container } = render('editable', 0);
    expect(badge(container)).toHaveTextContent(t('lock.locksTonight'));
    expect(badge(container)).toHaveAttribute('data-tone', 'warning');
  });

  it('shows locked with the date it locked', () => {
    const { container } = render('locked');
    expect(badge(container)).toHaveTextContent(t('lock.locked'));
    expect(badge(container)).toHaveTextContent(
      t('lock.lockedOn', { date: formatDate('2026-10-13', locale) }),
    );
  });

  it.each<[CollectionEditability, string]>([
    ['report_submitted', 'lock.reportSubmitted'],
    ['report_approved', 'lock.reportApproved'],
    ['voided', 'lock.voided'],
    ['editable_exempt', 'lock.exempt'],
    ['branch_closed', 'lock.branchClosed'],
  ])('labels %s', (editability, key) => {
    const { container } = render(editability);
    expect(badge(container)).toHaveTextContent(t(key));
    expect(badge(container)).toHaveAttribute('data-lock-state', editability);
  });

  it.each<CollectionEditability>([
    'editable',
    'editable_exempt',
    'locked',
    'report_submitted',
    'report_approved',
    'voided',
    'branch_closed',
  ])('pairs an aria-hidden icon with text and a last-editable title for %s', (editability) => {
    const { container } = render(editability, 4);
    const el = badge(container);
    const icon = el.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(el.textContent?.trim().length).toBeGreaterThan(0);
    expect(el).toHaveAttribute(
      'title',
      t('lock.lastEditable', { date: formatDate('2026-10-12', locale) }),
    );
    expect(el.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });
});

const WEEK: CurrentWeek = {
  weekStart: '2026-10-26',
  weekEnd: '2026-11-01',
  today: '2026-10-29',
  reportId: '7c0b5a51-0d1e-4f57-9f55-3a2b1c0d9e8f',
  reportStatus: 'draft',
  activeTotal: '15250.5',
  activeCount: 4,
  branchStatus: 'active',
};

describe.each(LOCALES)('CurrentWeekCard (%s)', (locale) => {
  const t = translator(locale);

  it('shows the week range, the report status with a link, the total and the count', () => {
    const { container } = renderWithIntl(<CurrentWeekCard week={WEEK} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(screen.getByRole('heading', { name: t('week.title') })).toBeInTheDocument();
    expect(
      screen.getByText(
        t('week.range', {
          start: formatDate('2026-10-26', locale),
          end: formatDate('2026-11-01', locale),
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(statusLabel(locale, 'draft'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('week.openReport') })).toHaveAttribute(
      'href',
      `/reports/${WEEK.reportId}`,
    );
    const total = screen.getByText(formatMoney('15250.5', locale));
    expect(total).toHaveTextContent('PKR 15,250.50');
    expect(total).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(t('week.count', { count: 4, total: '4' }))).toBeInTheDocument();
    expect(screen.getByText(t('week.lockExplainer'))).toBeInTheDocument();
    expect(screen.queryByText(t('week.notAccepting'))).toBeNull();
    expect(container.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('explains that the report opens with the first collection when none exists', () => {
    renderWithIntl(<CurrentWeekCard week={{ ...WEEK, reportId: null, reportStatus: null }} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(t('week.noReport'))).toBeInTheDocument();
  });

  it.each(['paused', 'closed'] as const)('warns when the branch is %s', (branchStatus) => {
    renderWithIntl(<CurrentWeekCard week={{ ...WEEK, branchStatus }} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByText(t('week.notAccepting'))).toBeInTheDocument();
    expect(screen.queryByText(t('week.lockExplainer'))).toBeNull();
  });
});

const BRANCH = '11111111-1111-4111-8111-111111111111';
const REPORT = '22222222-2222-4222-8222-222222222222';

function item(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: '0b6f3c5e-6a43-4e7d-9a52-6f1f0a1d2e01',
    branchId: BRANCH,
    branchCode: 'BR-0001',
    branchName: 'Sample Branch',
    branchStatus: 'active',
    reportId: REPORT,
    reportStatus: 'draft',
    weekStart: '2026-10-26',
    amount: '2500.75',
    collectedOn: '2026-10-28',
    purpose: 'Ration packs',
    note: null,
    status: 'active',
    voidReason: null,
    voidedAt: null,
    routedAt: null,
    createdAt: '2026-10-28T06:00:00.000Z',
    createdByName: 'Bilal Ahmed',
    lock: { lastEditableOn: '2026-11-04', locked: false, daysLeft: 3 },
    editability: 'editable',
    ...overrides,
  };
}

describe.each(LOCALES)('CollectionsTable (%s)', (locale) => {
  const t = translator(locale);
  const render = (ui: Parameters<typeof renderWithIntl>[0]) =>
    renderWithIntl(ui, { locale, namespaces: NAMESPACES });

  it('lists date, purpose, end-aligned amount, report status and lock state', () => {
    const { container } = render(<CollectionsTable items={[item()]} canAmend canVoid />);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual([
      t('columns.date'),
      t('columns.purpose'),
      t('columns.amount'),
      t('columns.report'),
      t('columns.state'),
      t('columns.actions'),
    ]);
    const row = container.querySelector('tbody tr') as HTMLElement;
    expect(row).toHaveTextContent(formatDate('2026-10-28', locale));
    expect(row).toHaveTextContent('Ration packs');
    const amount = within(row).getByText('PKR 2,500.75');
    expect(amount).toHaveAttribute('dir', 'ltr');
    expect(amount.closest('td')).toHaveClass('text-end', 'tabular');
    expect(row).toHaveTextContent(statusLabel(locale, 'draft'));
    expect(row.querySelector('[data-lock-state="editable"]')).toHaveTextContent(
      t('lock.locksIn', { days: 3 }),
    );
    expect(row.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('links each row to its detail page and its report', () => {
    const { container } = render(<CollectionsTable items={[item()]} />);
    const links = [...container.querySelectorAll('tbody a')].map((a) => a.getAttribute('href'));
    expect(links).toContain(`/collections/${item().id}`);
    expect(links).toContain(`/reports/${REPORT}`);
  });

  it.each(['editable', 'editable_exempt'] as const)(
    'offers Edit and Void on %s rows when allowed',
    (editability) => {
      const { container } = render(
        <CollectionsTable items={[item({ editability })]} canAmend canVoid />,
      );
      const row = container.querySelector('tbody tr') as HTMLElement;
      expect(within(row).getByRole('link', { name: t('actions.edit') })).toHaveAttribute(
        'href',
        `/collections/${item().id}#amend`,
      );
      expect(within(row).getByRole('button', { name: t('actions.void') })).toBeInTheDocument();
    },
  );

  it.each(['locked', 'report_submitted', 'report_approved', 'voided', 'branch_closed'] as const)(
    'hides Edit and Void on %s rows',
    (editability) => {
      const { container } = render(
        <CollectionsTable items={[item({ editability })]} canAmend canVoid />,
      );
      const row = container.querySelector('tbody tr') as HTMLElement;
      expect(within(row).queryByRole('link', { name: t('actions.edit') })).toBeNull();
      expect(within(row).queryByRole('button', { name: t('actions.void') })).toBeNull();
      expect(within(row).getByRole('link', { name: t('actions.view') })).toBeInTheDocument();
    },
  );

  it('hides Edit and Void for read-only roles even on editable rows', () => {
    const { container } = render(<CollectionsTable items={[item()]} />);
    expect(container.querySelector('tbody button')).toBeNull();
    expect(screen.queryByRole('link', { name: t('actions.edit') })).toBeNull();
  });

  it('mutes voided rows and shows the reason', () => {
    const { container } = render(
      <CollectionsTable
        items={[item({ status: 'voided', voidReason: 'Entered twice', editability: 'voided' })]}
        canAmend
        canVoid
      />,
    );
    const row = container.querySelector('tbody tr') as HTMLElement;
    expect(row).toHaveAttribute('data-voided', 'true');
    expect(row).toHaveClass('text-text-muted');
    expect(row).toHaveTextContent(t('void.reasonLabel', { reason: 'Entered twice' }));
    expect(row).toHaveTextContent(t('lock.voided'));
  });

  it('adds a branch column with the code isolated for head office', () => {
    const { container } = render(<CollectionsTable items={[item()]} showBranch />);
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toContain(t('columns.branch'));
    const code = container.querySelector('tbody bdi[dir="ltr"]');
    expect(code).toHaveTextContent('BR-0001');
    expect(container.querySelector('tbody')).toHaveTextContent('Sample Branch');
  });

  it('shows the empty state with the hint', () => {
    render(<CollectionsTable items={[]} />);
    expect(screen.getByText(t('page.empty'))).toBeInTheDocument();
    expect(screen.getByText(t('page.emptyHint'))).toBeInTheDocument();
  });
});

describe.each(LOCALES)('CollectionForm (%s)', (locale) => {
  const t = translator(locale);
  const render = (ui: Parameters<typeof renderWithIntl>[0]) =>
    renderWithIntl(ui, { locale, namespaces: NAMESPACES });
  const field = (label: string) => screen.getByLabelText(label);
  const submit = () => screen.getByRole('button', { name: t('form.submit') });

  function renderCreate() {
    return render(<CollectionForm mode="create" today="2026-10-29" minDate="2026-10-22" />);
  }

  it('labels the amount field and keeps the PKR prefix out of the accessible name', () => {
    const { container } = renderCreate();
    const amount = field(t('form.amount'));
    expect(amount).toHaveAttribute('type', 'text');
    expect(amount).toHaveAttribute('inputmode', 'decimal');
    const prefix = [...container.querySelectorAll('[aria-hidden="true"]')].find(
      (el) => el.textContent === 'PKR',
    );
    expect(prefix).toBeDefined();
    const date = field(t('form.date'));
    expect(date).toHaveValue('2026-10-29');
    expect(date).toHaveAttribute('max', '2026-10-29');
    expect(date).toHaveAttribute('min', '2026-10-22');
    const options = [...container.querySelectorAll('datalist option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(
      [
        'rationPacks',
        'schoolFees',
        'medicalCamp',
        'floodRelief',
        'generalDonations',
        'winterClothing',
      ].map((key) => t(`purposes.${key}`)),
    );
  });

  it('explains invalid input without calling the server', async () => {
    renderCreate();
    fireEvent.change(field(t('form.amount')), { target: { value: '12.345' } });
    fireEvent.click(submit());
    expect(await screen.findByText(t('errors.invalid_money'))).toBeInTheDocument();
    expect(screen.getByText(t('errors.too_short'))).toBeInTheDocument();
    expect(field(t('form.amount'))).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the amount as a string, confirms, resets and refreshes', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { data: item() }));
    renderCreate();
    fireEvent.change(field(t('form.amount')), { target: { value: '2500.75' } });
    fireEvent.change(field(t('form.purpose')), { target: { value: 'Ration packs' } });
    fireEvent.click(submit());
    expect(await screen.findByText(t('form.logged'))).toBeInTheDocument();
    expect(calls()).toEqual([
      {
        url: '/api/v1/collections',
        method: 'POST',
        body: { amount: '2500.75', collectedOn: '2026-10-29', purpose: 'Ration packs' },
      },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(field(t('form.amount'))).toHaveValue('');
    expect(field(t('form.purpose'))).toHaveValue('');
  });

  it('disables the button while sending', async () => {
    let resolve: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    renderCreate();
    fireEvent.change(field(t('form.amount')), { target: { value: '100' } });
    fireEvent.change(field(t('form.purpose')), { target: { value: 'Medical camp' } });
    fireEvent.click(submit());
    const busy = await screen.findByRole('button', { name: t('form.submitting') });
    expect(busy).toBeDisabled();
    resolve(reply(201, { data: item() }));
    await waitFor(() => expect(submit()).toBeEnabled());
  });

  it('maps server field errors to their field', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(422, {
        error: {
          code: 'validation_failed',
          message: 'Validation failed',
          details: {
            fields: [
              { path: 'collectedOn', code: 'outside_lock_window', message: 'outside_lock_window' },
            ],
          },
          requestId: 'r',
        },
      }),
    );
    renderCreate();
    fireEvent.change(field(t('form.amount')), { target: { value: '100' } });
    fireEvent.change(field(t('form.purpose')), { target: { value: 'Flood relief' } });
    fireEvent.click(submit());
    expect(await screen.findByText(t('errors.outside_lock_window'))).toBeInTheDocument();
    expect(field(t('form.date'))).toHaveAttribute('aria-invalid', 'true');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('shows a conflict in an alert', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(409, { error: { code: 'report_not_open', message: 'Conflict', requestId: 'r' } }),
    );
    renderCreate();
    fireEvent.change(field(t('form.amount')), { target: { value: '100' } });
    fireEvent.change(field(t('form.purpose')), { target: { value: 'Flood relief' } });
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.report_not_open'));
  });

  it('patches only the changed fields in edit mode', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { data: item({ amount: '2600.00' }) }));
    render(
      <CollectionForm
        mode="edit"
        today="2026-10-29"
        minDate="2026-10-22"
        collection={item({ collectedOn: '2026-10-28' })}
      />,
    );
    const save = screen.getByRole('button', { name: t('form.save') });
    expect(save).toBeDisabled();
    const date = field(t('form.date'));
    expect(date).toHaveAttribute('min', '2026-10-26');
    expect(date).toHaveAttribute('max', '2026-10-29');
    fireEvent.change(field(t('form.amount')), { target: { value: '2600.00' } });
    fireEvent.click(save);
    expect(await screen.findByText(t('form.saved'))).toBeInTheDocument();
    expect(calls()).toEqual([
      { url: `/api/v1/collections/${item().id}`, method: 'PATCH', body: { amount: '2600.00' } },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows a locked refusal on amend', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(409, { error: { code: 'collection_locked', message: 'Conflict', requestId: 'r' } }),
    );
    render(
      <CollectionForm mode="edit" today="2026-10-29" minDate="2026-10-22" collection={item()} />,
    );
    fireEvent.change(field(t('form.purpose')), { target: { value: 'School fees' } });
    fireEvent.click(screen.getByRole('button', { name: t('form.save') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.collection_locked'));
  });
});

describe.each(LOCALES)('VoidCollectionDialog (%s)', (locale) => {
  const t = translator(locale);
  const open = () => {
    const result = renderWithIntl(
      <VoidCollectionDialog collectionId={item().id} amount="2500.75" />,
      { locale, namespaces: NAMESPACES },
    );
    fireEvent.click(screen.getByRole('button', { name: t('actions.void') }));
    const dialog = result.container.querySelector('dialog') as HTMLDialogElement;
    return { ...result, dialog };
  };
  const confirmButton = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: t('void.confirm') });

  it('asks for confirmation with the amount and a reason field', () => {
    const { dialog } = open();
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveTextContent(t('void.title'));
    expect(dialog).toHaveTextContent('PKR 2,500.75');
    expect(within(dialog).getByLabelText(t('void.reason'))).toBeRequired();
  });

  it('blocks confirmation until the reason has 3 characters', async () => {
    const { dialog } = open();
    fireEvent.change(within(dialog).getByLabelText(t('void.reason')), {
      target: { value: 'no' },
    });
    fireEvent.click(confirmButton(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('errors.too_short'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the reason, closes and refreshes', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { data: item({ status: 'voided' }) }));
    const { dialog } = open();
    fireEvent.change(within(dialog).getByLabelText(t('void.reason')), {
      target: { value: 'Entered twice' },
    });
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(calls()).toEqual([
      {
        url: `/api/v1/collections/${item().id}/void`,
        method: 'POST',
        body: { reason: 'Entered twice' },
      },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['collection_locked', 'report_not_open'] as const)(
    'shows the %s refusal and stays open',
    async (code) => {
      fetchMock.mockResolvedValueOnce(
        reply(409, { error: { code, message: 'Conflict', requestId: 'r' } }),
      );
      const { dialog } = open();
      fireEvent.change(within(dialog).getByLabelText(t('void.reason')), {
        target: { value: 'Entered twice' },
      });
      fireEvent.click(confirmButton(dialog));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`errors.${code}`));
      expect(dialog).toHaveAttribute('open');
      expect(router.refresh).not.toHaveBeenCalled();
    },
  );
});

describe.each(LOCALES)('CollectionFiltersForm (%s)', (locale) => {
  const t = translator(locale);

  it('is a GET form with branch, status and week filters', () => {
    const { container } = renderWithIntl(
      <CollectionFiltersForm
        branches={[
          { id: BRANCH, code: 'BR-0001', name: 'Sample Branch' },
          { id: REPORT, code: 'BR-0002', name: 'Lahore' },
        ]}
        values={{ branchId: BRANCH, status: 'voided' }}
      />,
      { locale, namespaces: NAMESPACES },
    );
    const form = container.querySelector('form') as HTMLFormElement;
    expect(form).toHaveAttribute('method', 'get');
    expect(screen.getByLabelText(t('page.filterBranch'))).toHaveValue(BRANCH);
    expect(screen.getByLabelText(t('page.filterStatus'))).toHaveValue('voided');
    expect(screen.getByLabelText(t('page.filterWeek'))).toHaveAttribute('name', 'weekStart');
    const options = [...container.querySelectorAll('#collections-branch option')].map(
      (o) => o.textContent,
    );
    expect(options).toEqual([t('page.allBranches'), 'Sample Branch (BR-0001)', 'Lahore (BR-0002)']);
    expect(screen.getByRole('link', { name: t('page.clear') })).toHaveAttribute(
      'href',
      '/collections',
    );
  });
});
