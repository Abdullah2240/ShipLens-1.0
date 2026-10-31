import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../support/fixtures';

// Drill-down levels 3 (report -> collections) and 4 (collection evidence), compared with
// the trace API in the same session. Read-only, so it runs in every project. Ids come
// from GET /api/v1/trace/approved and its first branch, never from the level 1 and 2
// pages. Specs cannot import app code: `money` mirrors formatMoney (Latin digits, 3-digit
// grouping, "PKR " prefix, two decimals).

function group(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function money(amount: string): string {
  const [whole = '0', cents = '00'] = amount.replace(/^-/, '').split('.');
  return `PKR ${group(whole)}.${cents.padEnd(2, '0')}`;
}

type TrailStep = { kind: string; href: string; value: string; measure: 'amount' | 'count' };
type BranchRow = { branchId: string; value: string; href: string };
type ReportRow = { reportId: string; value: string; href: string; recordCount: number };
type CollectionRow = { collectionId: string; collectedOn: string; amount: string; href: string };
type Level<R> = {
  rows: R[];
  total: string;
  parentValue: string;
  matchesParent: boolean;
  trail: TrailStep[];
};
type ReportHeader = {
  reportId: string;
  status: string;
  frozenMatchesLive: boolean | null;
  reviewedByName: string | null;
};
type Level3 = Level<CollectionRow> & { report: ReportHeader };
type TimelineEntry = { id: string; action: string; requestId: string | null };
type Evidence = {
  collection: { collectionId: string; amount: string };
  collectionTimeline: TimelineEntry[];
  reportTimeline: TimelineEntry[];
  trail: TrailStep[];
};

// The not-found page title (messages shell.notFound.title).
const NOT_FOUND = { en: 'We could not find that page', ur: 'یہ صفحہ نہیں مل سکا' } as const;
// common.status labels for the approval change.
const STATUS = {
  en: { submitted: 'Submitted', approved: 'Approved' },
  ur: { submitted: 'جمع شدہ', approved: 'منظور شدہ' },
} as const;

async function api<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

/** Approved -> first branch -> first report, as the trace API returns them. */
async function approvedChain(page: Page, query = '') {
  const l1 = await api<Level<BranchRow>>(page, `/api/v1/trace/approved${query}`);
  const branch = l1.rows[0];
  expect(branch, 'an approved branch in the demo data').toBeDefined();
  const l2 = await api<Level<ReportRow>>(
    page,
    `/api/v1/trace/approved/branches/${branch!.branchId}${query}`,
  );
  const report = l2.rows[0];
  expect(report, 'an approved report in that branch').toBeDefined();
  const l3 = await api<Level3>(
    page,
    `/api/v1/trace/approved/branches/${branch!.branchId}/reports/${report!.reportId}${query}`,
  );
  return { l1, branch: branch!, l2, report: report!, l3 };
}

function trail(page: Page) {
  return page.locator('nav').filter({ has: page.locator('[data-trail-separator]') });
}

async function expectTrailValues(page: Page, steps: TrailStep[]) {
  const crumbs = trail(page).locator('ol > li');
  await expect(crumbs).toHaveCount(steps.length);
  // The dashboard crumb carries no value; every other crumb shows its level's value.
  for (const [index, step] of steps.entries()) {
    if (index === 0 || step.measure !== 'amount') continue;
    await expect(crumbs.nth(index), `${step.kind} crumb value`).toContainText(money(step.value));
  }
}

async function notFoundShown(page: Page, path: string, locale: 'en' | 'ur') {
  const response = await page.goto(path);
  // 404, or 200 when the loading shell was already streamed before the refusal.
  expect([200, 404]).toContain(response?.status());
  await expect(page.getByRole('heading', { name: NOT_FOUND[locale] })).toBeVisible();
  await expect(page.locator('[data-total="frozen"]')).toHaveCount(0);
}

async function expectNoOverflow(page: Page, testInfo: TestInfo) {
  if (!testInfo.project.name.startsWith('mobile')) return;
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(innerWidth + 1);
}

test.describe('drill-down levels 3 and 4', () => {
  test('level 3 reconciles with level 2 and shows the report summary and events', async ({
    page,
    loginAs,
    localePath,
  }, testInfo) => {
    await loginAs('finance_reviewer');
    const { report, l3 } = await approvedChain(page);

    const response = await page.goto(localePath(report.href));
    expect(response?.status(), 'GET level 3').toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Footer total equals the report's value one level up, with the Matches pill.
    expect(l3.total, 'API level 3 total equals the level 2 row').toBe(report.value);
    const foot = page.locator('main tfoot');
    await expect(foot).toContainText(money(report.value));
    await expect(foot.locator('[data-tone="success"]')).toBeVisible();
    await expect(page.locator('main tbody tr')).toHaveCount(l3.rows.length);

    // Report summary: frozen equals live for an approved report.
    expect(l3.report.frozenMatchesLive).toBe(true);
    await expect(page.locator('[data-totals="match"]')).toBeVisible();
    await expect(page.locator('[data-total="frozen"]')).toContainText(money(report.value));

    // Report events end with the approval by the reviewer the API names.
    const approval = page.locator('li[data-event-type="approved"]');
    await expect(approval).toHaveCount(1);
    expect(l3.report.reviewedByName).toBeTruthy();
    await expect(approval).toContainText(l3.report.reviewedByName ?? '');

    // Print and export links.
    await expect(page.locator('a[data-action="print"]')).toHaveAttribute(
      'href',
      localePath(`/dashboard/print/reports/${report.reportId}`),
    );
    await expect(page.locator('a[data-action="export"]')).toHaveAttribute(
      'href',
      new RegExp(`^/api/v1/exports/collections\\?figure=approved&reportId=${report.reportId}&`),
    );

    await expectTrailValues(page, l3.trail);
    await page.screenshot({
      path: `test-results/screens/drilldown/${testInfo.project.name}-level3.png`,
      fullPage: true,
    });
    await expectNoOverflow(page, testInfo);
  });

  test('level 4 shows the collection and its audit evidence', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }, testInfo) => {
    await loginAs('finance_reviewer');
    const { report, l3 } = await approvedChain(page);
    const row = l3.rows[0];
    expect(row, 'a collection in the approved report').toBeDefined();

    await page.goto(localePath(report.href));
    await page.locator(`main tbody a[href="${localePath(row!.href)}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${row!.collectionId}$`));

    const evidence = await api<Evidence>(
      page,
      `/api/v1/trace${row!.href.slice('/dashboard/kpi'.length)}`,
    );
    expect(evidence.collection.amount).toBe(row!.amount);
    await expect(page.locator('[data-fact="amount"]')).toContainText(money(row!.amount));
    await expectTrailValues(page, evidence.trail);

    // The collection's creation, recorded by the demo data load.
    const created = evidence.collectionTimeline.find((e) => e.action === 'collection.create');
    expect(created, 'collection.create in the collection timeline').toBeDefined();
    expect(created!.requestId).toBe('seed:demo-data');
    const createdItem = page.locator(
      `[data-timeline="collection"] li[data-entry-id="${created!.id}"]`,
    );
    await expect(createdItem).toBeVisible();
    const createdToggle = createdItem.locator('summary');
    if ((await createdToggle.count()) > 0) await createdToggle.click();
    await expect(createdItem).toContainText('seed:demo-data');

    // The report's approval, expanded to its status change.
    const approved = evidence.reportTimeline.find((e) => e.action === 'report.approve');
    expect(approved, 'report.approve in the report timeline').toBeDefined();
    const approvedItem = page.locator(
      `[data-timeline="report"] li[data-entry-id="${approved!.id}"]`,
    );
    await expect(approvedItem).toBeVisible();
    await approvedItem.locator('summary').click();
    const status = approvedItem.locator('[data-change="status"]');
    await expect(status).toBeVisible();
    await expect(status).toContainText(STATUS[uiLocale].submitted);
    await expect(status).toContainText(STATUS[uiLocale].approved);

    await expect(page.locator('a[data-audit-link="collection"]')).toHaveAttribute(
      'href',
      localePath(`/audit?entity=collection&entityId=${row!.collectionId}`),
    );

    await page.screenshot({
      path: `test-results/screens/drilldown/${testInfo.project.name}-level4.png`,
      fullPage: true,
    });
    await expectNoOverflow(page, testInfo);
  });

  test('the trail carries every level value and keeps the month filter', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('super_admin');
    const unfiltered = await approvedChain(page);
    const month = unfiltered.l3.rows[0]?.collectedOn.slice(0, 7);
    expect(month, 'a month with an approved collection').toBeTruthy();
    const query = `?from=${month}&to=${month}`;

    const branchId = unfiltered.branch.branchId;
    const reportId = unfiltered.report.reportId;
    const l3 = await api<Level3>(
      page,
      `/api/v1/trace/approved/branches/${branchId}/reports/${reportId}${query}`,
    );
    expect(l3.matchesParent).toBe(true);
    await page.goto(
      localePath(`/dashboard/kpi/approved/branches/${branchId}/reports/${reportId}`) + query,
    );
    await expect(page.locator('main tfoot')).toContainText(money(l3.total));
    await expectTrailValues(page, l3.trail);

    const crumbs = trail(page).locator('ol > li');
    for (const [index, step] of l3.trail.slice(0, -1).entries()) {
      await expect(crumbs.nth(index).locator('a')).toHaveAttribute('href', localePath(step.href));
      if (index > 0) expect(step.href, `${step.kind} crumb keeps the filter`).toContain(query);
    }

    // The figure crumb goes back to level 1 with the same filters.
    const figure = l3.trail[1]!;
    await crumbs.nth(1).locator('a').click();
    await expect(page).toHaveURL(
      (url) => `${url.pathname}${url.search}` === localePath(figure.href),
    );
  });

  test('broken paths and other roles get the not-found page', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('finance_reviewer');
    const { l1, l2, branch, report } = await approvedChain(page);
    const valid = localePath(report.href);

    // A draft report under the approved figure.
    const drafts = await api<{ items: { id: string; branchId: string }[] }>(
      page,
      '/api/v1/reports?status=draft',
    );
    const draft = drafts.items[0];
    expect(draft, 'a draft report').toBeDefined();
    await notFoundShown(
      page,
      localePath(`/dashboard/kpi/approved/branches/${draft!.branchId}/reports/${draft!.id}`),
      uiLocale,
    );

    // A collection of another approved report under this report.
    let otherReport = l2.rows[1];
    let otherBranch = branch.branchId;
    if (!otherReport) {
      const next = l1.rows[1];
      expect(next, 'a second approved report').toBeDefined();
      otherBranch = next!.branchId;
      const otherL2 = await api<Level<ReportRow>>(
        page,
        `/api/v1/trace/approved/branches/${otherBranch}`,
      );
      otherReport = otherL2.rows[0];
    }
    const otherL3 = await api<Level3>(
      page,
      `/api/v1/trace/approved/branches/${otherBranch}/reports/${otherReport!.reportId}`,
    );
    const foreign = otherL3.rows[0];
    expect(foreign, 'a collection in the other report').toBeDefined();
    await notFoundShown(page, `${valid}/collections/${foreign!.collectionId}`, uiLocale);

    // Bogus figure slug.
    await notFoundShown(
      page,
      localePath(`/dashboard/kpi/bogus/branches/${branch.branchId}/reports/${report.reportId}`),
      uiLocale,
    );

    // A branch lead cannot open head office evidence.
    await loginAs('branch_lead');
    await notFoundShown(page, valid, uiLocale);
  });
});
