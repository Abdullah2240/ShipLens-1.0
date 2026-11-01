import type { APIResponse, Locator, Page } from '@playwright/test';
import { expect, type UiLocale } from '../../support/fixtures';
import { demoPassword, type Role } from '../../support/roles';

// Small helpers for the cross-role journeys. Specs import only the harness and this file;
// strings are copied from messages/{en,ur}/*.json because the runner mounts tests/e2e only.

/** Demo-dataset users (02-24 seed) that the five-role fixture does not cover. */
export const ISLAMABAD_LEAD = 'lead.islamabad@shiplens.test';
export const ISLAMABAD_BRANCH = 'Islamabad North (Demo)';

/** A short suffix that makes this run's names, purposes and emails unique. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function originOf(baseURL: string | undefined): string {
  if (!baseURL) throw new Error('baseURL is not configured');
  return new URL(baseURL).origin;
}

/** Logs in through the API by email (demo password); the cookie stays in the page context. */
export async function loginAsEmail(
  page: Page,
  baseURL: string | undefined,
  email: string,
): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: originOf(baseURL) },
    data: { email, password: demoPassword() },
    failOnStatusCode: false,
  });
  expect(response.status(), `login as ${email}`).toBe(200);
}

/** The page's own request context (same cookies), with the Origin header writes need. */
export function apiAs(page: Page, baseURL: string | undefined) {
  const headers = { Origin: originOf(baseURL) };
  return {
    get: (path: string): Promise<APIResponse> =>
      page.request.get(path, { headers, failOnStatusCode: false }),
    post: (path: string, data: unknown = {}): Promise<APIResponse> =>
      page.request.post(path, { headers, data, failOnStatusCode: false }),
  };
}

/** "PKR 12,345.60" -> 1234560 (minor units, integers only). */
export function minorUnits(text: string): number {
  const match = /PKR\s*(-?[\d,]+)\.(\d{2})/.exec(text);
  if (!match) throw new Error(`not a money string: ${text}`);
  const whole = Number((match[1] ?? '0').replaceAll(',', ''));
  return whole * 100 + Number(match[2]);
}

export const URDU_DIGITS = /[٠-٩۰-۹]/;
export const DIR: Readonly<Record<UiLocale, 'ltr' | 'rtl'>> = { en: 'ltr', ur: 'rtl' };

// messages/<locale>/shell.json: appNavLabel and notFound.title.
const APP_NAV_LABEL: Readonly<Record<UiLocale, string>> = { en: 'Primary', ur: 'مرکزی مینو' };
const NOT_FOUND_TITLE: Readonly<Record<UiLocale, string>> = {
  en: 'We could not find that page',
  ur: 'یہ صفحہ نہیں مل سکا',
};

export function primaryNav(page: Page, locale: UiLocale): Locator {
  return page.getByRole('navigation', { name: APP_NAV_LABEL[locale] });
}

/** The primary navigation links, in order: locale-less href and visible name. */
export async function navLinkNames(
  page: Page,
  locale: UiLocale,
): Promise<{ href: string; name: string }[]> {
  const links = await primaryNav(page, locale)
    .getByRole('link')
    .evaluateAll((anchors) =>
      anchors.map((a) => ({
        href: a.getAttribute('href') ?? '',
        name: (a.textContent ?? '').trim(),
      })),
    );
  const prefix = `/${locale}`;
  return links.map(({ href, name }) => ({
    href: href.startsWith(`${prefix}/`) ? href.slice(prefix.length) : href,
    name,
  }));
}

/** The localized not-found page, with no record data: no table and no report status. */
export async function expectForbiddenPage(
  page: Page,
  locale: UiLocale,
  response: { status(): number } | null,
): Promise<void> {
  expect(response?.status(), 'forbidden page status').toBe(404);
  await expect(
    page.getByRole('heading', { level: 1, name: NOT_FOUND_TITLE[locale] }),
  ).toBeVisible();
  await expect(page.locator('main table')).toHaveCount(0);
  await expect(page.getByTestId('report-status')).toHaveCount(0);
}

/**
 * Every text run in `root` that holds an ASCII digit or an @ (IDs, amounts, emails) sits in
 * a `bdi` or a `dir="ltr"` element, so RTL layout cannot reorder it. Returns the offenders.
 */
export async function unisolatedLatinRuns(root: Locator): Promise<string[]> {
  return root.evaluate((node) => {
    const offenders: string[] = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const value = text.textContent ?? '';
      if (!/[0-9@]/.test(value)) continue;
      const parent = text.parentElement;
      if (!parent || parent.closest('script, style, svg, [aria-hidden="true"], .sr-only')) continue;
      if (!parent.closest('bdi, [dir="ltr"]')) offenders.push(value.trim());
    }
    return offenders;
  });
}

/** Roles, in fixture order. */
export const ALL_ROLES: readonly Role[] = [
  'super_admin',
  'finance_reviewer',
  'content_editor',
  'branch_lead',
  'hr_lead',
];
