// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import type { AuditFacets, AuditListItem, AuditQuery } from '../types';
import { AuditChangeTable } from './AuditChangeTable';
import { AuditEventsList, AuditRestrictedNotice } from './AuditEventsList';
import { AuditFilters } from './AuditFilters';
import { auditEntityHref, auditHref, olderHref } from './audit-entity-link';

const nav = vi.hoisted(() => ({ push: vi.fn() }));

// next-intl's createNavigation cannot be imported under Vitest (see LanguageSwitcher.test).
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/audit',
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

vi.setConfig({ testTimeout: 20000 });

const LOCALES = ['en', 'ur'] as const;
type Locale = (typeof LOCALES)[number];
const NAMESPACES = ['common', 'audit', 'trace'];
const MESSAGES = path.resolve(import.meta.dirname, '../../../../messages');

function msg(locale: Locale, key: string, ns = 'audit'): string {
  const json = JSON.parse(readFileSync(path.join(MESSAGES, locale, `${ns}.json`), 'utf8'));
  const value = key
    .split('.')
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], json);
  if (typeof value !== 'string') throw new Error(`missing ${ns} message ${locale}:${key}`);
  return value;
}

const BRANCH = '11111111-1111-4111-8111-111111111111';
const REPORT = '22222222-2222-4222-8222-222222222222';
const COLLECTION = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';

function item(overrides: Partial<AuditListItem> = {}): AuditListItem {
  return {
    id: '901',
    occurredAt: '2026-10-12T06:30:00.000Z',
    requestId: 'seed:demo-data',
    actorId: ACTOR,
    actorName: 'Bilal Ahmed',
    actorRole: 'finance_reviewer',
    action: 'report.approve',
    entityType: 'report',
    entityId: REPORT,
    branchId: BRANCH,
    branchCode: 'LHR-01',
    reportId: REPORT,
    before: { status: 'submitted', version: 2 },
    after: { status: 'approved', version: 3 },
    ...overrides,
  };
}

const FACETS: AuditFacets = {
  actions: ['collection.create', 'report.approve', 'report.submit', 'widget.spin'],
  entityTypes: ['collection', 'report'],
  actors: [{ id: ACTOR, name: 'Bilal Ahmed', role: 'finance_reviewer' }],
  branches: [{ id: BRANCH, code: 'LHR-01', name: 'Lahore' }],
  restricted: false,
};

const EMPTY_QUERY: AuditQuery = { limit: 50 };

beforeEach(() => {
  nav.push.mockReset();
});

describe('audit links', () => {
  it('links a report into the collected drill-down at L3', () => {
    expect(auditEntityHref(item())).toBe(
      `/dashboard/kpi/collected/branches/${BRANCH}/reports/${REPORT}`,
    );
  });

  it('links a collection with branch and report into L4', () => {
    expect(
      auditEntityHref(
        item({ entityType: 'collection', entityId: COLLECTION, action: 'collection.create' }),
      ),
    ).toBe(
      `/dashboard/kpi/collected/branches/${BRANCH}/reports/${REPORT}/collections/${COLLECTION}`,
    );
  });

  it('filters the viewer for other records and for collections without a report', () => {
    expect(auditEntityHref(item({ entityType: 'member', entityId: MEMBER }))).toBe(
      `/audit?entity=member&entityId=${MEMBER}`,
    );
    expect(
      auditEntityHref(item({ entityType: 'collection', entityId: COLLECTION, reportId: null })),
    ).toBe(`/audit?entity=collection&entityId=${COLLECTION}`);
    expect(auditEntityHref(item({ branchId: null }))).toBe(
      `/audit?entity=report&entityId=${REPORT}`,
    );
  });

  it('serialises filters in canonical order and keeps the default page size out', () => {
    expect(auditHref({})).toBe('/audit');
    expect(
      auditHref({
        branch: BRANCH,
        action: 'report.approve',
        from: '2026-10-01',
        limit: 50,
        entityId: '',
      }),
    ).toBe(`/audit?from=2026-10-01&action=report.approve&branch=${BRANCH}`);
    expect(auditHref({ limit: 20 })).toBe('/audit?limit=20');
  });

  it('builds the older page from the current filters plus the cursor', () => {
    const q: AuditQuery = { action: 'report.approve', before: '999', limit: 50 };
    expect(olderHref(q, '812')).toBe('/audit?action=report.approve&before=812');
    expect(olderHref(q, null)).toBeNull();
  });
});

describe.each(LOCALES)('AuditChangeTable (%s)', (locale) => {
  it('shows only changed fields with before and after values', () => {
    const { container } = renderWithIntl(
      <AuditChangeTable
        before={{ status: 'submitted', week_start: '2026-10-05' }}
        after={{ status: 'approved', version: 3, week_start: '2026-10-05' }}
      />,
      { locale, namespaces: NAMESPACES },
    );
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.getAttribute('data-field'))).toEqual(['status', 'version']);

    const [status, version] = rows;
    expect(status?.querySelector('th')).toHaveTextContent(msg(locale, 'fields.status'));
    expect(status?.querySelector('[data-side="before"]')).toHaveTextContent(
      msg(locale, 'status.submitted', 'common'),
    );
    expect(status?.querySelector('[data-side="after"]')).toHaveTextContent(
      msg(locale, 'status.approved', 'common'),
    );
    expect(version?.querySelector('th')).toHaveTextContent(msg(locale, 'fields.version'));
    expect(version?.querySelector('[data-side="before"]')).toHaveTextContent(
      msg(locale, 'viewer.diff.empty'),
    );
    const after = version?.querySelector('[data-side="after"] bdi[dir="ltr"]');
    expect(after).toHaveTextContent('3');

    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual([
      msg(locale, 'viewer.diff.field'),
      msg(locale, 'viewer.diff.before'),
      msg(locale, 'viewer.diff.after'),
    ]);
  });

  it('shows only the after values for a creation, money through MoneyText', () => {
    const { container } = renderWithIntl(
      <AuditChangeTable
        before={null}
        after={{ amount: '1500.5', purpose: 'Food drive', collected_on: '2026-10-06' }}
      />,
      { locale, namespaces: NAMESPACES },
    );
    expect(container.querySelector('[data-side="before"]')).toBeNull();
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual([msg(locale, 'viewer.diff.field'), msg(locale, 'viewer.diff.after')]);

    const amount = container.querySelector('tr[data-field="amount"] [data-side="after"]');
    expect(amount?.querySelector('bdi[dir="ltr"]')).toHaveTextContent('PKR 1,500.50');
    const purpose = container.querySelector('tr[data-field="purpose"] [data-side="after"] bdi');
    expect(purpose).toHaveTextContent('Food drive');
    expect(purpose).not.toHaveAttribute('dir');
  });

  it('falls back to the raw field name and keeps odd money values raw', () => {
    const { container } = renderWithIntl(
      <AuditChangeTable before={{ widget_code: 'A-1' }} after={{ amount: 'n/a' }} />,
      { locale, namespaces: NAMESPACES },
    );
    expect(container.querySelector('tr[data-field="widget_code"] th')).toHaveTextContent(
      'widget_code',
    );
    expect(
      container.querySelector('tr[data-field="amount"] [data-side="after"]'),
    ).toHaveTextContent('n/a');
  });

  it('says so when nothing changed', () => {
    const { container } = renderWithIntl(
      <AuditChangeTable before={{ status: 'draft' }} after={{ status: 'draft' }} />,
      { locale, namespaces: NAMESPACES },
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container).toHaveTextContent(msg(locale, 'viewer.diff.none'));
  });
});

describe.each(LOCALES)('AuditEventsList (%s)', (locale) => {
  it('renders one expandable row per event with the summary line and the diff', () => {
    const { container } = renderWithIntl(
      <AuditEventsList
        items={[
          item(),
          item({
            id: '900',
            actorId: null,
            actorName: null,
            actorRole: 'system',
            action: 'widget.spin',
            entityType: 'member',
            entityId: MEMBER,
            branchId: null,
            branchCode: null,
            reportId: null,
            requestId: null,
            before: null,
            after: { name: 'Ali' },
          }),
        ]}
        nextHref="/audit?before=900"
      />,
      { locale, namespaces: NAMESPACES },
    );
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');

    const rows = [...container.querySelectorAll('li[data-event-id]')];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.querySelector(':scope > details > summary'))).toBe(true);

    const [approve, system] = rows;
    const summary = approve!.querySelector('summary')!;
    expect(summary.querySelector('time')).toHaveAttribute('dateTime', '2026-10-12T06:30:00.000Z');
    expect(summary).toHaveTextContent('Bilal Ahmed');
    expect(summary.querySelector('[data-role-badge]')).toHaveTextContent(
      msg(locale, 'roles.finance_reviewer'),
    );
    expect(summary.querySelector('[data-action-label]')).toHaveTextContent(
      msg(locale, 'actions.report_approve'),
    );
    const code = summary.querySelector('[data-action-code]');
    expect(code).toHaveTextContent('report.approve');
    expect(code?.closest('bdi[dir="ltr"]') ?? code?.querySelector('bdi[dir="ltr"]')).toBeTruthy();
    expect(summary).toHaveTextContent(msg(locale, 'entities.report'));
    expect(summary.querySelector('[data-branch-code]')).toHaveTextContent('LHR-01');

    const link = approve!.querySelector('a[data-entity-link]');
    expect(link).toHaveAttribute(
      'href',
      `/dashboard/kpi/collected/branches/${BRANCH}/reports/${REPORT}`,
    );
    expect(link).toHaveTextContent(msg(locale, 'viewer.openTrace'));
    expect(approve!.querySelector('tr[data-field="status"]')).toBeTruthy();
    expect(approve!.querySelector('[data-request-id]')).toHaveTextContent('seed:demo-data');
    expect(approve!).toHaveAttribute('data-tone', 'report');

    const sysSummary = system!.querySelector('summary')!;
    expect(sysSummary).toHaveTextContent(msg(locale, 'viewer.system'));
    expect(sysSummary.querySelector('[data-action-label]')).toHaveTextContent('widget.spin');
    expect(system!.querySelector('a[data-entity-link]')).toHaveAttribute(
      'href',
      `/audit?entity=member&entityId=${MEMBER}`,
    );
    expect(system!.querySelector('a[data-entity-link]')).toHaveTextContent(
      msg(locale, 'viewer.filterRecord'),
    );
    expect(system!.querySelector('[data-request-id]')).toBeNull();

    const older = screen.getByRole('link', { name: msg(locale, 'viewer.loadOlder') });
    expect(older).toHaveAttribute('href', '/audit?before=900');
  });

  it('shows the empty state and no older link', () => {
    const { container } = renderWithIntl(<AuditEventsList items={[]} nextHref={null} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveTextContent(msg(locale, 'viewer.empty.title'));
    expect(container.querySelector('li[data-event-id]')).toBeNull();
    expect(container).not.toHaveTextContent(msg(locale, 'viewer.loadOlder'));
  });

  it('renders the finance-only notice', () => {
    renderWithIntl(<AuditRestrictedNotice />, { locale, namespaces: NAMESPACES });
    expect(screen.getByRole('note')).toHaveTextContent(msg(locale, 'viewer.restricted'));
  });
});

describe.each(LOCALES)('AuditFilters (%s)', (locale) => {
  it('lists facet values with localized labels', () => {
    const { container } = renderWithIntl(<AuditFilters facets={FACETS} query={EMPTY_QUERY} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const action = container.querySelector<HTMLSelectElement>('select[name="action"]')!;
    const labels = [...action.options].map((o) => [o.value, o.textContent]);
    expect(labels).toContainEqual(['', msg(locale, 'viewer.filters.any')]);
    expect(labels).toContainEqual(['report.approve', msg(locale, 'actions.report_approve')]);
    expect(labels).toContainEqual(['widget.spin', 'widget.spin']);

    const entity = container.querySelector<HTMLSelectElement>('select[name="entity"]')!;
    expect([...entity.options].map((o) => o.textContent)).toEqual([
      msg(locale, 'viewer.filters.any'),
      msg(locale, 'entities.collection'),
      msg(locale, 'entities.report'),
    ]);

    const actor = container.querySelector<HTMLSelectElement>('select[name="actor"]')!;
    expect(actor.options[1]?.value).toBe(ACTOR);
    expect(actor.options[1]?.textContent).toContain('Bilal Ahmed');
    expect(actor.options[1]?.textContent).toContain(msg(locale, 'roles.finance_reviewer'));

    const branch = container.querySelector<HTMLSelectElement>('select[name="branch"]')!;
    expect(branch.options[1]?.textContent).toContain('LHR-01');
    expect(branch.options[1]?.textContent).toContain('Lahore');

    for (const name of ['from', 'to']) {
      const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      expect(input.type).toBe('date');
      expect(input).toHaveAttribute('dir', 'ltr');
    }
    expect(screen.getByLabelText(msg(locale, 'viewer.filters.entityId'))).toHaveAttribute(
      'name',
      'entityId',
    );
  });

  it('applies only non-empty filters and drops the cursor', () => {
    const { container } = renderWithIntl(
      <AuditFilters
        facets={FACETS}
        query={{ ...EMPTY_QUERY, before: '812', from: '2026-10-01' }}
      />,
      { locale, namespaces: NAMESPACES },
    );
    fireEvent.change(container.querySelector('select[name="action"]')!, {
      target: { value: 'report.approve' },
    });
    fireEvent.change(container.querySelector('select[name="branch"]')!, {
      target: { value: BRANCH },
    });
    fireEvent.click(screen.getByRole('button', { name: msg(locale, 'viewer.filters.apply') }));
    expect(nav.push).toHaveBeenCalledWith(
      `/audit?from=2026-10-01&action=report.approve&branch=${BRANCH}`,
    );
  });

  it('resets to the bare viewer', () => {
    renderWithIntl(
      <AuditFilters facets={FACETS} query={{ ...EMPTY_QUERY, action: 'report.submit' }} />,
      {
        locale,
        namespaces: NAMESPACES,
      },
    );
    fireEvent.click(screen.getByRole('button', { name: msg(locale, 'viewer.filters.reset') }));
    expect(nav.push).toHaveBeenCalledWith('/audit');
  });

  it('keeps a filter value that is not among the facets', () => {
    const { container } = renderWithIntl(
      <AuditFilters facets={FACETS} query={{ ...EMPTY_QUERY, entity: 'member' }} />,
      { locale, namespaces: NAMESPACES },
    );
    const entity = container.querySelector<HTMLSelectElement>('select[name="entity"]')!;
    expect(entity.value).toBe('member');
    fireEvent.click(screen.getByRole('button', { name: msg(locale, 'viewer.filters.apply') }));
    expect(nav.push).toHaveBeenCalledWith('/audit?entity=member');
  });
});

describe('audit viewer sources', () => {
  it.each([
    'AuditChangeTable.tsx',
    'AuditEventsList.tsx',
    'AuditFilters.tsx',
    'audit-entity-link.ts',
  ])('%s uses logical CSS only', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
  });

  it('builds the diff on the shared diffSnapshots helper', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, 'AuditChangeTable.tsx'), 'utf8');
    expect(source).toMatch(/from '@\/modules\/timeline'/);
    expect(source).toMatch(/diffSnapshots\(/);
  });
});
