import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { ROLES_E2E } from '../support/roles';

// Public report verification pages (SUB-03): the code entry form, the result page and the
// locale-free QR link. Specs never import app code, so the visible strings the checks rely
// on are pinned here (messages/<locale>/verify.json). The full donor journey, including
// tamper detection, is a separate journey spec.

// From db/seed/data/reports.json: an approved Sample Branch report readable by `branch_lead`.
const SAMPLE_BRANCH_REPORT = '72d847f7-686c-4106-b22b-f450dc726a8c';
const UNKNOWN_CODE = 'ABCDE-FGHJK';
const SEAL = '0123456789abcdef';

const TEXT = {
  en: {
    title: 'Verify a weekly report',
    codeLabel: 'Verification code',
    submit: 'Check report',
    invalid: 'That does not look like a verification code. Codes have 10 letters and numbers.',
    notFoundTitle: 'Code not recognised',
    checkAnother: 'Check another code',
  },
  ur: {
    title: 'ہفتہ وار رپورٹ کی تصدیق',
    codeLabel: 'تصدیقی کوڈ',
    submit: 'رپورٹ جانچیں',
    invalid: 'یہ تصدیقی کوڈ معلوم نہیں ہوتا۔ کوڈ میں 10 حروف اور ہندسے ہوتے ہیں۔',
    notFoundTitle: 'کوڈ پہچانا نہیں گیا',
    checkAnother: 'کوئی اور کوڈ جانچیں',
  },
} as const;

const DIR = { en: 'ltr', ur: 'rtl' } as const;

async function expectNoOverflow(page: Page, what: string) {
  await page.waitForLoadState('load');
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `no horizontal overflow on ${what}`).toBeLessThanOrEqual(innerWidth + 1);
}

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

function robots(page: Page) {
  return page.locator('meta[name="robots"]');
}

test.describe('public verify pages', { tag: '@smoke' }, () => {
  test('the entry page explains the check and can be indexed', async ({
    page,
    localePath,
    uiLocale,
    theme,
  }, testInfo) => {
    const response = await page.goto(localePath('/verify'));
    expect(response?.status()).toBe(200);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', uiLocale);
    await expect(html).toHaveAttribute('dir', DIR[uiLocale]);
    await expect(html).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT[uiLocale].title);
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(4);
    await expect(robots(page)).toHaveCount(0);
    await expectNoOverflow(page, '/verify');
    await snapshot(page, testInfo, 'verify-entry');
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('the form normalises the code and lands on a not-recognised result', async ({
      page,
      localePath,
      uiLocale,
    }, testInfo) => {
      const text = TEXT[uiLocale];
      await page.goto(localePath('/verify'));
      await page.getByLabel(text.codeLabel).fill('abcde fghjk');
      await page.getByRole('button', { name: text.submit }).click();

      await expect(page).toHaveURL(new RegExp(`/${uiLocale}/verify/${UNKNOWN_CODE}$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.notFoundTitle);
      await expect(robots(page)).toHaveAttribute('content', /noindex/);
      await expect(page.locator('title')).not.toHaveText(/ABCDE|FGHJK/);
      await expect(page.getByLabel(text.codeLabel)).toHaveValue('');
      await expectNoOverflow(page, 'the not-recognised result');
      await snapshot(page, testInfo, 'verify-not-recognised');
    });

    test('a value that is not a code is shown back with the reason', async ({
      page,
      localePath,
      uiLocale,
    }) => {
      const text = TEXT[uiLocale];
      await page.goto(localePath('/verify?code=%3Cb%3Ebad'));
      await expect(page).toHaveURL(new RegExp(`/${uiLocale}/verify\\?code=`));
      const field = page.getByLabel(text.codeLabel);
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toHaveValue('<b>bad');
      await expect(page.getByText(text.invalid)).toBeVisible();
      await expect(page.locator('main b')).toHaveCount(0);
    });
  });

  test('a locale-free QR link redirects to the visitor language and keeps the seal', async ({
    playwright,
    baseURL,
  }) => {
    const qr = `/verify/${UNKNOWN_CODE}?s=${SEAL}`;
    const urdu = 'ur-PK,ur;q=0.9,en;q=0.5';

    // Each visitor is a fresh client. The redirect may set NEXT_LOCALE (a visitor with no
    // Accept-Language gets NEXT_LOCALE=en), and a shared cookie jar would carry that cookie
    // into the next case, where the cookie rightly wins over the header.
    const redirectFor = async (headers: Record<string, string>) => {
      const visitor = await playwright.request.newContext({ baseURL });
      try {
        const response = await visitor.get(qr, { maxRedirects: 0, headers });
        expect([302, 303, 307, 308]).toContain(response.status());
        const url = new URL(response.headers().location ?? '', baseURL);
        return `${url.pathname}${url.search}`;
      } finally {
        await visitor.dispose();
      }
    };

    expect(await redirectFor({}), 'no language preference').toBe(`/en${qr}`);
    expect(await redirectFor({ 'Accept-Language': urdu }), 'Urdu browser').toBe(`/ur${qr}`);
    expect(
      await redirectFor({ 'Accept-Language': 'en', Cookie: 'NEXT_LOCALE=ur' }),
      'Urdu chosen earlier, English browser',
    ).toBe(`/ur${qr}`);
    expect(
      await redirectFor({ 'Accept-Language': urdu, Cookie: 'NEXT_LOCALE=en' }),
      'English chosen earlier, Urdu browser',
    ).toBe(`/en${qr}`);
  });
});

test.describe('verified report', () => {
  test('the public link of an approved report shows its certificate and no personal data', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }, testInfo) => {
    await loginAs('branch_lead');
    const api = await page.request.get(`/api/v1/reports/${SAMPLE_BRANCH_REPORT}/verification`);
    expect(api.status()).toBe(200);
    const link = (
      (await api.json()) as { data: { code: string; path: string; seal: string | null } }
    ).data;
    expect(link.path).toMatch(/^\/verify\/[0-9A-Z]{5}-[0-9A-Z]{5}(\?s=[0-9a-f]{16})?$/);

    const response = await page.goto(localePath(link.path));
    expect(response?.status()).toBe(200);
    const certificate = page.locator('article[data-integrity]');
    await expect(certificate).toBeVisible();
    await expect(certificate).toHaveAttribute('dir', DIR[uiLocale]);
    await expect(certificate).toHaveAttribute(
      'data-seal-check',
      link.seal === null ? 'not_provided' : 'match',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(robots(page)).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('link', { name: TEXT[uiLocale].checkAnother })).toHaveAttribute(
      'href',
      `/${uiLocale}/verify`,
    );

    const body = (await page.locator('main').textContent()) ?? '';
    for (const user of Object.values(ROLES_E2E)) {
      expect(body).not.toContain(user.name);
      expect(body).not.toContain(user.email);
    }
    expect(body).not.toMatch(/[٠-٩۰-۹]/);
    await expectNoOverflow(page, 'the certificate');
    await snapshot(page, testInfo, 'verify-certificate');
  });
});
