// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from '@/platform/i18n/format';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { OWNER_AUDIT_ACTIONS, actionMessageKey } from '../actions';
import type { TimelineEntry } from '../types';
import { AuditTimeline } from './AuditTimeline';

const REPORT_ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const COLLECTION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NAMESPACES = ['audit', 'common'];

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
  id: '1',
  occurredAt: '2026-10-26T05:00:00.000Z',
  action: 'collection.create',
  actorName: 'Ayesha Lead',
  actorRole: 'branch_lead',
  entityType: 'collection',
  entityId: COLLECTION_ID,
  changes: [],
  requestId: null,
  ...over,
});

const ENTRIES: TimelineEntry[] = [
  entry({
    id: '1',
    action: 'report.create_draft',
    actorName: null,
    actorRole: 'system',
    entityType: 'report',
    entityId: REPORT_ID,
    changes: [
      { field: 'status', before: null, after: 'draft' },
      { field: 'week_start', before: null, after: '2026-10-26' },
    ],
  }),
  entry({
    id: '2',
    occurredAt: '2026-10-27T09:30:00.000Z',
    action: 'collection.amend',
    changes: [{ field: 'amount', before: '100.00', after: '1500.50' }],
    requestId: 'b7e1d2c3-0000-4000-8000-000000000001',
  }),
  entry({
    id: '3',
    occurredAt: '2026-10-28T11:00:00.000Z',
    action: 'report.submit',
    entityType: 'report',
    entityId: REPORT_ID,
    changes: [
      { field: 'collection_count', before: null, after: 12 },
      { field: 'report_id', before: null, after: REPORT_ID },
      { field: 'status', before: 'draft', after: 'submitted' },
      { field: 'total_amount', before: null, after: '12500.00' },
    ],
  }),
  entry({
    id: '4',
    occurredAt: '2026-10-29T08:00:00.000Z',
    action: 'export.create_zip',
    actorRole: 'finance_reviewer',
    actorName: 'Faraz Finance',
    entityType: 'export',
    entityId: 'exp-1',
    changes: [{ field: 'mystery_field', before: 'a', after: 'b' }],
  }),
  entry({
    id: '5',
    occurredAt: '2026-10-30T08:00:00.000Z',
    action: 'collection.amend',
    changes: [],
  }),
];

const itemFor = (id: string) => {
  const items = screen.getAllByRole('listitem').filter((li) => li.dataset.entryId === id);
  expect(items).toHaveLength(1);
  return items[0]!;
};

describe('AuditTimeline (en)', () => {
  it('renders one list item per entry inside an ordered list with a heading', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} />, { namespaces: NAMESPACES });
    expect(screen.getByRole('heading', { level: 2, name: 'Activity' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Activity' });
    expect(list.tagName).toBe('OL');
    expect(
      within(list)
        .getAllByRole('listitem')
        .filter((li) => li.dataset.entryId),
    ).toHaveLength(5);
  });

  it('shows the localized action, actor and role, and a PKT time with Latin digits', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} />, { namespaces: NAMESPACES });
    const item = itemFor('2');
    expect(within(item).getByText('Collection amended')).toBeInTheDocument();
    expect(item).toHaveTextContent('by Ayesha Lead');
    expect(item).toHaveTextContent('as Branch Lead');
    const time = within(item).getByText(formatDateTime(new Date('2026-10-27T09:30:00.000Z'), 'en'));
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-10-27T09:30:00.000Z');
  });

  it('labels system entries as System', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} />, { namespaces: NAMESPACES });
    const item = itemFor('1');
    expect(within(item).getByText('Weekly report opened')).toBeInTheDocument();
    expect(within(item).getByText('System')).toBeInTheDocument();
    expect(item).not.toHaveTextContent('by ');
  });

  it('collapses the changes behind a native details toggle', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} />, { namespaces: NAMESPACES });
    const item = itemFor('2');
    const details = item.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details!.querySelector('summary')).toHaveTextContent('Show changes (1)');
  });

  it('formats money, dates, statuses and counts', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} />, { namespaces: NAMESPACES });
    const amend = itemFor('2');
    expect(within(amend).getByText('Amount')).toBeInTheDocument();
    expect(within(amend).getByText('PKR 100.00')).toBeInTheDocument();
    expect(within(amend).getByText('PKR 1,500.50')).toBeInTheDocument();

    const draft = itemFor('1');
    expect(within(draft).getByText('Week starting')).toBeInTheDocument();
    expect(within(draft).getByText(formatDate('2026-10-26', 'en'))).toBeInTheDocument();
    expect(within(draft).getByText('Draft')).toBeInTheDocument();

    const submit = itemFor('3');
    expect(within(submit).getByText('Submitted')).toBeInTheDocument();
    expect(within(submit).getByText('PKR 12,500.00')).toBeInTheDocument();
    expect(within(submit).getByText('12')).toBeInTheDocument();
    expect(within(submit).getAllByText('None').length).toBeGreaterThan(0);
  });

  it('isolates ids left-to-right, truncated to 8 characters with the full id in title', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} />, { namespaces: NAMESPACES });
    const submit = itemFor('3');
    const ids = [...submit.querySelectorAll('bdi')].filter((el) => el.title === REPORT_ID);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toHaveTextContent(/^3f2a9c1e$/);
      expect(id).toHaveAttribute('dir', 'ltr');
    }
    const request = [...itemFor('2').querySelectorAll('bdi')].find(
      (el) => el.title === 'b7e1d2c3-0000-4000-8000-000000000001',
    );
    expect(request).toHaveTextContent(/^b7e1d2c3$/);
  });

  it('reads "from X to Y" for screen readers and hides the mirrored arrow', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} />, { namespaces: NAMESPACES });
    const item = itemFor('2');
    const change = within(item).getByText('PKR 1,500.50').closest('[data-change]');
    expect(change).not.toBeNull();
    expect(change).toHaveTextContent(/from\s*PKR 100\.00\s*to\s*PKR 1,500\.50/);
    const arrow = change!.querySelector('[aria-hidden="true"]');
    expect(arrow).not.toBeNull();
    expect(arrow!.getAttribute('class')).toContain('rtl:-scale-x-100');
  });

  it('renders unknown action codes and fields raw', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} />, { namespaces: NAMESPACES });
    const item = itemFor('4');
    expect(within(item).getByText('export.create_zip')).toBeInTheDocument();
    expect(within(item).getByText('mystery_field')).toBeInTheDocument();
    expect(item).toHaveTextContent('as Finance Reviewer');
  });

  it('says when an entry has no field changes', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} />, { namespaces: NAMESPACES });
    const item = itemFor('5');
    expect(within(item).getByText('No field changes recorded')).toBeInTheDocument();
    expect(item.querySelector('details')).toBeNull();
  });

  it('shows the empty state with the default or a custom hint', () => {
    const { unmount } = renderWithIntl(<AuditTimeline entries={[]} />, {
      namespaces: NAMESPACES,
    });
    expect(screen.getByRole('status')).toHaveTextContent('No activity yet');
    expect(screen.queryByRole('list')).toBeNull();
    unmount();
    renderWithIntl(<AuditTimeline entries={[]} emptyHint="Nothing logged this week." />, {
      namespaces: NAMESPACES,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Nothing logged this week.');
  });

  it('uses the requested heading level', () => {
    renderWithIntl(<AuditTimeline entries={ENTRIES} headingLevel={3} />, {
      namespaces: NAMESPACES,
    });
    expect(screen.getByRole('heading', { level: 3, name: 'Activity' })).toBeInTheDocument();
  });
});

describe('AuditTimeline (ur)', () => {
  it('renders Urdu labels in an RTL container with Latin digits', () => {
    const { container } = renderWithIntl(<AuditTimeline entries={ENTRIES} />, {
      locale: 'ur',
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 2, name: 'سرگرمی' })).toBeInTheDocument();
    const amend = itemFor('2');
    expect(within(amend).getByText('وصولی میں ترمیم کی گئی')).toBeInTheDocument();
    expect(amend).toHaveTextContent('بطور شاخ لیڈ');
    expect(within(amend).getByText('PKR 1,500.50')).toBeInTheDocument();
    expect(
      within(amend).getByText(formatDateTime(new Date('2026-10-27T09:30:00.000Z'), 'ur')),
    ).toBeInTheDocument();
    expect(within(itemFor('3')).getByText('جمع شدہ')).toBeInTheDocument();
    expect(within(itemFor('1')).getByText('سسٹم')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('uses no physical-direction classes', () => {
    const { container } = renderWithIntl(<AuditTimeline entries={ENTRIES} />, {
      locale: 'ur',
      namespaces: NAMESPACES,
    });
    expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
  });
});

describe('audit messages', () => {
  const load = (locale: string) =>
    JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, `../../../../messages/${locale}/audit.json`),
        'utf8',
      ),
    ) as { actions: Record<string, string> };

  it('labels every owner action and the people and content actions in both locales', () => {
    const codes = [
      ...OWNER_AUDIT_ACTIONS,
      'application.submit',
      'application.accept',
      'application.decline',
      'member.create',
      'member.update',
      'team.create',
      'team.rename',
      'content.save_draft',
      'content.publish',
      'content.unpublish',
      'auth.login',
      'auth.logout',
    ];
    for (const locale of ['en', 'ur']) {
      const { actions } = load(locale);
      for (const code of codes) expect(actions[actionMessageKey(code)], code).toBeTruthy();
    }
  });
});
