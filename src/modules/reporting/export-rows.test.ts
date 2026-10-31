import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toCsv } from '@/platform/csv';
import { sumMoney } from '@/platform/money';
import {
  EXPORT_KINDS,
  collectionsExport,
  exportFilename,
  flattenLabels,
  isExportKind,
  reportsExport,
  summaryExport,
  unroutedExport,
  type ExportCollectionRow,
  type ExportLabels,
} from './export-rows';
import type { ReportFigureRow } from './repo-kpi';
import type { DashboardSummary, UnroutedRow } from './types';

const MESSAGES = path.resolve(import.meta.dirname, '../../../messages');
const read = (locale: string, ns: string) =>
  JSON.parse(readFileSync(path.join(MESSAGES, locale, `${ns}.json`), 'utf8')) as Record<
    string,
    unknown
  >;

function labelsFor(locale: 'en' | 'ur'): ExportLabels {
  const trace = read(locale, 'trace') as { figures: Record<string, { label: string }> };
  const figures = Object.fromEntries(
    Object.entries(trace.figures).map(([id, f]) => [`figures.${id}`, f.label]),
  );
  return { ...flattenLabels(read(locale, 'exports').csv), ...figures };
}

const en = labelsFor('en');
const ur = labelsFor('ur');
const BOM = '﻿';
const lines = (csv: string) => csv.slice(BOM.length).split('\r\n').slice(0, -1);

const SUMMARY: DashboardSummary = {
  asOf: '2026-10-31T12:00:00.000Z',
  filters: {},
  identities: { collected: true, approved: true },
  figures: {
    collected: { figure: 'collected', measure: 'amount', value: '2100.75', recordCount: 6 },
    approved: { figure: 'approved', measure: 'amount', value: '1750.50', recordCount: 3 },
    pending_approval: {
      figure: 'pending_approval',
      measure: 'amount',
      value: '300.00',
      recordCount: 1,
    },
    in_progress: { figure: 'in_progress', measure: 'amount', value: '50.25', recordCount: 2 },
    not_yet_routed: {
      figure: 'not_yet_routed',
      measure: 'amount',
      value: '1500.00',
      recordCount: 2,
    },
    routed: { figure: 'routed', measure: 'amount', value: '250.50', recordCount: 1 },
    active_branches: { figure: 'active_branches', measure: 'count', value: '2', recordCount: 2 },
    reports_awaiting_review: {
      figure: 'reports_awaiting_review',
      measure: 'count',
      value: '1',
      recordCount: 1,
    },
  },
};

const REPORTS: ReportFigureRow[] = [
  {
    reportId: '11111111-1111-4111-8111-111111111111',
    branchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    branchCode: 'BR-A',
    branchName: 'Alpha, Lahore',
    weekStart: '2026-08-31',
    status: 'approved',
    value: '1250.50',
    recordCount: 2,
    frozenAmount: '1250.50',
    frozenCount: 2,
    submittedAt: '2026-09-07T05:00:00.000Z',
    reviewedAt: '2026-09-08T05:00:00.000Z',
  },
  {
    reportId: '22222222-2222-4222-8222-222222222222',
    branchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    branchCode: 'BR-B',
    branchName: '=Bravo',
    weekStart: '2026-09-14',
    status: 'returned',
    value: '40.25',
    recordCount: 1,
    frozenAmount: null,
    frozenCount: null,
    submittedAt: '2026-09-20T05:00:00.000Z',
    reviewedAt: '2026-09-21T05:00:00.000Z',
  },
];

const COLLECTIONS: ExportCollectionRow[] = [
  {
    collectionId: '33333333-3333-4333-8333-333333333333',
    branchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    branchCode: 'BR-A',
    branchName: 'Alpha',
    reportId: '11111111-1111-4111-8111-111111111111',
    weekStart: '2026-08-31',
    collectedOn: '2026-08-31',
    purpose: '=cmd|',
    amount: '1000.00',
    routedAt: null,
    reportStatus: 'approved',
  },
  {
    collectionId: '44444444-4444-4444-8444-444444444444',
    branchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    branchCode: 'BR-A',
    branchName: 'Alpha',
    reportId: '11111111-1111-4111-8111-111111111111',
    weekStart: '2026-08-31',
    collectedOn: '2026-09-01',
    purpose: 'راشن, school "fees"',
    amount: '250.50',
    routedAt: '2026-09-10T06:00:00.000Z',
    reportStatus: 'approved',
  },
];

const UNROUTED: UnroutedRow[] = [
  {
    collectionId: '33333333-3333-4333-8333-333333333333',
    branchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    branchCode: 'BR-A',
    branchName: 'Alpha',
    reportId: '11111111-1111-4111-8111-111111111111',
    weekStart: '2026-08-31',
    collectedOn: '2026-08-31',
    purpose: 'Food parcels',
    amount: '1000.00',
    approvedAt: '2026-09-08T05:00:00.000Z',
    daysWaiting: 53,
  },
  {
    collectionId: '55555555-5555-4555-8555-555555555555',
    branchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    branchCode: 'BR-B',
    branchName: 'Bravo',
    reportId: '66666666-6666-4666-8666-666666666666',
    weekStart: '2026-08-24',
    collectedOn: '2026-08-25',
    purpose: 'Rations',
    amount: '500.00',
    approvedAt: '2026-09-09T05:00:00.000Z',
    daysWaiting: 52,
  },
];

describe('export kinds', () => {
  it('lists the four kinds and recognises only them', () => {
    expect(EXPORT_KINDS).toEqual(['summary', 'reports', 'collections', 'unrouted']);
    expect(isExportKind('reports')).toBe(true);
    expect(isExportKind('print_summary')).toBe(false);
    expect(isExportKind('__proto__')).toBe(false);
  });
});

describe('flattenLabels', () => {
  it('joins nested keys with dots and keeps only strings', () => {
    expect(flattenLabels({ a: 'A', b: { c: 'C', d: 1 } })).toEqual({ a: 'A', 'b.c': 'C' });
    expect(flattenLabels(null)).toEqual({});
  });
});

describe('exports messages', () => {
  const KEYS = [
    'total',
    'figure',
    'value',
    'records',
    'collectionId',
    'branchCode',
    'branchName',
    'weekStart',
    'weekEnd',
    'status',
    'amount',
    'collections',
    'frozenAmount',
    'submittedAt',
    'approvedAt',
    'collectedOn',
    'purpose',
    'routedAt',
    'daysWaiting',
    'statuses.draft',
    'statuses.submitted',
    'statuses.returned',
    'statuses.approved',
  ];

  it.each([
    ['en', en],
    ['ur', ur],
  ])('%s has every csv label, non-empty', (_locale, labels) => {
    for (const key of KEYS) expect(labels[key], key).toMatch(/\S/);
  });

  it('Urdu labels use Latin digits only', () => {
    expect(JSON.stringify(read('ur', 'exports'))).not.toMatch(/[٠-٩۰-۹]/);
  });
});

describe('summaryExport', () => {
  it('has one row per figure, money and count values typed, no footer', () => {
    const table = summaryExport(SUMMARY, en);
    expect(table.footer).toBeUndefined();
    expect(table.rows).toHaveLength(8);
    expect(lines(toCsv(table.columns, table.rows, table.footer))).toEqual([
      'Figure,Value,Records',
      'Collected,2100.75,6',
      'Approved,1750.50,3',
      'Pending approval,300.00,1',
      'In progress,50.25,2',
      'Not yet routed,1500.00,2',
      'Routed to main account,250.50,1',
      'Active branches,2,2',
      'Reports awaiting review,1,1',
    ]);
  });

  it('uses Urdu headers and figure names for ur', () => {
    const table = summaryExport(SUMMARY, ur);
    const [header, first] = lines(toCsv(table.columns, table.rows));
    expect(header).toBe(`${ur.figure},${ur.value},${ur.records}`);
    expect(first).toBe(`${ur['figures.collected']},2100.75,6`);
  });
});

describe('reportsExport', () => {
  it('writes one row per report and a total row equal to sumMoney(values)', () => {
    const table = reportsExport(REPORTS, en);
    expect(table.footer.amount).toBe(sumMoney(REPORTS.map((r) => r.value)));
    expect(table.footer.amount).toBe('1290.75');
    expect(lines(toCsv(table.columns, table.rows, table.footer))).toEqual([
      'Branch code,Branch name,Week start,Week end,Status,Amount (PKR),Collections,Submitted total (PKR),Submitted at,Approved at',
      'BR-A,"Alpha, Lahore",2026-08-31,2026-09-06,Approved,1250.50,2,1250.50,2026-09-07T05:00:00.000Z,2026-09-08T05:00:00.000Z',
      "BR-B,'=Bravo,2026-09-14,2026-09-20,Returned,40.25,1,,2026-09-20T05:00:00.000Z,",
      'Total,,,,,1290.75,3,,,',
    ]);
  });

  it('closes an empty export with a zero total', () => {
    const table = reportsExport([], ur);
    expect(lines(toCsv(table.columns, table.rows, table.footer)).at(-1)).toBe(
      `${ur.total},,,,,0.00,0,,,`,
    );
  });
});

describe('collectionsExport', () => {
  it('neutralises purposes and closes with the localized total', () => {
    const table = collectionsExport(COLLECTIONS, en);
    expect(table.footer.amount).toBe(sumMoney(COLLECTIONS.map((r) => r.amount)));
    const out = lines(toCsv(table.columns, table.rows, table.footer));
    expect(out[0]).toBe(
      'Collection ID,Branch code,Branch name,Week start,Collected on,Purpose,Amount (PKR),Routed at',
    );
    expect(out[1]).toBe(
      "33333333-3333-4333-8333-333333333333,BR-A,Alpha,2026-08-31,2026-08-31,'=cmd|,1000.00,",
    );
    expect(out[2]).toBe(
      '44444444-4444-4444-8444-444444444444,BR-A,Alpha,2026-08-31,2026-09-01,"راشن, school ""fees""",250.50,2026-09-10T06:00:00.000Z',
    );
    expect(out[3]).toBe('Total,,,,,,1250.50,');
  });

  it('labels the total row in Urdu for ur', () => {
    const table = collectionsExport(COLLECTIONS, ur);
    expect(table.footer[table.columns[0]!.key]).toBe('میزان');
  });
});

describe('unroutedExport', () => {
  it('lists every row with days waiting and closes with the total', () => {
    const table = unroutedExport(UNROUTED, en);
    expect(table.footer.amount).toBe('1500.00');
    expect(lines(toCsv(table.columns, table.rows, table.footer))).toEqual([
      'Branch code,Branch name,Week start,Collected on,Purpose,Amount (PKR),Approved at,Days waiting',
      'BR-A,Alpha,2026-08-31,2026-08-31,Food parcels,1000.00,2026-09-08T05:00:00.000Z,53',
      'BR-B,Bravo,2026-08-24,2026-08-25,Rations,500.00,2026-09-09T05:00:00.000Z,52',
      'Total,,,,,1500.00,,',
    ]);
  });
});

describe('exportFilename', () => {
  // 20:00 UTC on 31 October is already 1 November in Pakistan.
  const at = new Date('2026-10-31T20:00:00.000Z');

  it('names the kind, figure, month range and PKT date', () => {
    expect(exportFilename('collections', 'approved', { from: '2026-09' }, at)).toBe(
      'shiplens-collections-approved-2026-09-all-20261101.csv',
    );
    expect(exportFilename('summary', null, {}, at)).toBe('shiplens-summary-all-all-20261101.csv');
    expect(
      exportFilename('reports', 'pending_approval', { from: '2026-08', to: '2026-09' }, at),
    ).toBe('shiplens-reports-pending-approval-2026-08-2026-09-20261101.csv');
  });

  it('uses only safe filename characters even for hostile input', () => {
    const name = exportFilename(
      'unrouted',
      '../"evil"\r\n;x=1',
      { from: '"; rm', to: '2026-10' },
      at,
    );
    expect(name).toMatch(/^[a-z0-9.-]+$/);
    expect(name.startsWith('shiplens-unrouted-')).toBe(true);
    expect(name.endsWith('.csv')).toBe(true);
  });
});
