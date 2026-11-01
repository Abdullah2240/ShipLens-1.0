import { mkdirSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';
import type { Role } from '../support/roles';

// CSV downloads from the dashboard export menu (EXP-01, EXP-02). Each file is saved under
// test-results/downloads/ and checked byte by byte: UTF-8 BOM, the localized header row,
// and a total row equal to the API figure for the same session. A download appends one
// export.create audit row and changes nothing else, so it runs in both desktop projects.
// Specs cannot import app code: the column labels are pinned from messages/<locale>/exports.json.

const KINDS = ['summary', 'reports', 'collections', 'unrouted'] as const;
type Kind = (typeof KINDS)[number];

const LABELS = {
  en: {
    exportMenu: 'Export CSV',
    total: 'Total',
    figure: 'Figure',
    value: 'Value',
    records: 'Records',
    collectionId: 'Collection ID',
    branchCode: 'Branch code',
    branchName: 'Branch name',
    weekStart: 'Week start',
    weekEnd: 'Week end',
    status: 'Status',
    amount: 'Amount (PKR)',
    collections: 'Collections',
    frozenAmount: 'Submitted total (PKR)',
    submittedAt: 'Submitted at',
    approvedAt: 'Approved at',
    collectedOn: 'Collected on',
    purpose: 'Purpose',
    routedAt: 'Routed at',
    daysWaiting: 'Days waiting',
  },
  ur: {
    exportMenu: 'CSV برآمد کریں',
    total: 'میزان',
    figure: 'عدد',
    value: 'قدر',
    records: 'ریکارڈز',
    collectionId: 'وصولی آئی ڈی',
    branchCode: 'شاخ کا کوڈ',
    branchName: 'شاخ کا نام',
    weekStart: 'ہفتے کا آغاز',
    weekEnd: 'ہفتے کا اختتام',
    status: 'حیثیت',
    amount: 'رقم (PKR)',
    collections: 'وصولیاں',
    frozenAmount: 'جمع کردہ میزان (PKR)',
    submittedAt: 'جمع کرانے کا وقت',
    approvedAt: 'منظوری کا وقت',
    collectedOn: 'وصولی کی تاریخ',
    purpose: 'مقصد',
    routedAt: 'منتقلی کا وقت',
    daysWaiting: 'انتظار کے دن',
  },
} as const satisfies Record<UiLocale, Record<string, string>>;

type LabelKey = Exclude<keyof (typeof LABELS)['en'], 'exportMenu' | 'total'>;

const COLUMNS: Record<Kind, LabelKey[]> = {
  summary: ['figure', 'value', 'records'],
  reports: [
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
  ],
  collections: [
    'collectionId',
    'branchCode',
    'branchName',
    'weekStart',
    'collectedOn',
    'purpose',
    'amount',
    'routedAt',
  ],
  unrouted: [
    'branchCode',
    'branchName',
    'weekStart',
    'collectedOn',
    'purpose',
    'amount',
    'approvedAt',
    'daysWaiting',
  ],
};

// Summary rows follow the dashboard order: money figures, then counts.
const SUMMARY_ORDER = [
  'collected',
  'approved',
  'pending_approval',
  'in_progress',
  'not_yet_routed',
  'routed',
  'active_branches',
  'reports_awaiting_review',
];

type FigureValue = { value: string; recordCount: number };
type Summary = { figures: Record<string, FigureValue> };

/** RFC 4180 records (quoted fields may hold commas, quotes and line breaks). */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
    } else field += ch;
  }
  if (field !== '' || record.length > 0) throw new Error('CSV does not end with CRLF');
  return records;
}

async function api<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

async function download(page: Page, menu: string, kind: Kind, project: string): Promise<Buffer> {
  const link = page.locator(`main a[download][href^="/api/v1/exports/${kind}"]`);
  // The menu is a native disclosure; it stays open after a download.
  if (!(await link.isVisible())) await page.locator('main summary', { hasText: menu }).click();
  await expect(link).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(file.suggestedFilename()).toMatch(new RegExp(`^shiplens-${kind}-.*\\.csv$`));
  mkdirSync('test-results/downloads', { recursive: true });
  const target = `test-results/downloads/${project}-${kind}.csv`;
  await file.saveAs(target);
  return readFileSync(target);
}

test.describe('CSV downloads from the dashboard', () => {
  test(
    'each export opens with the BOM, localized headers and the on-screen total',
    { tag: '@desktop' },
    async ({ page, loginAs, localePath, uiLocale }, testInfo) => {
      const labels = LABELS[uiLocale];
      await loginAs('finance_reviewer');
      await page.goto(localePath('/dashboard'));
      await expect(page.getByText(labels.exportMenu)).toBeVisible();

      const summary = await api<Summary>(page, '/api/v1/dashboard/summary');
      const unrouted = await api<{ totalAmount: string; total: number }>(
        page,
        '/api/v1/dashboard/unrouted?pageSize=1',
      );
      const approved = summary.figures.approved!;

      for (const kind of KINDS) {
        const bytes = await download(page, labels.exportMenu, kind, testInfo.project.name);
        expect([...bytes.subarray(0, 3)], `${kind} BOM`).toEqual([0xef, 0xbb, 0xbf]);
        const records = parseCsv(bytes.subarray(3).toString('utf8'));
        const header = records[0]!;
        expect(header, `${kind} header`).toEqual(COLUMNS[kind].map((key) => labels[key]));
        const col = (key: LabelKey) => header.indexOf(labels[key]);

        if (kind === 'summary') {
          const rows = records.slice(1);
          expect(rows).toHaveLength(SUMMARY_ORDER.length);
          SUMMARY_ORDER.forEach((id, i) => {
            const figure = summary.figures[id]!;
            expect(rows[i]![col('value')], id).toBe(figure.value);
            expect(rows[i]![col('records')], `${id} records`).toBe(String(figure.recordCount));
          });
          continue;
        }

        const totalRow = records.at(-1)!;
        expect(totalRow[0], `${kind} total label`).toBe(labels.total);
        const dataRows = records.slice(1, -1);
        switch (kind) {
          case 'reports':
            expect(totalRow[col('amount')]).toBe(approved.value);
            expect(totalRow[col('collections')]).toBe(String(approved.recordCount));
            break;
          case 'collections':
            expect(totalRow[col('amount')]).toBe(approved.value);
            expect(dataRows).toHaveLength(approved.recordCount);
            break;
          case 'unrouted':
            expect(totalRow[col('amount')]).toBe(summary.figures.not_yet_routed!.value);
            expect(totalRow[col('amount')]).toBe(unrouted.totalAmount);
            expect(dataRows).toHaveLength(unrouted.total);
            break;
        }
      }
    },
  );

  test(
    'export links carry the month filter and the page locale',
    { tag: '@desktop' },
    async ({ page, loginAs, localePath, uiLocale }) => {
      await loginAs('super_admin');
      await page.goto(`${localePath('/dashboard')}?from=2026-09&to=2026-10`);
      const links = page.locator('main a[download][href^="/api/v1/exports/"]');
      await expect(links).toHaveCount(KINDS.length);
      for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')))) {
        expect(href).toContain('from=2026-09');
        expect(href).toContain('to=2026-10');
        expect(href).toContain(`locale=${uiLocale}`);
      }
      const filtered = await api<Summary>(
        page,
        '/api/v1/dashboard/summary?from=2026-09&to=2026-10',
      );
      const bytes = await page.request.get(
        `/api/v1/exports/reports?from=2026-09&to=2026-10&locale=${uiLocale}`,
      );
      expect(bytes.status()).toBe(200);
      const records = parseCsv((await bytes.body()).subarray(3).toString('utf8'));
      const header = records[0]!;
      expect(records.at(-1)![header.indexOf(LABELS[uiLocale].amount)]).toBe(
        filtered.figures.approved!.value,
      );
    },
  );
});

test.describe('CSV access', () => {
  const DENIED: Role[] = ['branch_lead', 'hr_lead', 'content_editor'];
  for (const role of DENIED) {
    test(
      `${role} gets 403 from every export URL`,
      { tag: '@desktop' },
      async ({ page, loginAs }) => {
        await loginAs(role);
        for (const kind of KINDS) {
          const response = await page.request.get(`/api/v1/exports/${kind}`, {
            failOnStatusCode: false,
          });
          expect(response.status(), kind).toBe(403);
        }
      },
    );
  }
});
