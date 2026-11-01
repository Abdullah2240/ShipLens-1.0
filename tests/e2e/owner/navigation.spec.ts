import type { Page } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';
import type { Role } from '../support/roles';

// Each role reaches the branches, collections and reports screens from the primary
// navigation, in both languages. Read-only, so it runs in every project.

// Strings copied from messages/<locale>/shell.json (appNavLabel, appNav.*) and the page
// titles in messages/<locale>/{branches,collections,reports}.json; the runner mounts only
// tests/e2e, not messages/.
const APP_NAV_LABEL = { en: 'Primary', ur: 'مرکزی مینو' } as const;
const DIR = { en: 'ltr', ur: 'rtl' } as const;

type OwnerItem = 'branches' | 'collections' | 'reports';

const ITEMS: Record<
  OwnerItem,
  { href: string; label: Record<UiLocale, string>; heading: Record<UiLocale, string> }
> = {
  branches: {
    href: '/admin/branches',
    label: { en: 'Branches', ur: 'شاخیں' },
    heading: { en: 'Branches', ur: 'شاخیں' },
  },
  collections: {
    href: '/collections',
    label: { en: 'Collections', ur: 'وصولیاں' },
    heading: { en: 'Collections', ur: 'وصولیاں' },
  },
  reports: {
    href: '/reports',
    label: { en: 'Reports', ur: 'رپورٹس' },
    heading: { en: 'Weekly reports', ur: 'ہفتہ وار رپورٹیں' },
  },
};
const ORDER: OwnerItem[] = ['branches', 'collections', 'reports'];

// The owner entries each role may see, in navigation order (the permission table grants
// branch.read, collection.read and report.read).
const EXPECTED: Record<Role, OwnerItem[]> = {
  super_admin: ['branches', 'collections', 'reports'],
  finance_reviewer: ['branches', 'collections', 'reports'],
  branch_lead: ['branches', 'collections', 'reports'],
  hr_lead: ['branches'],
  content_editor: [],
};

const primaryNav = (page: Page, locale: UiLocale) =>
  page.getByRole('navigation', { name: APP_NAV_LABEL[locale] });

/** Owner entries present in the primary navigation, in the order they appear. */
async function ownerEntries(page: Page, locale: UiLocale): Promise<OwnerItem[]> {
  const hrefs = await primaryNav(page, locale)
    .getByRole('link')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
  return hrefs.flatMap((href) => ORDER.filter((id) => href === `/${locale}${ITEMS[id].href}`));
}

async function walkOwnerNav(page: Page, role: Role, locale: UiLocale) {
  const response = await page.goto(`/${locale}/account`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('dir', DIR[locale]);
  await expect(primaryNav(page, locale)).toBeVisible();

  expect(await ownerEntries(page, locale), `owner entries for ${role}`).toEqual(EXPECTED[role]);

  for (const id of EXPECTED[role]) {
    const item = ITEMS[id];
    const path = `/${locale}${item.href}`;
    const link = primaryNav(page, locale).getByRole('link', {
      name: item.label[locale],
      exact: true,
    });
    await expect(link).toHaveAttribute('href', path);
    await link.click();
    await expect(page).toHaveURL((url) => url.pathname === path);
    await expect(
      page.getByRole('heading', { level: 1, name: item.heading[locale], exact: true }),
    ).toBeVisible();
    await expect(
      primaryNav(page, locale).getByRole('link', { name: item.label[locale], exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    // The server renders the page itself, not the not-found or error page.
    const direct = await page.request.get(path, { failOnStatusCode: false });
    expect(direct.status(), `GET ${path} as ${role}`).toBe(200);
  }
}

test.describe('owner navigation', () => {
  for (const role of Object.keys(EXPECTED) as Role[]) {
    test(`${role} reaches exactly its owner screens from the navigation`, async ({
      page,
      loginAs,
      uiLocale,
    }) => {
      await loginAs(role);
      await walkOwnerNav(page, role, uiLocale);
    });
  }

  for (const role of ['branch_lead', 'finance_reviewer'] as const) {
    test(`${role} reaches its owner screens from the Urdu navigation`, async ({
      page,
      loginAs,
      uiLocale,
    }) => {
      test.skip(uiLocale === 'ur', 'covered by the per-role test in the Urdu projects');
      await loginAs(role);
      await walkOwnerNav(page, role, 'ur');
    });
  }
});
