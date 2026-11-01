import type { Page, TestInfo } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';

// The Core Value walked end to end in every project: as Finance, dashboard -> Approved ->
// the largest branch -> its most recent approved report -> its first collection -> the
// approval event expanded. Every level is compared with the trace API in the same session:
// the footer equals the value clicked one level up, the trail carries every level's value,
// and the "How is this calculated" drawer opens and closes at each level. Read-only.
// Specs cannot import app code: `money` mirrors formatMoney (Latin digits, 3-digit
// grouping, "PKR " prefix, two decimals); visible strings are pinned from messages/.

function group(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function money(amount: string): string {
  const [whole = '0', cents = '00'] = amount.replace(/^-/, '').split('.');
  return `PKR ${group(whole)}.${cents.padEnd(2, '0')}`;
}
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function firstInt(text: string): string {
  const match = /\d[\d,]*/.exec(text);
  if (!match) throw new Error(`no number in "${text}"`);
  return match[0].replace(/,/g, '');
}

type TrailStep = { kind: string; href: string; value: string; measure: 'amount' | 'count' };
type FigureValue = { value: string; recordCount: number; measure: 'amount' | 'count' };
type Summary = { figures: Record<string, FigureValue> };
type BranchRow = { branchId: string; value: string; recordCount: number; href: string };
type ReportRow = { reportId: string; weekStart: string; value: string; href: string };
type CollectionRow = { collectionId: string; amount: string; href: string };
type Level<R> = {
  parentValue: string;
  total: string;
  recordCount: number;
  matchesParent: boolean;
  rows: R[];
  trail: TrailStep[];
};
type TimelineEntry = { id: string; action: string };
type Evidence = {
  collection: { collectionId: string; amount: string };
  reportTimeline: TimelineEntry[];
  trail: TrailStep[];
};

// trace.figures.approved.definition (first words) and common.status labels.
const DEFINITION = {
  en: 'Money in collections whose weekly report has been approved',
  ur: 'ان وصولیوں کی رقم جن کی ہفتہ وار رپورٹ',
} as const satisfies Record<UiLocale, string>;
const STATUS = {
  en: { submitted: 'Submitted', approved: 'Approved' },
  ur: { submitted: 'جمع شدہ', approved: 'منظور شدہ' },
} as const satisfies Record<UiLocale, unknown>;

async function api<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

/** The API path of a trace row's locale-less /dashboard/kpi href. */
const traceApi = (href: string) => `/api/v1/trace${href.slice('/dashboard/kpi'.length)}`;

const headline = (page: Page) => page.locator('main h1 + p');

function footer(page: Page) {
  const foot = page.locator('main tfoot');
  return {
    foot,
    count: foot.locator('th > span > span').first(),
    pill: foot.locator('[data-tone]').first(),
  };
}

/** The trail has one crumb per level and every crumb after Dashboard shows its value. */
async function expectTrail(page: Page, steps: TrailStep[], localePath: (p: string) => string) {
  const crumbs = page.locator('main nav:has([data-trail-separator]) ol > li');
  await expect(crumbs).toHaveCount(steps.length);
  for (const [index, step] of steps.entries()) {
    if (index > 0 && step.measure === 'amount') {
      await expect(crumbs.nth(index), `${step.kind} crumb value`).toContainText(money(step.value));
    }
    if (index < steps.length - 1) {
      await expect(crumbs.nth(index).locator('a')).toHaveAttribute('href', localePath(step.href));
    } else {
      await expect(crumbs.nth(index).locator('[aria-current="page"]')).toHaveCount(1);
    }
  }
}

/** Opens the level's explain drawer from the keyboard, checks it and closes it with Escape. */
async function expectExplain(page: Page, value: string, definition?: string) {
  const trigger = page.locator('main header button[aria-haspopup="dialog"]').first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toContainText(money(value));
  if (definition) await expect(dialog).toContainText(definition);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

async function expectNoOverflow(page: Page, testInfo: TestInfo) {
  if (!testInfo.project.name.startsWith('mobile')) return;
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(clientWidth + 1);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `test-results/screens/walk/${testInfo.project.name}-${name}.png`,
    fullPage: true,
  });
}

test.describe('Core Value walk', () => {
  test('dashboard -> approved -> branch -> report -> collection -> approval event', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }, testInfo) => {
    test.setTimeout(120_000);
    await loginAs('finance_reviewer');

    // Dashboard: the Approved card links to level 1.
    expect((await page.goto(localePath('/dashboard')))?.status(), 'GET /dashboard').toBe(200);
    const summary = await api<Summary>(page, '/api/v1/dashboard/summary');
    const approved = summary.figures.approved;
    expect(approved, 'approved in the summary').toBeDefined();
    const l1Href = localePath('/dashboard/kpi/approved');
    const card = page.locator(`main a[href="${l1Href}"]`).filter({ visible: true }).first();
    await expect(card).toHaveAccessibleName(new RegExp(escape(money(approved!.value))));
    await shot(page, testInfo, '0-dashboard');
    await expectNoOverflow(page, testInfo);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`${escape(l1Href)}$`));

    // Level 1: figure by branch. Footer = dashboard figure, with its record count.
    const l1 = await api<Level<BranchRow>>(page, '/api/v1/trace/approved');
    expect(l1.matchesParent).toBe(true);
    expect(l1.parentValue).toBe(approved!.value);
    expect(l1.total).toBe(approved!.value);
    await expect(headline(page)).toHaveText(money(approved!.value));
    const foot1 = footer(page);
    await expect(foot1.foot).toContainText(money(approved!.value));
    await expect(foot1.pill).toHaveAttribute('data-tone', 'success');
    expect(firstInt(await foot1.count.innerText())).toBe(String(approved!.recordCount));
    await expectTrail(page, l1.trail, localePath);
    await expectExplain(page, approved!.value, DEFINITION[uiLocale]);
    await shot(page, testInfo, '1-figure');
    await expectNoOverflow(page, testInfo);

    // The largest branch: rows are ordered by value, largest first.
    const branch = [...l1.rows].sort((a, b) => {
      const va = BigInt(a.value.replace('.', ''));
      const vb = BigInt(b.value.replace('.', ''));
      return va === vb ? 0 : va > vb ? -1 : 1;
    })[0];
    expect(branch, 'an approved branch in the demo data').toBeDefined();
    const branchLink = page.locator(`main tbody tr a[href="${localePath(branch!.href)}"]`);
    await expect(branchLink).toContainText(money(branch!.value));
    await branchLink.click();
    await expect(page).toHaveURL(new RegExp(`/branches/${branch!.branchId}$`));

    // Level 2: the branch's approved reports. Footer = the branch value clicked.
    const l2 = await api<Level<ReportRow>>(page, traceApi(branch!.href));
    expect(l2.matchesParent).toBe(true);
    expect(l2.parentValue).toBe(branch!.value);
    expect(l2.total).toBe(branch!.value);
    await expect(headline(page)).toHaveText(money(branch!.value));
    const foot2 = footer(page);
    await expect(foot2.foot).toContainText(money(branch!.value));
    await expect(foot2.pill).toHaveAttribute('data-tone', 'success');
    await expect(page.locator('main tbody tr a[href*="/reports/"]')).toHaveCount(l2.rows.length);
    await expectTrail(page, l2.trail, localePath);
    await expectExplain(page, branch!.value);
    await shot(page, testInfo, '2-branch');
    await expectNoOverflow(page, testInfo);

    // The most recent approved report.
    const report = [...l2.rows].sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
    expect(report, 'an approved report in that branch').toBeDefined();
    const reportLink = page.locator(`main tbody tr a[href="${localePath(report!.href)}"]`);
    await expect(reportLink).toContainText(money(report!.value));
    await reportLink.click();
    await expect(page).toHaveURL(new RegExp(`/reports/${report!.reportId}$`));

    // Level 3: the report's collections. Footer = the report value clicked.
    const l3 = await api<Level<CollectionRow>>(page, traceApi(report!.href));
    expect(l3.matchesParent).toBe(true);
    expect(l3.parentValue).toBe(report!.value);
    expect(l3.total).toBe(report!.value);
    await expect(headline(page)).toHaveText(money(report!.value));
    const foot3 = footer(page);
    await expect(foot3.foot).toContainText(money(report!.value));
    await expect(foot3.pill).toHaveAttribute('data-tone', 'success');
    await expect(page.locator('main tbody tr')).toHaveCount(l3.rows.length);
    await expect(page.locator('[data-total="frozen"]')).toContainText(money(report!.value));
    await expectTrail(page, l3.trail, localePath);
    await expectExplain(page, report!.value);
    await shot(page, testInfo, '3-report');
    await expectNoOverflow(page, testInfo);

    // The first collection.
    const collection = l3.rows[0];
    expect(collection, 'a collection in the approved report').toBeDefined();
    const collectionLink = page.locator(`main tbody a[href="${localePath(collection!.href)}"]`);
    await expect(collectionLink).toBeVisible();
    await collectionLink.click();
    await expect(page).toHaveURL(new RegExp(`/collections/${collection!.collectionId}$`));

    // Level 4: the collection's evidence. Its amount is the row clicked.
    const evidence = await api<Evidence>(page, traceApi(collection!.href));
    expect(evidence.collection.amount).toBe(collection!.amount);
    await expect(headline(page)).toHaveText(money(collection!.amount));
    await expect(page.locator('[data-fact="amount"]')).toContainText(money(collection!.amount));
    await expectTrail(page, evidence.trail, localePath);
    // The trail is the full chain of values clicked on the way down.
    expect(evidence.trail.map((s) => s.value).slice(1)).toEqual([
      approved!.value,
      branch!.value,
      report!.value,
      collection!.amount,
    ]);
    await expectExplain(page, collection!.amount);

    // The approval event, expanded to its status change.
    const approval = evidence.reportTimeline.find((e) => e.action === 'report.approve');
    expect(approval, 'report.approve in the report timeline').toBeDefined();
    const item = page.locator(`[data-timeline="report"] li[data-entry-id="${approval!.id}"]`);
    await expect(item).toBeVisible();
    await item.locator('summary').click();
    const status = item.locator('[data-change="status"]');
    await expect(status).toBeVisible();
    await expect(status).toContainText(STATUS[uiLocale].submitted);
    await expect(status).toContainText(STATUS[uiLocale].approved);
    await shot(page, testInfo, '4-collection');
    await expectNoOverflow(page, testInfo);
  });
});
