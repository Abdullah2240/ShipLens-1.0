import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from '../support/fixtures';

// Drill-down levels 1 and 2 walked from the dashboard and compared with the trace API in
// the same session. Read-only. Specs cannot import app code, so the formatters below
// mirror formatMoney and formatInt (Latin digits, 3-digit grouping, "PKR ", 2 decimals).

function group(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function money(amount: string): string {
  const [whole = '0', cents = '00'] = amount.replace(/^-/, '').split('.');
  return `PKR ${group(whole)}.${cents.padEnd(2, '0')}`;
}
function int(value: string | number): string {
  return group(String(value));
}
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function cents(formatted: string): bigint {
  const match = /PKR ([\d,]+)\.(\d{2})/.exec(formatted);
  if (!match) throw new Error(`no amount in "${formatted}"`);
  return BigInt(`${(match[1] ?? '0').replace(/,/g, '')}${match[2] ?? '00'}`);
}
function firstInt(text: string): string {
  const match = /\d[\d,]*/.exec(text);
  if (!match) throw new Error(`no number in "${text}"`);
  return match[0].replace(/,/g, '');
}

type FigureValue = { value: string; recordCount: number; measure: 'amount' | 'count' };
type Summary = { figures: Record<string, FigureValue> };
type Row = { branchId?: string; reportId?: string; value: string; status?: string; href: string };
type Level = {
  measure: 'amount' | 'count';
  parentValue: string;
  total: string;
  recordCount: number;
  matchesParent: boolean;
  rows: Row[];
};

async function api<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

const show = (measure: 'amount' | 'count', value: string) =>
  measure === 'amount' ? money(value) : int(value);

/** The footer: the record count line, the Matches pill and the total cell. */
function footer(page: Page) {
  const foot = page.locator('main tfoot');
  return {
    count: foot.locator('th > span > span').first(),
    pill: foot.locator('[data-tone]').first(),
    total: foot.locator('td[data-measure]'),
  };
}

/** The headline figure sits right after the page title. */
const headline = (page: Page) => page.locator('main h1 + p');
const trail = (page: Page) => page.locator('main nav:has([data-trail-separator]) ol > li');

async function expectNoOverflow(page: Page, testInfo: TestInfo) {
  if (!testInfo.project.name.startsWith('mobile')) return;
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(innerWidth + 1);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `test-results/screens/drilldown/${testInfo.project.name}-${name}.png`,
    fullPage: true,
  });
}

/** Opens a figure's level 1 by clicking its link on the dashboard. */
async function openFromDashboard(page: Page, localePath: (p: string) => string, slug: string) {
  const response = await page.goto(localePath('/dashboard'));
  expect(response?.status(), 'GET /dashboard').toBe(200);
  const href = localePath(`/dashboard/kpi/${slug}`);
  await page.locator(`main a[href="${href}"]`).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`${escape(href)}$`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Every level-1 row link with its value and the branch id in its path. */
async function levelOneLinks(page: Page) {
  const links = page.locator('main tbody tr a[href*="/branches/"]');
  const out: { link: Locator; branchId: string; text: string; href: string }[] = [];
  for (const link of await links.all()) {
    const href = (await link.getAttribute('href')) ?? '';
    const branchId = /\/branches\/([0-9a-f-]{36})/.exec(href)?.[1] ?? '';
    out.push({ link, branchId, text: (await link.innerText()).trim(), href });
  }
  return out;
}

const WALKS = [
  { figure: 'approved', slug: 'approved' },
  { figure: 'pending_approval', slug: 'pending-approval' },
  { figure: 'reports_awaiting_review', slug: 'reports-awaiting-review' },
] as const;

test.describe('drill-down levels 1 and 2', () => {
  for (const { figure, slug } of WALKS) {
    test(`${slug}: dashboard to level 1 to level 2 reconciles at every step`, async ({
      page,
      loginAs,
      localePath,
    }, testInfo) => {
      await loginAs('finance_reviewer');
      const summary = await api<Summary>(page, '/api/v1/dashboard/summary');
      const kpi = summary.figures[figure];
      expect(kpi, `${figure} in the summary`).toBeDefined();
      if (!kpi) return;

      await openFromDashboard(page, localePath, slug);
      const l1 = await api<Level>(page, `/api/v1/trace/${slug}`);
      expect(l1.matchesParent).toBe(true);
      await expect(headline(page)).toHaveText(show(kpi.measure, kpi.value));

      const rows = await levelOneLinks(page);
      expect(rows.length, 'one link per contributing branch').toBe(l1.rows.length);
      if (rows.length === 0) {
        await expect(page.getByRole('status')).toBeVisible();
        return;
      }

      // Footer: the dashboard figure, its record count and a Matches pill.
      const foot = footer(page);
      await expect(foot.total).toContainText(show(kpi.measure, kpi.value));
      await expect(foot.pill).toBeVisible();
      await expect(foot.pill).toHaveAttribute('data-tone', 'success');
      expect(firstInt(await foot.count.innerText())).toBe(
        String(kpi.measure === 'amount' ? kpi.recordCount : kpi.value),
      );

      // Each row equals its own level 2 total from the API.
      for (const row of rows) {
        const l2 = await api<Level>(page, `/api/v1/trace/${slug}/branches/${row.branchId}`);
        expect(l2.matchesParent, `branch ${row.branchId} reconciles`).toBe(true);
        expect(row.text).toContain(show(l1.measure, l2.parentValue));
        expect(l2.measure === 'amount' ? l2.total : String(l2.rows.length)).toBe(l2.parentValue);
      }
      await shot(page, testInfo, `${slug}-l1`);
      await expectNoOverflow(page, testInfo);

      // Click the largest branch.
      const largest = [...rows].sort((a, b) => {
        const va = l1.measure === 'amount' ? cents(a.text) : BigInt(firstInt(a.text));
        const vb = l1.measure === 'amount' ? cents(b.text) : BigInt(firstInt(b.text));
        return va === vb ? 0 : va > vb ? -1 : 1;
      })[0];
      if (!largest) return;
      const clicked = largest.text;
      await largest.link.click();
      await expect(page).toHaveURL(new RegExp(`/branches/${largest.branchId}$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const l2 = await api<Level>(page, `/api/v1/trace/${slug}/branches/${largest.branchId}`);
      await expect(headline(page)).toHaveText(show(l1.measure, l2.parentValue));
      expect(clicked).toContain(show(l1.measure, l2.parentValue));
      const foot2 = footer(page);
      await expect(foot2.pill).toHaveAttribute('data-tone', 'success');
      if (l1.measure === 'amount') {
        await expect(foot2.total).toContainText(money(l2.parentValue));
      } else {
        expect(firstInt(await foot2.count.innerText())).toBe(l2.parentValue);
      }
      const reportLinks = page.locator('main tbody tr a[href*="/reports/"]');
      await expect(reportLinks).toHaveCount(l2.rows.length);

      // Trail: Dashboard > figure (dashboard value) > branch (clicked value).
      const crumbs = trail(page);
      await expect(crumbs).toHaveCount(3);
      await expect(crumbs.nth(1)).toContainText(show(kpi.measure, kpi.value));
      await expect(crumbs.nth(2)).toContainText(show(l1.measure, l2.parentValue));
      await expect(crumbs.nth(2).locator('[aria-current="page"]')).toHaveCount(1);
      await expect(crumbs.nth(1).locator('a')).toHaveAttribute(
        'href',
        localePath(`/dashboard/kpi/${slug}`),
      );

      await shot(page, testInfo, `${slug}-l2`);
      await expectNoOverflow(page, testInfo);
    });
  }

  test('a month filter on level 1 stays in the URL through level 2 and the trail', async ({
    page,
    loginAs,
    localePath,
  }, testInfo) => {
    await loginAs('super_admin');
    const base = localePath('/dashboard/kpi/approved');
    expect((await page.goto(base))?.status()).toBe(200);

    const from = page.locator('main form select[name="from"]');
    const months = (
      await from
        .locator('option')
        .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))
    ).filter(Boolean);
    expect(months.length, 'months offered').toBeGreaterThan(0);
    // The busiest month keeps the walk meaningful.
    let month = months[0] ?? '';
    let best = -1n;
    for (const m of months) {
      const level = await api<Level>(page, `/api/v1/trace/approved?from=${m}&to=${m}`);
      const value = BigInt(level.total.replace('.', ''));
      if (value > best) [best, month] = [value, m];
    }

    await from.selectOption(month);
    await page.locator('main form select[name="to"]').selectOption(month);
    await page.locator('main form button[type="submit"]').click();
    const query = `?from=${month}&to=${month}`;
    await expect(page).toHaveURL(new RegExp(`${escape(base)}${escape(query)}$`));

    const l1 = await api<Level>(page, `/api/v1/trace/approved${query}`);
    await expect(headline(page)).toHaveText(money(l1.parentValue));
    await expect(footer(page).total).toContainText(money(l1.total));
    await expect(page.locator('main header dl')).toContainText(/\d{4}/);

    const rows = await levelOneLinks(page);
    expect(rows.length).toBe(l1.rows.length);
    const first = rows[0];
    if (!first) return;
    expect(first.href).toContain(query);
    await first.link.click();
    await expect(page).toHaveURL(new RegExp(`/branches/${first.branchId}${escape(query)}$`));

    const l2 = await api<Level>(page, `/api/v1/trace/approved/branches/${first.branchId}${query}`);
    await expect(footer(page).total).toContainText(money(l2.total));
    for (const href of await page
      .locator('main tbody tr a[href*="/reports/"]')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''))) {
      expect(href).toContain(query);
    }
    const crumbLinks = trail(page).locator('a');
    await expect(crumbLinks).toHaveCount(2);
    await expect(crumbLinks.nth(0)).toHaveAttribute('href', `${localePath('/dashboard')}${query}`);
    await expect(crumbLinks.nth(1)).toHaveAttribute('href', `${base}${query}`);
    for (const href of await page
      .locator('main a[download]')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''))) {
      expect(href).toContain(`from=${month}&to=${month}&branch=${first.branchId}`);
    }

    await shot(page, testInfo, 'approved-l2-filtered');

    // The Dashboard crumb returns to the overview with the same filters.
    await crumbLinks.nth(0).click();
    await expect(page).toHaveURL(
      new RegExp(`${escape(localePath('/dashboard'))}${escape(query)}$`),
    );
  });

  // First words of the approved definition (messages trace.figures.approved.definition).
  const DEFINITION = {
    en: 'Money in collections whose weekly report has been approved',
    ur: 'ان وصولیوں کی رقم جن کی ہفتہ وار رپورٹ',
  } as const;

  test('the explain drawer opens from the keyboard with the definition and record count', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('finance_reviewer');
    expect((await page.goto(localePath('/dashboard/kpi/approved')))?.status()).toBe(200);
    const summary = await api<Summary>(page, '/api/v1/dashboard/summary');
    const trigger = page.locator('main header button[aria-haspopup="dialog"]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(DEFINITION[uiLocale]);
    await expect(dialog).toContainText(int(summary.figures.approved?.recordCount ?? 0));
    await expect(dialog).toContainText(money(summary.figures.approved?.value ?? '0'));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('active branches list each branch with a link to its approved figure', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('super_admin');
    const summary = await api<Summary>(page, '/api/v1/dashboard/summary');
    expect((await page.goto(localePath('/dashboard/kpi/active-branches')))?.status()).toBe(200);
    const active = summary.figures.active_branches?.value ?? '0';
    await expect(headline(page)).toHaveText(int(active));
    const links = page.locator(
      `main tbody tr a[href^="${localePath('/dashboard/kpi/approved/branches/')}"]`,
    );
    await expect(links).toHaveCount(Number(active));
    await expect(footer(page).total).toContainText(int(active));
    await expect(footer(page).pill).toHaveAttribute('data-tone', 'success');
  });

  // The not-found page title (messages shell.notFound.title).
  const NOT_FOUND = { en: 'We could not find that page', ur: 'یہ صفحہ نہیں مل سکا' } as const;

  async function expectNotFound(page: Page, path: string, uiLocale: 'en' | 'ur') {
    const response = await page.goto(path);
    // 404, or 200 when the loading shell was already streamed before the refusal.
    expect([200, 404], path).toContain(response?.status());
    await expect(page.getByRole('heading', { name: NOT_FOUND[uiLocale] })).toBeVisible();
    await expect(page.locator('main tfoot')).toHaveCount(0);
  }

  test('broken paths show the not-found page', async ({ page, loginAs, localePath, uiLocale }) => {
    await loginAs('finance_reviewer');
    await expectNotFound(page, localePath('/dashboard/kpi/bogus'), uiLocale);
    await expectNotFound(page, localePath('/dashboard/kpi/pending_approval'), uiLocale);
    await expectNotFound(page, localePath('/dashboard/kpi/approved/branches/not-a-uuid'), uiLocale);
    await expectNotFound(
      page,
      localePath('/dashboard/kpi/approved/branches/00000000-0000-4000-8000-000000000000'),
      uiLocale,
    );

    const active = await api<Level>(page, '/api/v1/trace/active-branches');
    const branchId = active.rows[0]?.branchId;
    if (branchId) {
      await expectNotFound(
        page,
        localePath(`/dashboard/kpi/active-branches/branches/${branchId}`),
        uiLocale,
      );
    }

    // A report still in progress never sits under the approved figure.
    const inProgress = await api<Level>(page, '/api/v1/trace/in-progress');
    const branch = inProgress.rows[0]?.branchId;
    if (branch) {
      const reports = await api<Level>(page, `/api/v1/trace/in-progress/branches/${branch}`);
      const draft = reports.rows[0]?.reportId;
      if (draft) {
        await expectNotFound(
          page,
          localePath(`/dashboard/kpi/approved/branches/${branch}/reports/${draft}`),
          uiLocale,
        );
      }
    }
  });

  test(
    'a branch lead gets the not-found page on level 1 and level 2',
    { tag: '@desktop' },
    async ({ page, loginAs, localePath, uiLocale }) => {
      await loginAs('super_admin');
      const l1 = await api<Level>(page, '/api/v1/trace/approved');
      const branchId = l1.rows[0]?.branchId;
      await loginAs('branch_lead');
      await expectNotFound(page, localePath('/dashboard/kpi/approved'), uiLocale);
      if (branchId) {
        await expectNotFound(
          page,
          localePath(`/dashboard/kpi/approved/branches/${branchId}`),
          uiLocale,
        );
      }
    },
  );
});
