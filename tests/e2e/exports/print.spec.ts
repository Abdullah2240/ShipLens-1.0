import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';
import type { Role } from '../support/roles';

// Print-to-PDF for head office (EXP-03). The printed figures are compared with the
// dashboard and trace APIs in the same session. Clicking "Save as PDF" only appends an
// export.create audit row (no shared record changes), so it runs in both desktop
// projects; window.print is stubbed so no dialog opens. Specs cannot import app code,
// so visible strings are pinned here (messages/<locale>/{exports,shell}.json).

const TEXT = {
  en: { button: 'Save as PDF', notFound: 'We could not find that page' },
  ur: { button: 'PDF محفوظ کریں', notFound: 'یہ صفحہ نہیں مل سکا' },
} as const satisfies Record<UiLocale, unknown>;

function group(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
/** Mirrors formatMoney: Latin digits, "PKR " prefix, two decimals, same in both locales. */
function money(amount: string): string {
  const [whole = '0', cents = '00'] = amount.replace(/^-/, '').split('.');
  return `PKR ${group(whole)}.${cents.padEnd(2, '0')}`;
}
function int(value: string | number): string {
  return group(String(value));
}

type FigureValue = { value: string; recordCount: number; measure: 'amount' | 'count' };
type Summary = { figures: Record<string, FigureValue> };
type Trend = {
  months: { month: string }[];
  totals: { approved: string; pendingApproval: string; inProgress: string; collected: string };
};
type TraceLevel = {
  total: string;
  recordCount: number;
  rows: { branchId?: string; reportId?: string; recordCount: number }[];
};
type AuditItem = { id: string; action: string; actorRole: string; after: Record<string, unknown> };

// Dashboard order of the figures table (money figures, then counts).
const FIGURE_ORDER = [
  'collected',
  'approved',
  'pending_approval',
  'in_progress',
  'not_yet_routed',
  'routed',
  'active_branches',
  'reports_awaiting_review',
];

async function api<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: number };
    w.__prints = 0;
    window.print = () => {
      w.__prints += 1;
    };
  });
}

async function printCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __prints: number }).__prints);
}

async function newestExportId(page: Page): Promise<bigint> {
  const audit = await api<{ items: AuditItem[] }>(
    page,
    '/api/v1/audit?action=export.create&entity=export&limit=1',
  );
  return BigInt(audit.items[0]?.id ?? '0');
}

/** An approved report with collections, found through the drill-down API. */
async function approvedReport(page: Page): Promise<{ branchId: string; reportId: string }> {
  const byBranch = await api<TraceLevel>(page, '/api/v1/trace/approved');
  const branchId = byBranch.rows.find((r) => r.recordCount > 0)?.branchId;
  expect(branchId, 'a branch with approved collections').toBeTruthy();
  const reports = await api<TraceLevel>(page, `/api/v1/trace/approved/branches/${branchId}`);
  const reportId = reports.rows.find((r) => r.recordCount > 0)?.reportId;
  expect(reportId, 'an approved report with collections').toBeTruthy();
  return { branchId: branchId!, reportId: reportId! };
}

function savePdf(name: string, pdf: Buffer) {
  mkdirSync('test-results/print', { recursive: true });
  writeFileSync(`test-results/print/${name}.pdf`, pdf);
}

test.describe('printable summary', () => {
  test('printed totals equal the dashboard API', async ({
    page,
    loginAs,
    localePath,
  }, testInfo) => {
    await loginAs('finance_reviewer');
    const response = await page.goto(localePath('/dashboard/print'));
    expect(response?.status()).toBe(200);
    const sheet = page.locator('article[data-print-sheet]');
    await expect(sheet.getByRole('heading', { level: 1 })).toBeVisible();

    const [summary, trend, byBranch] = await Promise.all([
      api<Summary>(page, '/api/v1/dashboard/summary'),
      api<Trend>(page, '/api/v1/dashboard/trend'),
      api<TraceLevel>(page, '/api/v1/trace/approved'),
    ]);
    const tables = sheet.locator('table');
    await expect(tables).toHaveCount(3);

    // Figures: one row per figure in dashboard order, value then record count.
    const figureRows = tables.nth(0).locator('tbody tr');
    await expect(figureRows).toHaveCount(FIGURE_ORDER.length);
    for (const [i, id] of FIGURE_ORDER.entries()) {
      const figure = summary.figures[id]!;
      const cells = figureRows.nth(i).locator('td');
      await expect(cells.nth(0), id).toHaveText(
        figure.measure === 'amount' ? money(figure.value) : int(figure.value),
      );
      await expect(cells.nth(1), `${id} records`).toHaveText(int(figure.recordCount));
    }
    await expect(sheet.locator('[data-identity="collected"]')).toHaveAttribute(
      'data-holds',
      'true',
    );
    await expect(sheet.locator('[data-identity="approved"]')).toHaveAttribute('data-holds', 'true');

    // Approved by branch: total row equals the Approved figure and the drill-down level.
    const branchTable = tables.nth(1);
    await expect(branchTable.locator('tbody tr')).toHaveCount(byBranch.rows.length);
    const branchTotal = branchTable.locator('tfoot td').last();
    await expect(branchTotal).toHaveText(money(summary.figures.approved!.value));
    expect(byBranch.total).toBe(summary.figures.approved!.value);
    await expect(branchTable.locator('tfoot td').nth(2)).toHaveText(
      int(summary.figures.approved!.recordCount),
    );

    // Monthly: one row per trend month, totals equal the trend totals.
    const monthTable = tables.nth(2);
    await expect(monthTable.locator('tbody tr')).toHaveCount(trend.months.length);
    const monthTotals = monthTable.locator('tfoot td');
    await expect(monthTotals.nth(0)).toHaveText(money(trend.totals.approved));
    await expect(monthTotals.nth(1)).toHaveText(money(trend.totals.pendingApproval));
    await expect(monthTotals.nth(2)).toHaveText(money(trend.totals.inProgress));
    await expect(monthTotals.nth(3)).toHaveText(money(trend.totals.collected));
    expect(trend.totals.collected).toBe(summary.figures.collected!.value);

    await expect(sheet.locator('[data-unrouted]')).toContainText(
      money(summary.figures.not_yet_routed!.value),
    );

    await page.screenshot({
      path: `test-results/screens/exports/${testInfo.project.name}-print-summary.png`,
      fullPage: true,
    });
    if (testInfo.project.name.startsWith('mobile')) {
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(innerWidth + 1);
    }
  });

  test('the dashboard print link keeps the filters', async ({ page, loginAs, localePath }) => {
    await loginAs('finance_reviewer');
    await page.goto(`${localePath('/dashboard')}?from=2026-09&to=2026-10`);
    const link = page.locator(
      `main a[href="${localePath('/dashboard/print')}?from=2026-09&to=2026-10"]`,
    );
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/dashboard\/print\?from=2026-09&to=2026-10$/);
    const summary = await api<Summary>(page, '/api/v1/dashboard/summary?from=2026-09&to=2026-10');
    await expect(
      page
        .locator('article[data-print-sheet] table')
        .nth(0)
        .locator('tbody tr')
        .nth(1)
        .locator('td')
        .first(),
    ).toHaveText(money(summary.figures.approved!.value));
  });

  test(
    'Save as PDF records one print_summary export, then opens the print dialog',
    { tag: '@desktop' },
    async ({ page, loginAs, localePath, uiLocale }) => {
      const user = await loginAs('finance_reviewer');
      await stubPrint(page);
      await page.goto(localePath('/dashboard/print'));
      const sheet = page.locator('article[data-print-sheet]');
      await expect(sheet).toBeVisible();
      const rows = await sheet.locator('tbody tr').count();
      const before = await newestExportId(page);

      await page.getByRole('button', { name: TEXT[uiLocale].button }).click();
      await expect.poll(() => printCalls(page)).toBe(1);

      const audit = await api<{ items: AuditItem[] }>(
        page,
        '/api/v1/audit?action=export.create&entity=export&limit=50',
      );
      const mine = audit.items.filter(
        (item) =>
          BigInt(item.id) > before &&
          item.after.kind === 'print_summary' &&
          item.after.row_count === rows &&
          item.actorRole === 'finance_reviewer',
      );
      expect(mine.length, `a new print_summary event by ${user.name}`).toBeGreaterThanOrEqual(1);
      // Only the kind and the row count are recorded.
      expect(Object.keys(mine[0]!.after).sort()).toEqual(['kind', 'row_count']);
      expect(await printCalls(page)).toBe(1);
    },
  );

  test(
    'in print the app chrome disappears and the sheet is black on white',
    { tag: '@desktop' },
    async ({ page, loginAs, localePath }, testInfo) => {
      await loginAs('super_admin');
      await page.goto(localePath('/dashboard/print'));
      await expect(page.getByRole('banner')).toBeVisible();
      await page.emulateMedia({ media: 'print' });
      await expect(page.getByRole('banner')).toBeHidden();
      await expect(page.getByRole('button', { name: /PDF/ })).toBeHidden();
      await expect(page.locator('article[data-print-sheet]')).toBeVisible();
      const colours = await page.evaluate(() => {
        const sheet = document.querySelector('article[data-print-sheet]')!;
        const h1 = sheet.querySelector('h1')!;
        return {
          body: getComputedStyle(document.body).backgroundColor,
          sheet: getComputedStyle(sheet).backgroundColor,
          text: getComputedStyle(h1).color,
        };
      });
      expect(colours.body).toBe('rgb(255, 255, 255)');
      expect(colours.sheet).toBe('rgb(255, 255, 255)');
      expect(colours.text).toBe('rgb(0, 0, 0)');

      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      expect(pdf.byteLength).toBeGreaterThan(1000);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      savePdf(`${testInfo.project.name}-summary`, pdf);
    },
  );
});

test.describe('printable weekly report', () => {
  test('header, collections and total match the drill-down', async ({
    page,
    loginAs,
    localePath,
  }, testInfo) => {
    await loginAs('finance_reviewer');
    const { branchId, reportId } = await approvedReport(page);
    const level = await api<TraceLevel & { report: { frozenAmount: string } }>(
      page,
      `/api/v1/trace/approved/branches/${branchId}/reports/${reportId}`,
    );
    const response = await page.goto(localePath(`/dashboard/print/reports/${reportId}`));
    expect(response?.status()).toBe(200);
    const sheet = page.locator('article[data-print-sheet]');
    await expect(sheet.locator('[data-report-status="approved"]')).toBeVisible();
    await expect(sheet.locator('[data-live-total]')).toHaveText(money(level.total));
    await expect(sheet.locator('[data-frozen-total]')).toHaveText(money(level.report.frozenAmount));
    const collections = sheet.locator('table').first();
    await expect(collections.locator('tbody tr')).toHaveCount(level.recordCount);
    await expect(collections.locator('tfoot td').last()).toHaveText(money(level.total));
    await page.screenshot({
      path: `test-results/screens/exports/${testInfo.project.name}-print-report.png`,
      fullPage: true,
    });
  });

  test(
    'saves as a non-empty A4 PDF in English and Urdu',
    { tag: '@desktop' },
    async ({ page, loginAs }, testInfo) => {
      await loginAs('finance_reviewer');
      const { reportId } = await approvedReport(page);
      for (const locale of ['en', 'ur'] as const) {
        await page.goto(`/${locale}/dashboard/print/reports/${reportId}`);
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
        await expect(page.locator('article[data-print-sheet]')).toBeVisible();
        await page.emulateMedia({ media: 'print' });
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        expect(pdf.byteLength, `${locale} pdf size`).toBeGreaterThan(1000);
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        savePdf(`${testInfo.project.name}-report-${locale}`, pdf);
        await page.emulateMedia({ media: 'screen' });
      }
    },
  );

  test(
    'Save as PDF records one print_report export',
    { tag: '@desktop' },
    async ({ page, loginAs, localePath, uiLocale }) => {
      await loginAs('super_admin');
      const { reportId } = await approvedReport(page);
      await stubPrint(page);
      await page.goto(localePath(`/dashboard/print/reports/${reportId}`));
      const sheet = page.locator('article[data-print-sheet]');
      await expect(sheet).toBeVisible();
      const rows = await sheet.locator('tbody tr').count();
      const before = await newestExportId(page);
      await page.getByRole('button', { name: TEXT[uiLocale].button }).click();
      await expect.poll(() => printCalls(page)).toBe(1);
      const audit = await api<{ items: AuditItem[] }>(
        page,
        '/api/v1/audit?action=export.create&entity=export&limit=50',
      );
      expect(
        audit.items.some(
          (item) =>
            BigInt(item.id) > before &&
            item.after.kind === 'print_report' &&
            item.after.row_count === rows &&
            item.actorRole === 'super_admin',
        ),
      ).toBe(true);
    },
  );
});

test.describe('print access', () => {
  const DENIED: Role[] = ['branch_lead', 'hr_lead', 'content_editor'];
  for (const role of DENIED) {
    test(
      `${role} gets the not-found page and 403 on the print audit endpoint`,
      { tag: '@desktop' },
      async ({ page, loginAs, localePath, uiLocale, baseURL }) => {
        await loginAs(role);
        const response = await page.goto(localePath('/dashboard/print'));
        // 404, or 200 when the loading shell was already streamed before the refusal.
        expect([200, 404]).toContain(response?.status());
        await expect(page.getByRole('heading', { name: TEXT[uiLocale].notFound })).toBeVisible();
        await expect(page.locator('article[data-print-sheet]')).toHaveCount(0);

        const post = await page.request.post('/api/v1/exports/print', {
          headers: { Origin: new URL(baseURL!).origin },
          data: { kind: 'print_summary', rowCount: 1 },
          failOnStatusCode: false,
        });
        expect(post.status()).toBe(403);
      },
    );
  }
});
