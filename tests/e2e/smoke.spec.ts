import { expect, test } from './support/fixtures';
import { demoPassword, ROLES_E2E } from './support/roles';

// Read-only checks, safe against a live deployment (`--grep @smoke`). No test here
// submits a failed login: the per-email throttle budget belongs to the auth spec.

const LOCALES = [
  { locale: 'en', dir: 'ltr', other: 'ur' },
  { locale: 'ur', dir: 'rtl', other: 'en' },
] as const;

test.describe('smoke', { tag: '@smoke' }, () => {
  test('health endpoints report ok', async ({ request }) => {
    // A sleeping free-tier service can take a while to wake up.
    test.setTimeout(120_000);
    await expect
      .poll(
        async () => {
          try {
            return (await request.get('/api/health')).status();
          } catch {
            return 0;
          }
        },
        { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(200);

    const health = await request.get('/api/health');
    expect(await health.json()).toMatchObject({ status: 'ok' });

    const db = await request.get('/api/health/db');
    expect(db.status()).toBe(200);
    expect(await db.json()).toMatchObject({ db: 'up' });
  });

  for (const { locale, dir, other } of LOCALES) {
    test(`/${locale} sets lang and dir and links to /${other}`, async ({ page }) => {
      const response = await page.goto(`/${locale}`);
      expect(response?.status()).toBe(200);
      const html = page.locator('html');
      await expect(html).toHaveAttribute('lang', locale);
      await expect(html).toHaveAttribute('dir', dir);

      const switcher = page.locator(`a[hreflang="${other}"]`).first();
      await expect(switcher).toHaveAttribute('href', new RegExp(`^/${other}(?:[/?#]|$)`));
      await switcher.click();
      await expect(page).toHaveURL(new RegExp(`/${other}(?:[/?#]|$)`));
      await expect(html).toHaveAttribute('lang', other);
    });
  }

  test('home page fits the viewport and follows the project theme', async ({
    page,
    localePath,
    theme,
  }) => {
    const response = await page.goto(localePath('/'));
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForLoadState('load');
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(innerWidth + 1);
  });

  test('API login, me and logout', async ({ page, loginAs, baseURL }) => {
    const user = await loginAs('super_admin');
    expect(user.email).toBe(ROLES_E2E.super_admin.email);

    const logout = await page.request.post('/api/v1/auth/logout', {
      headers: { Origin: new URL(baseURL ?? '').origin },
      failOnStatusCode: false,
    });
    expect(logout.status(), 'logout').toBeGreaterThanOrEqual(200);
    expect(logout.status(), 'logout').toBeLessThan(300);

    const me = await page.request.get('/api/v1/auth/me', { failOnStatusCode: false });
    expect(me.status(), '/me after logout').toBe(401);
  });

  // Desktop projects only (mobile projects drop @desktop through grepInvert).
  test(
    'UI login lands on the account page',
    { tag: '@desktop' },
    async ({ page, localePath, uiLocale }) => {
      const { email, name } = ROLES_E2E.branch_lead;
      await page.goto(localePath('/login'));
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(demoPassword());
      await page.locator('button[type="submit"]').click();

      await expect(page).toHaveURL(new RegExp(`/${uiLocale}/account(?:[?#]|$)`));
      await expect(page.getByText(name).first()).toBeVisible();
    },
  );
});
