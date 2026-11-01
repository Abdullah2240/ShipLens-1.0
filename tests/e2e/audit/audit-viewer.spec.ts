import type { Page, TestInfo } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';

// Audit viewer (AUD-05) against the demo dataset. Specs never import app code, so the
// visible strings the checks rely on are pinned here (messages/<locale>/{audit,common,shell}.json).

const TEXT = {
  en: {
    title: 'Audit trail',
    list: 'Audit events',
    action: 'Action',
    apply: 'Apply filters',
    loadOlder: 'Load older events',
    restricted: 'Showing finance records only: collections, reports, exports and shares.',
    emptyTitle: 'No events match these filters',
    approved: 'Report approved',
    statusField: 'Status',
    submitted: 'Submitted',
    approvedStatus: 'Approved',
    notFound: 'We could not find that page',
  },
  ur: {
    title: 'آڈٹ ریکارڈ',
    list: 'آڈٹ کے واقعات',
    action: 'عمل',
    apply: 'فلٹر لاگو کریں',
    loadOlder: 'پرانے واقعات دیکھیں',
    restricted: 'صرف مالیاتی ریکارڈ دکھائے جا رہے ہیں: وصولیاں، رپورٹیں، برآمدات اور شیئر۔',
    emptyTitle: 'ان فلٹرز سے کوئی واقعہ نہیں ملا',
    approved: 'رپورٹ منظور کی گئی',
    statusField: 'حیثیت',
    submitted: 'جمع شدہ',
    approvedStatus: 'منظور شدہ',
    notFound: 'یہ صفحہ نہیں مل سکا',
  },
} as const satisfies Record<UiLocale, unknown>;

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `test-results/screens/audit/${testInfo.project.name}-${name}.png`,
    fullPage: true,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(innerWidth + 1);
}

function eventIds(page: Page) {
  return page
    .locator('li[data-event-id]')
    .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-event-id'))));
}

test.describe('audit viewer', () => {
  test('Super Admin sees the trail newest first, including the seeded history', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }, testInfo) => {
    const text = TEXT[uiLocale];
    await loginAs('super_admin');
    const response = await page.goto(localePath('/audit'));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: text.title })).toBeVisible();
    await expect(page.getByRole('note')).toHaveCount(0);

    const list = page.getByRole('region', { name: text.list });
    await expect(list.getByRole('listitem').first()).toBeVisible();
    const ids = await eventIds(page);
    expect(ids.length).toBeGreaterThan(0);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
    await screenshot(page, testInfo, 'admin-list');
    await expectNoHorizontalOverflow(page);

    // Reports were created by the demo seed: its request id is on those rows.
    await page.goto(localePath('/audit?entity=report'));
    await expect(
      page.locator('[data-request-id]').filter({ hasText: 'seed:demo-data' }).first(),
    ).toBeAttached();
  });

  test('filtering by action shows only approvals, and a row expands to its diff', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }, testInfo) => {
    const text = TEXT[uiLocale];
    await loginAs('super_admin');
    await page.goto(localePath('/audit'));

    await page.getByLabel(text.action, { exact: true }).selectOption({ label: text.approved });
    await page.getByRole('button', { name: text.apply, exact: true }).click();
    await expect(page).toHaveURL(/[?&]action=report\.approve(?:&|$)/);
    await expect(page).not.toHaveURL(/[?&]before=/);

    const rows = page.getByRole('region', { name: text.list }).getByRole('listitem');
    await expect(rows.first()).toBeVisible();
    const codes = await page.locator('li[data-event-id] [data-action-code]').allTextContents();
    expect(codes.length).toBe(await rows.count());
    for (const code of codes) expect(code.trim()).toBe('report.approve');

    const first = rows.first();
    await first.locator('summary').click();
    const statusRow = first.getByRole('row', { name: new RegExp(text.statusField) });
    await expect(statusRow).toBeVisible();
    await expect(statusRow.getByRole('cell').first()).toHaveText(text.submitted);
    await expect(statusRow.getByRole('cell').last()).toHaveText(text.approvedStatus);
    await screenshot(page, testInfo, 'approvals-expanded');
    await expectNoHorizontalOverflow(page);
  });

  test('Load older pages with the before cursor', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    const text = TEXT[uiLocale];
    await loginAs('super_admin');
    await page.goto(localePath('/audit'));
    const firstPage = await eventIds(page);
    expect(firstPage.length).toBeGreaterThan(0);

    await page.getByRole('link', { name: text.loadOlder }).click();
    await expect(page).toHaveURL(/[?&]before=\d+/);
    const before = Number(new URL(page.url()).searchParams.get('before'));
    expect(before).toBe(firstPage[firstPage.length - 1]);

    await expect(page.locator('li[data-event-id]').first()).toBeVisible();
    const secondPage = await eventIds(page);
    expect(secondPage.length).toBeGreaterThan(0);
    expect(Math.max(...secondPage)).toBeLessThan(before);
  });

  test('Finance Reviewer sees the finance-only notice and no member records', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }, testInfo) => {
    const text = TEXT[uiLocale];
    await loginAs('finance_reviewer');
    const response = await page.goto(localePath('/audit?entity=member'));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('note')).toHaveText(text.restricted);
    await expect(page.getByText(text.emptyTitle, { exact: true })).toBeVisible();
    await expect(page.locator('li[data-event-id]')).toHaveCount(0);
    await screenshot(page, testInfo, 'finance-restricted');
    await expectNoHorizontalOverflow(page);
  });

  test('a Branch Lead gets the not-found page', async ({ page, loginAs, localePath, uiLocale }) => {
    await loginAs('branch_lead');
    const response = await page.goto(localePath('/audit'));
    expect(response?.status()).toBe(404);
    await expect(page.getByText(TEXT[uiLocale].notFound, { exact: true })).toBeVisible();
    await expect(page.locator('li[data-event-id]')).toHaveCount(0);
  });
});
