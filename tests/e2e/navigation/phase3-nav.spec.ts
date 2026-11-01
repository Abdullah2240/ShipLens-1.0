import type { Page } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';
import type { Role } from '../support/roles';

// Head office reaches the dashboard and the audit log from the primary navigation; other
// roles never see either entry. Signed out, every public page links to the impact page.
// Read-only, so it runs in every project.

// Strings copied from messages/<locale>/shell.json (appNavLabel, publicNavLabel, appNav.*,
// nav.impact), dashboard.json (title), audit.json (viewer.title) and impact.json
// (hero.title); the runner mounts only tests/e2e, not messages/.
const APP_NAV_LABEL = { en: 'Primary', ur: 'مرکزی مینو' } as const;
const PUBLIC_NAV_LABEL = { en: 'Main', ur: 'مرکزی صفحات' } as const;
const DIR = { en: 'ltr', ur: 'rtl' } as const;
const LOCALES: UiLocale[] = ['en', 'ur'];

type HeadOfficeItem = 'dashboard' | 'audit';

const ITEMS: Record<
  HeadOfficeItem,
  { href: string; label: Record<UiLocale, string>; heading: Record<UiLocale, string> }
> = {
  dashboard: {
    href: '/dashboard',
    label: { en: 'Dashboard', ur: 'ڈیش بورڈ' },
    heading: { en: 'Funds overview', ur: 'فنڈز کا جائزہ' },
  },
  audit: {
    href: '/audit',
    label: { en: 'Audit log', ur: 'آڈٹ ریکارڈ' },
    heading: { en: 'Audit trail', ur: 'آڈٹ ریکارڈ' },
  },
};
const ORDER: HeadOfficeItem[] = ['dashboard', 'audit'];

const IMPACT = {
  label: { en: 'Our impact', ur: 'ہمارا اثر' },
  heading: {
    en: 'Every rupee here has been checked and approved.',
    ur: 'یہاں دکھایا گیا ہر روپیہ جانچا اور منظور کیا جا چکا ہے۔',
  },
} as const;

const PUBLIC_PAGES = [
  '/',
  '/about',
  '/programs',
  '/branches',
  '/events',
  '/impact',
  '/get-involved',
  '/contact',
];

const HEAD_OFFICE: Role[] = ['super_admin', 'finance_reviewer'];
const OTHERS: Role[] = ['branch_lead', 'hr_lead', 'content_editor'];

const localized = (locale: UiLocale, path: string) => `/${locale}${path === '/' ? '' : path}`;

const primaryNav = (page: Page, locale: UiLocale) =>
  page.getByRole('navigation', { name: APP_NAV_LABEL[locale] });

const publicNav = (page: Page, locale: UiLocale) =>
  page.getByRole('navigation', { name: PUBLIC_NAV_LABEL[locale] });

/** Head office entries present in the primary navigation, in the order they appear. */
async function headOfficeEntries(page: Page, locale: UiLocale): Promise<HeadOfficeItem[]> {
  const hrefs = await primaryNav(page, locale)
    .getByRole('link')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
  return hrefs.flatMap((href) => ORDER.filter((id) => href === localized(locale, ITEMS[id].href)));
}

async function openAccount(page: Page, locale: UiLocale) {
  const response = await page.goto(localized(locale, '/account'));
  expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('dir', DIR[locale]);
  await expect(primaryNav(page, locale)).toBeVisible();
}

test.describe('head office navigation', () => {
  for (const role of HEAD_OFFICE) {
    test(`${role} reaches the dashboard and the audit log from the navigation`, async ({
      page,
      loginAs,
      uiLocale,
    }) => {
      await loginAs(role);
      await openAccount(page, uiLocale);
      expect(await headOfficeEntries(page, uiLocale), `entries for ${role}`).toEqual(ORDER);

      for (const id of ORDER) {
        const item = ITEMS[id];
        const path = localized(uiLocale, item.href);
        const link = primaryNav(page, uiLocale).getByRole('link', {
          name: item.label[uiLocale],
          exact: true,
        });
        await expect(link).toHaveAttribute('href', path);
        await link.click();
        await expect(page).toHaveURL((url) => url.pathname === path);
        await expect(
          page.getByRole('heading', { level: 1, name: item.heading[uiLocale], exact: true }),
        ).toBeVisible();
        await expect(
          primaryNav(page, uiLocale).getByRole('link', {
            name: item.label[uiLocale],
            exact: true,
          }),
        ).toHaveAttribute('aria-current', 'page');
      }
    });
  }

  for (const role of OTHERS) {
    test(`${role} sees neither the dashboard nor the audit log`, async ({
      page,
      loginAs,
      uiLocale,
    }) => {
      await loginAs(role);
      await openAccount(page, uiLocale);
      expect(await headOfficeEntries(page, uiLocale), `entries for ${role}`).toEqual([]);
      for (const id of ORDER) {
        await expect(
          primaryNav(page, uiLocale).getByRole('link', {
            name: ITEMS[id].label[uiLocale],
            exact: true,
          }),
        ).toHaveCount(0);
      }
    });
  }
});

test.describe('public impact navigation', () => {
  test('every public page links to the impact page', async ({ page, uiLocale }) => {
    for (const path of PUBLIC_PAGES) {
      const response = await page.goto(localized(uiLocale, path));
      expect(response?.status(), `GET ${path}`).toBe(200);
      const link = publicNav(page, uiLocale).getByRole('link', {
        name: IMPACT.label[uiLocale],
        exact: true,
      });
      await expect(link, `impact link on ${path}`).toHaveAttribute(
        'href',
        localized(uiLocale, '/impact'),
      );
    }
  });

  for (const locale of LOCALES) {
    test(`the ${locale} impact item opens the impact page`, async ({ page }) => {
      await page.goto(localized(locale, '/'));
      await expect(page.locator('html')).toHaveAttribute('dir', DIR[locale]);
      const link = publicNav(page, locale).getByRole('link', {
        name: IMPACT.label[locale],
        exact: true,
      });
      // On phones the item may sit past the visible part of the scrolling nav.
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      await link.click();
      const path = localized(locale, '/impact');
      await expect(page).toHaveURL((url) => url.pathname === path);
      await expect(
        page.getByRole('heading', { level: 1, name: IMPACT.heading[locale], exact: true }),
      ).toBeVisible();
      await expect(
        publicNav(page, locale).getByRole('link', { name: IMPACT.label[locale], exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    });
  }

  test('keyboard Tab reaches the impact item and Enter opens it', async ({ page, uiLocale }) => {
    await page.goto(localized(uiLocale, '/'));
    const target = localized(uiLocale, '/impact');
    let reached = false;
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(
        (href) => document.activeElement?.getAttribute('href') === href,
        target,
      );
    }
    expect(reached, 'impact link reached by Tab').toBe(true);
    const link = publicNav(page, uiLocale).getByRole('link', {
      name: IMPACT.label[uiLocale],
      exact: true,
    });
    await expect(link).toBeFocused();
    await expect(link).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL((url) => url.pathname === target);
  });
});
