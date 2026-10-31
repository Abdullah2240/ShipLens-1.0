import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

// The nonce-based Content Security Policy must not break any page. Each page is loaded
// in the browser and the test fails on any `securitypolicyviolation` event, any console
// message about the policy, or a page whose Next.js runtime never started (a blocked
// script). Read-only; every project runs it, so both languages, themes and widths count.

const PUBLIC_PAGES = [
  '/',
  '/about',
  '/programs',
  '/branches',
  '/events',
  '/impact',
  '/get-involved',
  '/get-involved/apply',
  '/contact',
  '/verify',
  '/login',
] as const;

const SAMPLE_BRANCH_REPORT = '72d847f7-686c-4106-b22b-f450dc726a8c';

const APP_PAGES = [
  '/account',
  '/dashboard',
  '/dashboard/unrouted',
  '/reports',
  '/reports/review',
  `/reports/${SAMPLE_BRANCH_REPORT}`,
  `/share/reports/${SAMPLE_BRANCH_REPORT}`,
  '/collections',
  '/audit',
  '/people/members',
  '/people/applications',
  '/people/teams',
  '/content',
  '/content/events',
  '/admin/branches',
] as const;

type Violation = { directive: string; blocked: string; source: string };

declare global {
  interface Window {
    __cspViolations?: Violation[];
  }
}

/** Records every CSP violation in the page and every console line about the policy. */
async function watchCsp(page: Page): Promise<string[]> {
  const consoleLines: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/content security policy/i.test(text)) consoleLines.push(text);
  });
  // Init scripts are injected by the browser driver and are not subject to the page CSP.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations?.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        source: `${e.sourceFile}:${e.lineNumber}`,
      });
    });
  });
  return consoleLines;
}

async function expectPageRunsUnderCsp(page: Page, path: string, consoleLines: string[]) {
  const before = consoleLines.length;
  const response = await page.goto(path);
  expect.soft(response?.status(), `${path} status`).toBe(200);

  const csp = response?.headers()['content-security-policy'] ?? '';
  expect
    .soft(csp, `${path} CSP header`)
    .toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);

  await page.waitForLoadState('load');
  // The Next.js client runtime sets window.next once its (nonced) bootstrap script ran.
  const started = await page
    .waitForFunction(() => typeof (window as { next?: unknown }).next === 'object', null, {
      timeout: 10_000,
    })
    .then(() => true)
    .catch(() => false);
  expect.soft(started, `${path} Next.js runtime started`).toBe(true);

  // Let late chunks and effects run before collecting.
  await page.waitForTimeout(250);
  const violations = await page.evaluate(() => window.__cspViolations ?? []);
  expect.soft(violations, `${path} securitypolicyviolation events`).toEqual([]);
  expect.soft(consoleLines.slice(before), `${path} CSP console messages`).toEqual([]);
}

test.describe('content security policy in the browser', () => {
  test('public pages run without CSP violations', async ({ page, localePath }) => {
    test.setTimeout(120_000);
    const consoleLines = await watchCsp(page);
    for (const path of PUBLIC_PAGES) {
      await expectPageRunsUnderCsp(page, localePath(path), consoleLines);
    }
  });

  test('signed-in pages run without CSP violations', async ({ page, loginAs, localePath }) => {
    test.setTimeout(180_000);
    const consoleLines = await watchCsp(page);
    await loginAs('super_admin');
    for (const path of APP_PAGES) {
      await expectPageRunsUnderCsp(page, localePath(path), consoleLines);
    }
  });

  test('client components still work: language switch and theme toggle', async ({
    page,
    localePath,
    uiLocale,
  }) => {
    const consoleLines = await watchCsp(page);
    const other = uiLocale === 'en' ? 'ur' : 'en';
    await page.goto(localePath('/about'));
    await page.locator(`a[hreflang="${other}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${other}/about(?:[?#]|$)`));
    await expect(page.locator('html')).toHaveAttribute('lang', other);

    // The theme toggle is a client component: a click only works after hydration.
    const unpressed = page
      .locator('[role="group"] button[aria-pressed="false"]')
      .filter({ visible: true });
    if ((await unpressed.count()) > 0) {
      const html = page.locator('html');
      const before = await html.getAttribute('data-theme');
      const button = unpressed.first();
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => html.getAttribute('data-theme')).not.toBe(before);
    }

    const violations = await page.evaluate(() => window.__cspViolations ?? []);
    expect(violations).toEqual([]);
    expect(consoleLines).toEqual([]);
  });
});
