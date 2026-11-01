import type { Locator, Page } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';
import { DIR, URDU_DIGITS } from './support/journey';
import {
  escapeRegExp,
  group,
  money,
  moneyIn,
  requireExpected,
  type Figure,
} from './support/expected';

// The Core Value as a Finance Reviewer walks it: a dashboard figure, then the branches
// behind it, one branch's approved reports, one report's collections and one collection's
// audit evidence. At every level the footer total equals the figure clicked one level up.
// The @pristine test pins every figure on the way to db/seed/expected.json and walks back up
// the breadcrumb with a month filter kept in the URL; the @smoke test repeats the walk in
// every project with screen-only identities, so it also runs against a live deployment.
// Read-only. Strings are copied from messages/<locale>/{trace,audit}.json.

const TEXT = {
  // trace.figures.approved.definition (first words), trace.explain.recordCount / asOf.
  definition: 'Money in collections whose weekly report has been approved by a Finance Reviewer',
  recordCount: 'Records counted',
  asOf: 'As of',
  // audit.actions.collection_create / report_approve.
  collectionLogged: 'Collection logged',
  reportApproved: 'Report approved',
} as const;

const headline = (page: Page) => page.locator('main h1 + p');
const footerTotal = (page: Page) => page.locator('main tfoot td[data-measure]').first();
const footerCount = (page: Page) => page.locator('main tfoot th > span > span').first();
const crumbs = (page: Page) => page.locator('main nav:has([data-trail-separator]) ol > li');
const drillLinks = (page: Page, segment: string) =>
  page.locator(`main tbody tr a[href*="/${segment}/"]`).filter({ visible: true });

function firstInt(text: string): number {
  const match = /\d[\d,]*/.exec(text);
  if (!match) throw new Error(`no number in "${text}"`);
  return Number(match[0].replace(/,/g, ''));
}

/** Both the headline and the footer show `value`, and the pill says the footer matches. */
async function expectLevelTotals(page: Page, value: string) {
  await expect(headline(page)).toHaveText(value);
  await expect(footerTotal(page)).toContainText(value);
  await expect(page.locator('main tfoot [data-tone]').first()).toHaveAttribute(
    'data-tone',
    'success',
  );
}

async function linkMoney(link: Locator): Promise<string> {
  return moneyIn((await link.textContent()) ?? '');
}

test.describe('drill-down journey on the demo dataset', { tag: '@pristine' }, () => {
  test('every level from the approved KPI to the audit evidence equals expected.json', async ({
    page,
    loginAs,
    localePath,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-en-light', 'exact walk runs in desktop-en-light');
    test.setTimeout(150_000);
    const expected = requireExpected();
    const approved = expected.kpis.approved as Figure;
    expect(approved, 'expected.kpis.approved').toBeDefined();
    await loginAs('finance_reviewer');

    // Dashboard: the approved card shows the oracle amount and links to its level 1.
    expect((await page.goto(localePath('/dashboard')))?.status()).toBe(200);
    const l1Path = localePath('/dashboard/kpi/approved');
    const card = page.locator(`main a[href="${l1Path}"]`).filter({ visible: true }).first();
    await expect(card).toHaveAccessibleName(new RegExp(escapeRegExp(money(approved.amount))));
    await card.click();
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(l1Path)}$`));

    // Level 1: one row per contributing branch, each equal to expected.byBranch.
    await expectLevelTotals(page, money(approved.amount));
    expect(firstInt(await footerCount(page).innerText()), 'L1 records').toBe(approved.count);
    const branches = Object.entries(expected.byBranch)
      .map(([name, figures]) => ({ name, figure: figures.approved }))
      .filter((b): b is { name: string; figure: Figure } => !!b.figure && b.figure.count > 0);
    const l1Links = drillLinks(page, 'branches');
    await expect(l1Links).toHaveCount(branches.length);
    for (const branch of branches) {
      const row = page.locator('main tbody tr').filter({ hasText: branch.name });
      await expect(row, branch.name).toHaveCount(1);
      await expect(row.locator('a[href*="/branches/"]')).toContainText(money(branch.figure.amount));
    }

    // "How is this calculated": definition, record count and as-of.
    const trigger = page.locator('main header button[aria-haspopup="dialog"]').first();
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(TEXT.definition);
    await expect(dialog).toContainText(money(approved.amount));
    await expect(
      dialog.locator('dt', { hasText: TEXT.recordCount }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText(group(String(approved.count)));
    await expect(dialog.locator('dt', { hasText: TEXT.asOf })).toBeVisible();
    await expect(dialog.locator('time[datetime]')).toHaveAttribute(
      'datetime',
      /^\d{4}-\d{2}-\d{2}T/,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Level 2: the first branch's approved reports, each equal to expected.approvedReports.
    const firstBranch = l1Links.first();
    const firstBranchHref = (await firstBranch.getAttribute('href')) ?? '';
    const branchRowText = await page
      .locator('main tbody tr')
      .filter({ has: page.locator(`a[href="${firstBranchHref}"]`) })
      .innerText();
    const branchName = branches.map((b) => b.name).find((name) => branchRowText.includes(name));
    expect(branchName, 'first L1 row is an expected branch').toBeDefined();
    const branchFigure = expected.byBranch[branchName!]!.approved!;
    await firstBranch.click();
    await expect(page).toHaveURL(/\/dashboard\/kpi\/approved\/branches\/[0-9a-f-]{36}$/);
    await expectLevelTotals(page, money(branchFigure.amount));
    expect(firstInt(await footerCount(page).innerText()), 'L2 records').toBe(branchFigure.count);
    const reports = expected.approvedReports.filter((r) => r.branch === branchName);
    const l2Links = drillLinks(page, 'reports');
    await expect(l2Links).toHaveCount(reports.length);
    for (const report of reports) {
      await expect(
        page.locator(`main tbody tr a[href*="/reports/${report.reportId}"]`),
        `report ${report.weekStart}`,
      ).toContainText(money(report.amount));
    }

    // Level 3: the first report's collections; the footer equals the report row.
    const firstReport = l2Links.first();
    const reportId = /\/reports\/([0-9a-f-]{36})/.exec(
      (await firstReport.getAttribute('href')) ?? '',
    )?.[1];
    const report = reports.find((r) => r.reportId === reportId);
    expect(report, 'first L2 row is an expected approved report').toBeDefined();
    await firstReport.click();
    await expect(page).toHaveURL(new RegExp(`/reports/${reportId}$`));
    await expectLevelTotals(page, money(report!.amount));
    await expect(page.locator('[data-total="frozen"]')).toContainText(money(report!.amount));
    const l3Links = drillLinks(page, 'collections');
    await expect(l3Links).toHaveCount(report!.count);
    expect(firstInt(await footerCount(page).innerText()), 'L3 records').toBe(report!.count);

    // Level 4: the first collection's evidence and both audit timelines.
    const firstCollection = l3Links.first();
    const collectionAmount = await linkMoney(firstCollection);
    await firstCollection.click();
    await expect(page).toHaveURL(/\/collections\/[0-9a-f-]{36}$/);
    await expect(headline(page)).toHaveText(collectionAmount);
    await expect(page.locator('[data-fact="amount"]')).toContainText(collectionAmount);
    await expect(page.locator('[data-timeline="collection"]')).toContainText(TEXT.collectionLogged);
    await expect(page.locator('[data-timeline="report"]')).toContainText(TEXT.reportApproved);
    // The trail carries every value clicked on the way down.
    const trail = crumbs(page);
    await expect(trail).toHaveCount(5);
    await expect(trail.nth(1)).toContainText(money(approved.amount));
    await expect(trail.nth(2)).toContainText(money(branchFigure.amount));
    await expect(trail.nth(3)).toContainText(money(report!.amount));
    await expect(trail.nth(4).locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('a month filter stays in the URL down to the evidence and back up the breadcrumb', async ({
    page,
    loginAs,
    localePath,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-en-light', 'exact walk runs in desktop-en-light');
    test.setTimeout(150_000);
    const expected = requireExpected();
    // The busiest approved month keeps every level populated.
    const [month, figure] = Object.entries(expected.byMonth)
      .map(([m, figures]) => [m, figures.approved] as const)
      .filter((entry): entry is readonly [string, Figure] => !!entry[1])
      .sort((a, b) => b[1].count - a[1].count)[0]!;
    const query = `?from=${month}&to=${month}`;
    const hasQuery = new RegExp(`[?&]from=${month}&to=${month}$`);
    await loginAs('finance_reviewer');

    const l1Path = localePath('/dashboard/kpi/approved');
    expect((await page.goto(`${l1Path}${query}`))?.status()).toBe(200);
    await expectLevelTotals(page, money(figure.amount));
    expect(firstInt(await footerCount(page).innerText()), 'filtered L1 records').toBe(figure.count);

    // Down: every drill link carries the filter, and each footer equals the row clicked.
    const steps = ['branches', 'reports', 'collections'] as const;
    for (const segment of steps) {
      const link = drillLinks(page, segment).first();
      await expect(link).toHaveAttribute('href', hasQuery);
      const value = await linkMoney(link);
      await link.click();
      await expect(page).toHaveURL(hasQuery);
      if (segment === 'collections') {
        await expect(headline(page)).toHaveText(value);
      } else {
        await expectLevelTotals(page, value);
      }
    }

    // Up: every crumb link keeps the filter; the report, branch and figure crumbs lead back.
    const trail = crumbs(page);
    await expect(trail).toHaveCount(5);
    for (const href of await trail
      .locator('a')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''))) {
      expect(href, 'crumb keeps the filter').toMatch(hasQuery);
    }
    await expect(trail.nth(0).locator('a')).toHaveAttribute(
      'href',
      `${localePath('/dashboard')}${query}`,
    );
    for (const [index, pattern] of [
      [3, /\/reports\/[0-9a-f-]{36}\?/],
      [2, /\/branches\/[0-9a-f-]{36}\?/],
      [1, new RegExp(`${escapeRegExp(l1Path)}\\?`)],
    ] as const) {
      await crumbs(page).nth(index).locator('a').click();
      await expect(page).toHaveURL(pattern);
      await expect(page).toHaveURL(hasQuery);
      await expect(footerTotal(page)).toContainText(moneyIn(await headline(page).innerText()));
    }
    await expect(headline(page)).toHaveText(money(figure.amount));
  });
});

test.describe('drill-down journey in every project', { tag: '@smoke' }, () => {
  test('each footer equals the figure clicked one level up', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    test.setTimeout(120_000);
    await loginAs('finance_reviewer');
    expect((await page.goto(localePath('/dashboard')))?.status()).toBe(200);
    await expectLocale(page, uiLocale);

    const l1Path = localePath('/dashboard/kpi/approved');
    const card = page.locator(`main a[href="${l1Path}"]`).filter({ visible: true }).first();
    const cardName = await card.evaluate(
      (el) => el.getAttribute('aria-label') ?? el.textContent ?? '',
    );
    const dashboardValue = moneyIn(cardName);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(l1Path)}$`));
    await expectLevelTotals(page, dashboardValue);
    await expectLocale(page, uiLocale);

    for (const segment of ['branches', 'reports', 'collections'] as const) {
      const link = drillLinks(page, segment).first();
      await expect(link, `a ${segment} row`).toBeVisible();
      const value = await linkMoney(link);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${segment}/[0-9a-f-]{36}$`));
      if (segment === 'collections') {
        await expect(headline(page)).toHaveText(value);
        await expect(page.locator('[data-fact="amount"]')).toContainText(value);
      } else {
        await expectLevelTotals(page, value);
      }
      await expectLocale(page, uiLocale);
    }
  });
});

/** lang and dir match the project; in Urdu the figures stay in Latin digits. */
async function expectLocale(page: Page, locale: UiLocale) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', DIR[locale]);
  if (locale === 'ur') {
    for (const text of await page
      .locator('main h1 + p, main tfoot td[data-measure], main tbody a[href*="/dashboard/kpi/"]')
      .allInnerTexts()) {
      expect(text, 'figures use Latin digits').not.toMatch(URDU_DIGITS);
    }
  }
}
