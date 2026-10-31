import { expect, test } from '../support/fixtures';
import { DEMO_BRANCH_NAME } from '../support/roles';

// Read-only checks of the public site, safe against a live deployment (`--grep @smoke`).
// Every project runs them, so both languages, both themes and both widths are covered.

const PAGES = [
  '/',
  '/about',
  '/programs',
  '/branches',
  '/events',
  '/get-involved',
  '/contact',
  '/get-involved/apply',
] as const;

const DIR = { en: 'ltr', ur: 'rtl' } as const;
const EVENTS_EMPTY = {
  en: 'No upcoming events right now',
  ur: 'فی الحال کوئی تقریب طے نہیں',
} as const;

test.describe('public pages', { tag: '@smoke' }, () => {
  for (const path of PAGES) {
    test(`${path} loads in English and Urdu`, async ({ page, uiLocale, theme }) => {
      for (const locale of ['en', 'ur'] as const) {
        const response = await page.goto(`/${locale}${path === '/' ? '' : path}`);
        expect(response?.status(), `/${locale}${path}`).toBe(200);
        const html = page.locator('html');
        await expect(html).toHaveAttribute('lang', locale);
        await expect(html).toHaveAttribute('dir', DIR[locale]);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        if (locale !== uiLocale) continue;

        // In the project's own language: theme applied and nothing wider than the viewport.
        await expect(html).toHaveAttribute('data-theme', theme);
        await page.waitForLoadState('load');
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(scrollWidth, `no horizontal overflow on ${path}`).toBeLessThanOrEqual(
          innerWidth + 1,
        );
      }
    });
  }

  test('the language switcher goes to the other language and back', async ({
    page,
    localePath,
    uiLocale,
  }) => {
    const other = uiLocale === 'en' ? 'ur' : 'en';
    await page.goto(localePath('/about'));
    await page.locator(`a[hreflang="${other}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${other}/about(?:[?#]|$)`));
    await expect(page.locator('html')).toHaveAttribute('lang', other);
    await expect(page.locator('html')).toHaveAttribute('dir', DIR[other]);

    await page.locator(`a[hreflang="${uiLocale}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${uiLocale}/about(?:[?#]|$)`));
    await expect(page.locator('html')).toHaveAttribute('lang', uiLocale);
    await expect(page.locator('html')).toHaveAttribute('dir', DIR[uiLocale]);
  });

  test('the demo branch is listed and its apply link preselects it', async ({
    page,
    localePath,
    uiLocale,
  }) => {
    await page.goto(localePath('/branches'));
    const card = page
      .locator('main li')
      .filter({ has: page.getByRole('heading', { level: 3, name: DEMO_BRANCH_NAME }) });
    await expect(card).toHaveCount(1);
    const apply = card.locator('a[href*="/get-involved/apply?branch="]');
    const href = await apply.getAttribute('href');
    expect(href).toMatch(new RegExp(`^/${uiLocale}/get-involved/apply\\?branch=[0-9a-f-]{36}$`));
    const branchId = new URL(href!, 'http://local').searchParams.get('branch');

    await apply.click();
    await expect(page).toHaveURL(new RegExp(`/${uiLocale}/get-involved/apply\\?branch=`));
    const select = page.locator('select[name="branchId"]');
    await expect(select).toHaveValue(branchId!);
    await expect(select.locator('option:checked')).toContainText(DEMO_BRANCH_NAME);
  });

  test('the events page shows upcoming events or the empty state', async ({
    page,
    localePath,
    uiLocale,
  }) => {
    const response = await page.goto(localePath('/events'));
    expect(response?.status()).toBe(200);
    const events = page.locator('main ol > li');
    const empty = page.getByText(EVENTS_EMPTY[uiLocale]);
    await expect(events.first().or(empty)).toBeVisible();
    if ((await events.count()) > 0) {
      await expect(events.first().getByRole('heading', { level: 3 })).not.toBeEmpty();
      await expect(events.first().locator('time').first()).toHaveAttribute('datetime', /Z$/);
    }
  });
});
