import { expect, test } from '../support/fixtures';

// The Finance Reviewer's review queue. Read-only, so it runs in every project. Other specs
// may submit reports in the same run: assert inclusion and order, never equality.

// Seeded submitted reports, oldest submission first (db/seed/data/reports.json; the seed
// data is not mounted in the runner).
const SEEDED_SUBMITTED = [
  'e64c6b8b-727e-44ae-97ef-c6898e774b09', // Islamabad, submitted 2026-10-19 06:10Z
  '3288b84c-23e0-49a3-93e1-17e1e069da34', // Peshawar, submitted 2026-10-19 06:27Z
  'a671a171-0b6c-4d0c-9aa3-f2d801515f19', // Lahore, submitted 2026-10-26 05:38Z
  'a17b20bf-164b-416c-b208-835ff1a30699', // Sample Branch, submitted 2026-10-26 05:52Z
] as const;

const TITLE = { en: 'Review queue', ur: 'جائزے کی قطار' } as const;
const NOT_FOUND = { en: 'We could not find that page', ur: 'یہ صفحہ نہیں مل سکا' } as const;
const NON_LATIN_DIGITS = /[٠-٩۰-۹]/;

test.describe('report review queue', () => {
  test('Finance sees every submitted report, oldest first', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('finance_reviewer');
    await page.goto(localePath('/reports/review'));
    await expect(page.getByRole('heading', { level: 1, name: TITLE[uiLocale] })).toBeVisible();

    const items = page.locator('li[data-report-id]');
    await expect(items.first()).toBeVisible();
    const rows = await items.evaluateAll((lis) =>
      lis.map((li) => ({
        id: li.getAttribute('data-report-id') ?? '',
        submittedAt: li.querySelector('time')?.getAttribute('datetime') ?? '',
      })),
    );

    // Every seeded submitted report is there, in seed order.
    const positions = SEEDED_SUBMITTED.map((id) => rows.findIndex((row) => row.id === id));
    expect(
      positions.every((p) => p >= 0),
      `seeded reports in ${JSON.stringify(rows)}`,
    ).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    // The displayed submission times never go backwards.
    const times = rows.map((row) => Date.parse(row.submittedAt));
    expect(times.every((t) => !Number.isNaN(t))).toBe(true);
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    // Each card opens its report.
    await expect(items.first().getByRole('link').first()).toHaveAttribute(
      'href',
      new RegExp(`/${uiLocale}/reports/${rows[0]!.id}$`),
    );
  });

  test('the queue is Finance only; head office lists submitted reports instead', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('branch_lead');
    await page.goto(localePath('/reports/review'));
    await expect(page.getByRole('heading', { name: NOT_FOUND[uiLocale] })).toBeVisible();

    await page.context().clearCookies();
    await loginAs('super_admin');
    await page.goto(localePath('/reports/review'));
    await expect(page.getByRole('heading', { name: NOT_FOUND[uiLocale] })).toBeVisible();

    await page.goto(localePath('/reports?status=submitted'));
    for (const id of SEEDED_SUBMITTED) {
      await expect(page.locator(`a[href$="/reports/${id}"]`)).toHaveCount(1);
    }
  });

  test('the Urdu queue is right to left with Latin digits', async ({ page, loginAs }) => {
    await loginAs('finance_reviewer');
    await page.goto('/ur/reports/review');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const list = page.getByRole('list', { name: 'جائزے کی منتظر رپورٹیں، سب سے پرانی پہلے' });
    await expect(list).toBeVisible();
    const text = (await list.textContent()) ?? '';
    expect(text).toMatch(/PKR \d[\d,]*\.\d{2}/);
    expect(text).toMatch(/\b20\d\d\b/);
    expect(text).not.toMatch(NON_LATIN_DIGITS);
  });
});
