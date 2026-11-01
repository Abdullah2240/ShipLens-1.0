// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../tests/support/render-intl';
import type { Actor } from '@/platform/authz';
import { Forbidden, NotFound } from '@/platform/errors';
import { AuditChainSection, recheckHref } from './AuditChainSection';
import { ReportVerificationSection } from './ReportVerificationSection';

const MESSAGES = path.resolve(import.meta.dirname, '../../../messages');

const mocks = vi.hoisted(() => ({
  pool: { name: 'request-pool' },
  getReportVerification: vi.fn(),
  getChainStatus: vi.fn(),
  getReport: vi.fn(),
  listAuditEvents: vi.fn(),
  getAuditFacets: vi.fn(),
  actor: { current: null as unknown },
}));

vi.mock('@/modules/verification', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/verification')>()),
  getReportVerification: mocks.getReportVerification,
}));
vi.mock('@/platform/audit/chain/verify', () => ({ getChainStatus: mocks.getChainStatus }));
vi.mock('@/platform/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/db')>()),
  getPool: vi.fn(() => mocks.pool),
}));
vi.mock('@/platform/config/env', () => ({
  getEnv: () => ({ APP_ORIGIN: 'https://shiplens.example/' }),
}));

// Host pages: their data loaders and child components are replaced by stand-ins, so only
// the placement of the verification sections is under test.
vi.mock('@/platform/http/server', () => ({
  requireActor: vi.fn(async () => ({ actor: mocks.actor.current })),
  orNotFound: <T,>(promise: Promise<T>) => promise,
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const root = nodePath.resolve(import.meta.dirname, '../../../messages');
  const load = (locale: string) =>
    Object.fromEntries(
      ['common', 'reports', 'audit'].map((ns) => [
        ns,
        JSON.parse(fs.readFileSync(nodePath.join(root, locale, `${ns}.json`), 'utf8')),
      ]),
    );
  return {
    setRequestLocale: vi.fn(),
    getTranslations: vi.fn(async (arg: string | { locale: string; namespace: string }) =>
      typeof arg === 'string'
        ? createTranslator({ locale: 'en', messages: load('en'), namespace: arg as never })
        : createTranslator({
            locale: arg.locale,
            messages: load(arg.locale),
            namespace: arg.namespace as never,
          }),
    ),
  };
});
function stub(name: string) {
  return function Stub({ children }: { children?: ReactNode }) {
    return <div data-stub={name}>{children}</div>;
  };
}
vi.mock('@/modules/reports', () => ({ getReport: mocks.getReport }));
vi.mock('@/modules/timeline', () => ({ getReportTimeline: vi.fn(async () => []) }));
vi.mock('@/modules/timeline/components/AuditTimeline', () => ({
  AuditTimeline: stub('timeline'),
}));
vi.mock('@/modules/reports/components/Panel', () => ({ Panel: stub('timeline-panel') }));
vi.mock('@/modules/reports/components/ReportActions', () => ({ ReportActions: stub('actions') }));
vi.mock('@/modules/reports/components/ReportCollectionsTable', () => ({
  ReportCollectionsTable: stub('collections'),
}));
vi.mock('@/modules/reports/components/ReportHistory', () => ({ ReportHistory: stub('history') }));
vi.mock('@/modules/reports/components/ReportSummary', () => ({
  ReportSummary: stub('summary'),
  ReportTotals: stub('totals'),
}));
vi.mock('@/modules/reporting/components/share/ShareReportButton', () => ({
  ShareReportButton: stub('share'),
}));
vi.mock('@/modules/audit-log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/audit-log')>()),
  listAuditEvents: mocks.listAuditEvents,
  getAuditFacets: mocks.getAuditFacets,
}));
vi.mock('@/modules/audit-log/components/AuditEventsList', () => ({
  AuditEventsList: stub('events'),
  AuditRestrictedNotice: stub('restricted'),
}));
vi.mock('@/modules/audit-log/components/AuditFilters', () => ({ AuditFilters: stub('filters') }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

type Locale = 'en' | 'ur';
const LOCALES: Locale[] = ['en', 'ur'];
const REPORT_ID = '6f1c2a54-58a4-4f43-9a42-0d6b1b1a7c11';
const SEAL = '0123456789abcdef';
const LEAD: Actor = { userId: 'u-lead', role: 'branch_lead', branchId: 'b-1' };
const FINANCE: Actor = { userId: 'u-fin', role: 'finance_reviewer', branchId: null };

function verify(locale: Locale): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync(path.join(MESSAGES, locale, 'verify.json'), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >;
}
const panelText = (locale: Locale, key: string) => verify(locale).panel![key] as string;
const badgeText = (locale: Locale, key: string) => verify(locale).badge![key] as string;

const renderIn = (ui: ReactElement, locale: Locale) =>
  renderWithIntl(ui, { locale, namespaces: ['common', 'verify'] });

beforeEach(() => {
  mocks.getReportVerification.mockResolvedValue({
    code: '7K2QH-M9XWD',
    path: `/verify/7K2QH-M9XWD?s=${SEAL}`,
    seal: SEAL,
  });
  mocks.getChainStatus.mockResolvedValue({
    status: 'intact',
    checkedEvents: 1234,
    head: { chainSeq: 1234, hash: 'f'.repeat(64) },
    checkedAt: '2026-10-31T07:30:00.000Z',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe.each(LOCALES)('ReportVerificationSection in %s', (locale) => {
  it('shows the panel with the absolute public link built from APP_ORIGIN and the path', async () => {
    const ui = await ReportVerificationSection({ reportId: REPORT_ID, actor: LEAD, locale });
    expect(mocks.getReportVerification).toHaveBeenCalledWith(mocks.pool, LEAD, REPORT_ID);
    const { container } = renderIn(ui!, locale);

    const region = screen.getByRole('region', { name: panelText(locale, 'title') });
    expect(region).toHaveAttribute('data-locale', locale);
    expect(within(region).getByText('7K2QH-M9XWD').closest('bdi')).toHaveAttribute('dir', 'ltr');
    const open = within(region).getByRole('link', { name: new RegExp(panelText(locale, 'open')) });
    expect(open).toHaveAttribute('href', `https://shiplens.example/verify/7K2QH-M9XWD?s=${SEAL}`);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
  });

  it('renders nothing when the report has no public code (NotFound)', async () => {
    mocks.getReportVerification.mockRejectedValueOnce(new NotFound());
    await expect(
      ReportVerificationSection({ reportId: REPORT_ID, actor: LEAD, locale }),
    ).resolves.toBeNull();
  });
});

describe('ReportVerificationSection errors', () => {
  it('lets any other error reach the error boundary', async () => {
    mocks.getReportVerification.mockRejectedValueOnce(new Forbidden());
    await expect(
      ReportVerificationSection({ reportId: REPORT_ID, actor: LEAD, locale: 'en' }),
    ).rejects.toBeInstanceOf(Forbidden);
    mocks.getReportVerification.mockRejectedValueOnce(new Error('db down'));
    await expect(
      ReportVerificationSection({ reportId: REPORT_ID, actor: LEAD, locale: 'en' }),
    ).rejects.toThrow('db down');
  });

  it('shows "no seal yet" when the approval has no seal', async () => {
    mocks.getReportVerification.mockResolvedValueOnce({
      code: '7K2QH-M9XWD',
      path: '/verify/7K2QH-M9XWD',
      seal: null,
    });
    renderIn(
      (await ReportVerificationSection({ reportId: REPORT_ID, actor: LEAD, locale: 'en' }))!,
      'en',
    );
    expect(screen.getByText(panelText('en', 'sealNone'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(panelText('en', 'open')) })).toHaveAttribute(
      'href',
      'https://shiplens.example/verify/7K2QH-M9XWD',
    );
  });
});

describe('recheckHref', () => {
  it('adds chain=fresh to the audit path, keeping filters', () => {
    expect(recheckHref('en')).toBe('/en/audit?chain=fresh');
    expect(recheckHref('ur', '/audit?action=report.approve')).toBe(
      '/ur/audit?action=report.approve&chain=fresh',
    );
  });
});

describe.each(LOCALES)('AuditChainSection in %s', (locale) => {
  it('shows the intact badge from the cached status with a re-check link', async () => {
    const ui = await AuditChainSection({ locale });
    expect(mocks.getChainStatus).toHaveBeenCalledWith(mocks.pool, {});
    const { container } = renderIn(ui, locale);
    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('data-status', 'intact');
    expect(badge).toHaveTextContent(badgeText(locale, 'intact'));
    expect(within(badge).getByRole('link', { name: badgeText(locale, 'recheck') })).toHaveAttribute(
      'href',
      `/${locale}/audit?chain=fresh`,
    );
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
  });

  it('forces a fresh check and shows the broken event and reason', async () => {
    mocks.getChainStatus.mockResolvedValueOnce({
      status: 'broken',
      checkedEvents: 41,
      brokenAt: { chainSeq: 42, eventId: 'e-42', reason: 'hash_mismatch' },
      checkedAt: '2026-10-31T07:30:00.000Z',
    });
    const ui = await AuditChainSection({ locale, fresh: true, path: '/audit?entity=report' });
    expect(mocks.getChainStatus).toHaveBeenCalledWith(mocks.pool, { fresh: true });
    renderIn(ui, locale);
    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('data-status', 'broken');
    expect(
      within(badge)
        .getByText(/^#?42$/)
        .closest('bdi'),
    ).toHaveAttribute('dir', 'ltr');
    expect(badge).toHaveTextContent(
      (verify(locale).badge!.reason as Record<string, string>).hash_mismatch!,
    );
    expect(within(badge).getByRole('link')).toHaveAttribute(
      'href',
      `/${locale}/audit?entity=report&chain=fresh`,
    );
  });
});

describe('report page', () => {
  async function renderReportPage(status: string, actor: Actor = LEAD) {
    mocks.actor.current = actor;
    mocks.getReport.mockResolvedValue({
      id: REPORT_ID,
      status,
      branchStatus: 'active',
      branchName: 'Alpha',
      allowedActions: [],
      liveCount: 1,
      liveAmount: '10.00',
      frozenAmount: status === 'draft' || status === 'returned' ? null : '10.00',
      collections: [],
      events: [],
    });
    const { default: ReportPage } = await import('@/app/[locale]/(app)/reports/[id]/page');
    const ui = await ReportPage({ params: Promise.resolve({ locale: 'en', id: REPORT_ID }) });
    // The page tree holds the async section as an element; resolve it before rendering.
    return resolveAsync(ui);
  }

  it('shows the verification panel on an approved report, between the history and the timeline', async () => {
    const tree = await renderReportPage('approved', FINANCE);
    renderIn(tree, 'en');
    expect(mocks.getReportVerification).toHaveBeenCalledWith(mocks.pool, FINANCE, REPORT_ID);
    const region = screen.getByRole('region', { name: panelText('en', 'title') });
    const history = document.querySelector('[data-stub="history"]')!;
    const timeline = document.querySelector('[data-stub="timeline-panel"]')!;
    expect(history.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      region.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each(['draft', 'submitted', 'returned'])('shows nothing for a %s report', async (status) => {
    const tree = await renderReportPage(status);
    render(tree);
    expect(mocks.getReportVerification).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.querySelector('[data-stub="summary"]')).not.toBeNull();
  });
});

describe('audit viewer page', () => {
  async function renderAuditPage(search: Record<string, string>) {
    mocks.actor.current = FINANCE;
    mocks.listAuditEvents.mockResolvedValue({ items: [], nextBefore: null, restricted: true });
    mocks.getAuditFacets.mockResolvedValue({});
    const { default: AuditPage } = await import('@/app/[locale]/(app)/audit/page');
    const ui = await AuditPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(search),
    });
    return resolveAsync(ui);
  }

  it('puts the chain badge in the header slot, above the filters', async () => {
    renderIn(await renderAuditPage({}), 'en');
    const slot = document.querySelector('[data-audit-header-badges]')!;
    expect(within(slot as HTMLElement).getByRole('status')).toHaveAttribute(
      'data-status',
      'intact',
    );
    const filters = document.querySelector('[data-stub="filters"]')!;
    expect(slot.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mocks.getChainStatus).toHaveBeenCalledWith(mocks.pool, {});
  });

  it('re-checks on ?chain=fresh and keeps the filters in the re-check link', async () => {
    renderIn(await renderAuditPage({ chain: 'fresh', entity: 'report' }), 'en');
    expect(mocks.getChainStatus).toHaveBeenCalledWith(mocks.pool, { fresh: true });
    expect(
      within(screen.getByRole('status')).getByRole('link', { name: badgeText('en', 'recheck') }),
    ).toHaveAttribute('href', '/en/audit?entity=report&chain=fresh');
  });
});

/**
 * Walks a server component tree and awaits async function components, so the result can be
 * rendered on the client by Testing Library. Synchronous components are left to React.
 */
async function resolveAsync(node: ReactNode): Promise<ReactElement> {
  const walk = async (n: ReactNode): Promise<ReactNode> => {
    if (Array.isArray(n)) return Promise.all(n.map(walk));
    if (!n || typeof n !== 'object' || !('props' in n)) return n;
    const el = n as ReactElement<{ children?: ReactNode } & Record<string, unknown>>;
    if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') {
      const rendered = await (el.type as (p: unknown) => Promise<ReactNode>)(el.props);
      return walk(rendered);
    }
    const props: Record<string, unknown> = { ...el.props };
    for (const [key, value] of Object.entries(el.props)) {
      if (key === 'children' || (value && typeof value === 'object' && 'props' in value)) {
        props[key] = await walk(value as ReactNode);
      }
    }
    return cloneElement(el, props);
  };
  return (await walk(node)) as ReactElement;
}
