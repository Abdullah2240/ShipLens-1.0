import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';
import { ROLES_E2E } from '../support/roles';
import { DIR, URDU_DIGITS } from './support/journey';
import { money, requireExpected, type ApprovedReport } from './support/expected';

// The donor-facing check of an approved report, from the Finance Reviewer's report page to
// the public certificate opened by someone with no account (SUB-03). The report is
// expected.approvedReports[0]; its figures come from db/seed/expected.json. Read-only, every
// project. The public side runs in a new browser context with no cookies and its own
// documentation-range client address, so it never shares the verify rate-limit budget
// with other specs. Strings are copied from messages/<locale>/verify.json.

const TEXT = {
  en: {
    panel: 'Public verification',
    verified: 'This report is verified',
    codeLabel: 'Verification code',
    submit: 'Check report',
    notFoundTitle: 'Code not recognised',
    sealMismatchTitle: 'Seal does not match',
    collections: 'Collections counted',
  },
  ur: {
    panel: 'عوامی تصدیق',
    verified: 'یہ رپورٹ تصدیق شدہ ہے',
    codeLabel: 'تصدیقی کوڈ',
    submit: 'رپورٹ جانچیں',
    notFoundTitle: 'کوڈ پہچانا نہیں گیا',
    sealMismatchTitle: 'مہر مطابقت نہیں رکھتی',
    collections: 'شمار شدہ وصولیاں',
  },
} as const satisfies Record<UiLocale, Record<string, string>>;

const CODE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;
const WRONG_SEAL = '0000000000000000';
const PROJECT_OCTET: Record<string, number> = {
  'desktop-en-light': 11,
  'desktop-ur-dark': 12,
  'mobile-en-dark': 13,
  'mobile-ur-light': 14,
};

type Verification = { code: string; path: string; seal: string | null };

/** A cookie-less context in the project's language, viewport and its own client address. */
async function publicContext(
  browser: Browser,
  page: Page,
  baseURL: string | undefined,
  locale: UiLocale,
  testInfo: TestInfo,
  offset: number,
): Promise<BrowserContext> {
  const octet = (PROJECT_OCTET[testInfo.project.name] ?? 19) + offset;
  return browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
    locale: locale === 'ur' ? 'ur-PK' : 'en-GB',
    extraHTTPHeaders: { 'X-Forwarded-For': `203.0.113.${octet}` },
  });
}

/** The certificate is verified for `report`, with no personal data and no Urdu digits. */
async function expectCertificate(
  page: Page,
  locale: UiLocale,
  report: ApprovedReport,
  code: string,
) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', DIR[locale]);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT[locale].verified);
  const certificate = page.locator('article[data-integrity]');
  await expect(certificate).toHaveAttribute('data-integrity', 'verified');
  await expect(certificate.locator('[data-code]')).toHaveText(code);
  await expect(certificate.locator('[data-total]')).toHaveText(money(report.amount));
  await expect(certificate).toContainText(report.branch);
  await expect(
    certificate
      .locator('dt', { hasText: TEXT[locale].collections })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText(String(report.count));
  // The week line names the report's year in Latin digits.
  await expect(certificate.locator('[data-total] + p')).toContainText(report.weekStart.slice(0, 4));
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const body = (await page.locator('body').textContent()) ?? '';
  for (const user of Object.values(ROLES_E2E)) {
    expect(body, 'no user names').not.toContain(user.name);
    expect(body, 'no user emails').not.toContain(user.email);
  }
  if (locale === 'ur') {
    for (const text of await certificate.locator('[data-total], [data-code]').allInnerTexts()) {
      expect(text, 'Latin digits').not.toMatch(URDU_DIGITS);
    }
    await expect(certificate.locator('[data-total] bdi')).toHaveAttribute('dir', 'ltr');
  }
}

test.describe('public verification journey', { tag: '@smoke' }, () => {
  test('the public link on an approved report opens a verified certificate for anyone', async ({
    page,
    browser,
    baseURL,
    loginAs,
    localePath,
    uiLocale,
  }, testInfo) => {
    const report = requireExpected().approvedReports[0]!;
    await loginAs('finance_reviewer');

    expect((await page.goto(localePath(`/reports/${report.reportId}`)))?.status()).toBe(200);
    const panel = page.getByRole('region', { name: TEXT[uiLocale].panel });
    await expect(panel).toBeVisible();
    const code = (await panel.locator('bdi[dir="ltr"]').first().innerText()).trim();
    expect(code).toMatch(CODE);
    await expect(panel.locator('svg[role="img"]')).toHaveCount(1);
    await expect(panel.locator('[data-seal]')).toBeVisible();
    const href = await panel.locator('a[target="_blank"]').getAttribute('href');
    expect(href, 'public link').toMatch(new RegExp(`/verify/${code}(\\?s=[0-9a-f]{16})?$`));

    const context = await publicContext(browser, page, baseURL, uiLocale, testInfo, 0);
    try {
      expect(await context.cookies(), 'a fresh context has no cookies').toEqual([]);
      const visitor = await context.newPage();
      const response = await visitor.goto(href!);
      expect(response?.status()).toBe(200);
      // The locale-free link was redirected to the visitor's language, keeping the seal.
      const landed = new URL(visitor.url());
      expect(landed.pathname).toBe(`/${uiLocale}/verify/${code}`);
      expect(landed.search).toBe(new URL(href!, landed).search);
      await expectCertificate(visitor, uiLocale, report, code);
      await expect(visitor.locator('article[data-integrity]')).toHaveAttribute(
        'data-seal-check',
        landed.search ? 'match' : 'not_provided',
      );
      await visitor.screenshot({
        path: testInfo.outputPath('verify-journey-certificate.png'),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });

  test('the code form, an unknown code and a wrong seal', async ({
    page,
    browser,
    baseURL,
    loginAs,
    uiLocale,
  }, testInfo) => {
    const report = requireExpected().approvedReports[0]!;
    await loginAs('finance_reviewer');
    const api = await page.request.get(`/api/v1/reports/${report.reportId}/verification`);
    expect(api.status()).toBe(200);
    const { code } = ((await api.json()) as { data: Verification }).data;
    expect(code).toMatch(CODE);
    const text = TEXT[uiLocale];

    const context = await publicContext(browser, page, baseURL, uiLocale, testInfo, 20);
    try {
      const visitor = await context.newPage();

      // Typed in lower case with the hyphen, the code still reaches its certificate.
      expect((await visitor.goto(`/${uiLocale}/verify`))?.status()).toBe(200);
      await visitor.getByLabel(text.codeLabel).fill(code.toLowerCase());
      await visitor.getByRole('button', { name: text.submit }).click();
      await expect(visitor).toHaveURL(new RegExp(`/${uiLocale}/verify/${code}$`));
      await expectCertificate(visitor, uiLocale, report, code);
      await expect(visitor.locator('article[data-integrity]')).toHaveAttribute(
        'data-seal-check',
        'not_provided',
      );

      // A well-formed code that was never issued.
      const unknown = code === 'ZZZZZ-ZZZZZ' ? 'YYYYY-YYYYY' : 'ZZZZZ-ZZZZZ';
      await visitor.goto(`/${uiLocale}/verify/${unknown}`);
      await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(text.notFoundTitle);
      await expect(visitor.locator('article[data-integrity]')).toHaveCount(0);

      // The real code with a seal that does not match the audit chain.
      await visitor.goto(`/${uiLocale}/verify/${code}?s=${WRONG_SEAL}`);
      const certificate = visitor.locator('article[data-integrity]');
      await expect(certificate).toHaveAttribute('data-seal-check', 'mismatch');
      await expect(certificate.locator('[data-seal-warning]')).toContainText(
        text.sealMismatchTitle,
      );
      await expect(visitor.locator('html')).toHaveAttribute('dir', DIR[uiLocale]);
    } finally {
      await context.close();
    }
  });
});
