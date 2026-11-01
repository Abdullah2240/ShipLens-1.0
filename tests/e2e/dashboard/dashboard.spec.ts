import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import type { Role } from '../support/roles';

// The head office overview compared with the dashboard API in the same session. Read-only.
// Specs cannot import app code, so the two formatters below mirror formatMoney and
// formatInt (Latin digits, 3-digit grouping, "PKR " prefix, two decimals).

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

type FigureValue = { value: string; recordCount: number; measure: 'amount' | 'count' };
type Summary = { figures: Record<string, FigureValue>; asOf: string };

const SLUGS: Record<string, string> = {
  collected: 'collected',
  approved: 'approved',
  pending_approval: 'pending-approval',
  in_progress: 'in-progress',
  not_yet_routed: 'not-yet-routed',
  routed: 'routed',
  active_branches: 'active-branches',
  reports_awaiting_review: 'reports-awaiting-review',
};

async function summaryFor(page: Page, query: string): Promise<Summary> {
  const response = await page.request.get(`/api/v1/dashboard/summary${query}`);
  expect(response.status(), 'GET /api/v1/dashboard/summary').toBe(200);
  return ((await response.json()) as { data: Summary }).data;
}

/** Every link on the page into a figure's level 1 shows that figure's value. */
async function expectFiguresMatch(
  page: Page,
  localePath: (p: string) => string,
  summary: Summary,
  query: string,
) {
  for (const [figure, slug] of Object.entries(SLUGS)) {
    const value = summary.figures[figure];
    expect(value, `figure ${figure} in the API`).toBeDefined();
    if (!value) continue;
    const href = `${localePath(`/dashboard/kpi/${slug}`)}${query}`;
    const links = page.locator(`main a[href="${href}"]`).filter({ visible: true });
    await expect(links.first(), `a link to ${href}`).toBeVisible();
    const name =
      value.measure === 'amount'
        ? new RegExp(escape(money(value.value)))
        : new RegExp(`[,،] ${escape(int(value.value))}:`);
    for (const link of await links.all()) {
      await expect(link, `${figure} on screen`).toHaveAccessibleName(name);
    }
  }
}

async function legendCents(panel: Locator): Promise<bigint[]> {
  const items = panel.locator('[data-legend-segment]');
  return (await items.allInnerTexts()).map(cents);
}

async function openOverview(page: Page, localePath: (p: string) => string, query = '') {
  const response = await page.goto(`${localePath('/dashboard')}${query}`);
  expect(response?.status(), 'GET /dashboard').toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.describe('dashboard overview', () => {
  test('every figure equals the API and links into its level 1', async ({
    page,
    loginAs,
    localePath,
  }, testInfo) => {
    await loginAs('finance_reviewer');
    await openOverview(page, localePath);
    const summary = await summaryFor(page, '');
    await expectFiguresMatch(page, localePath, summary, '');

    await page.screenshot({
      path: `test-results/screens/dashboard/${testInfo.project.name}-overview.png`,
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

  test('identity bar legends add up to their parent figure', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('super_admin');
    await openOverview(page, localePath);
    for (const figure of ['collected', 'approved']) {
      const panel = page.locator(`[data-flow-panel="${figure}"]`);
      const parent = await panel
        .locator(`a[href="${localePath(`/dashboard/kpi/${figure}`)}"][aria-label]`)
        .getAttribute('aria-label');
      const parts = await legendCents(panel);
      expect(parts.length).toBe(figure === 'collected' ? 3 : 2);
      expect(
        parts.reduce((a, b) => a + b, 0n),
        `${figure} parts`,
      ).toBe(cents(parent ?? ''));
    }
  });

  test('clicking Approved opens its drill-down level', async ({ page, loginAs, localePath }) => {
    await loginAs('finance_reviewer');
    await openOverview(page, localePath);
    await page
      .locator(
        `[data-flow-panel="approved"] a[aria-label][href="${localePath('/dashboard/kpi/approved')}"]`,
      )
      .click();
    await expect(page).toHaveURL(new RegExp(`${escape(localePath('/dashboard/kpi/approved'))}$`));
  });

  test('a month range lives in the URL and the figures follow it', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('finance_reviewer');
    await openOverview(page, localePath);
    const from = page.locator('form select[name="from"]');
    const months = (
      await from
        .locator('option')
        .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))
    ).filter(Boolean);
    expect(months.length, 'months offered').toBeGreaterThan(0);
    const month = months[Math.min(1, months.length - 1)] ?? '';

    await from.selectOption(month);
    await page.locator('form select[name="to"]').selectOption(month);
    await page.locator('form button[type="submit"]').click();
    const query = `?from=${month}&to=${month}`;
    await expect(page).toHaveURL(new RegExp(`${escape(query)}$`));

    const summary = await summaryFor(page, query);
    await expectFiguresMatch(page, localePath, summary, query);

    // A reload (or a shared link) shows the same numbers.
    await page.reload();
    await expectFiguresMatch(page, localePath, summary, query);

    const downloads = await page
      .locator('a[download]')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
    expect(downloads).toHaveLength(4);
    for (const href of downloads) {
      expect(href).toContain(`from=${month}&to=${month}`);
      expect(href).toMatch(/^\/api\/v1\/exports\/(summary|reports|collections|unrouted)\?/);
    }
    const print = page.locator(`a[href="${localePath('/dashboard/print')}${query}"]`);
    await expect(print).toHaveCount(1);
  });

  test('the explain drawer opens with Enter, keeps focus and closes with Escape', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('finance_reviewer');
    await openOverview(page, localePath);
    const trigger = page
      .locator('[data-flow-panel="collected"]')
      .locator('button[aria-haspopup="dialog"]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-holds="true"]')).toBeVisible();

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
      expect(inside, `focus stays in the drawer after Tab ${i + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('"View as table" reveals the linked monthly table', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('super_admin');
    await openOverview(page, localePath);
    const details = page.locator('details').filter({ has: page.locator('table') });
    await expect(details.getByRole('table')).toBeHidden();
    await details.locator('summary').click();
    const table = details.getByRole('table');
    await expect(table).toBeVisible();
    const hrefs = await table
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/\/dashboard\/kpi\/[a-z-]+\?from=(\d{4}-\d{2})&to=\1$/);
    }
  });

  test('signed-out visitors are sent to the login page', async ({ page, localePath }) => {
    await page.goto(localePath('/dashboard'));
    await expect(page).toHaveURL(new RegExp(`${escape(localePath('/login'))}`));
  });

  // The not-found page title (messages shell.notFound.title).
  const NOT_FOUND = { en: 'We could not find that page', ur: 'یہ صفحہ نہیں مل سکا' } as const;
  const DENIED: Role[] = ['branch_lead', 'hr_lead', 'content_editor'];
  for (const role of DENIED) {
    test(
      `${role} gets the not-found page and no Dashboard nav item`,
      { tag: '@desktop' },
      async ({ page, loginAs, localePath, uiLocale }) => {
        await loginAs(role);
        const response = await page.goto(localePath('/dashboard'));
        // 404, or 200 when the loading shell was already streamed before the refusal.
        expect([200, 404]).toContain(response?.status());
        await expect(page.getByRole('heading', { name: NOT_FOUND[uiLocale] })).toBeVisible();
        await expect(page.locator('[data-flow-panel]')).toHaveCount(0);
        await expect(page.locator(`a[href="${localePath('/dashboard')}"]`)).toHaveCount(0);
      },
    );
  }
});
