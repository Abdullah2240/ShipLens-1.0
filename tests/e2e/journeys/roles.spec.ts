import { expect, test, type UiLocale } from '../support/fixtures';
import type { Role } from '../support/roles';
import {
  ALL_ROLES,
  DIR,
  apiAs,
  expectForbiddenPage,
  navLinkNames,
  primaryNav,
  unisolatedLatinRuns,
} from './support/journey';

// Five-role access journey, read-only, in every project: each role signs in, sees exactly
// the navigation the permission table allows, is refused one page and one API call from
// the same session, then signs out through the UI and the session is dead on the server.

type NavEntry = {
  href: string;
  label: Record<UiLocale, string>;
  /** Roles the permission table grants the item's required action (none: every role). */
  roles: readonly Role[];
  /** Mirrors `live` in src/components/shell/nav.ts. */
  live: boolean | 'pending';
};

// Mirror of appNav in src/components/shell/nav.ts with the grants from
// src/platform/authz/permissions.ts; labels from messages/<locale>/shell.json (appNav.*).
// Dashboard and Audit log are `pending`: plan 03-17 flips them live. Until it merges they
// may be absent, and they may never appear for a role the permission table does not grant.
const APP_NAV: readonly NavEntry[] = [
  {
    href: '/account',
    label: { en: 'Account', ur: 'میرا اکاؤنٹ' },
    roles: ALL_ROLES,
    live: true,
  },
  {
    href: '/dashboard',
    label: { en: 'Dashboard', ur: 'ڈیش بورڈ' },
    roles: ['super_admin', 'finance_reviewer'],
    live: 'pending',
  },
  {
    href: '/admin/branches',
    label: { en: 'Branches', ur: 'شاخیں' },
    roles: ['super_admin', 'finance_reviewer', 'branch_lead', 'hr_lead'],
    live: true,
  },
  {
    href: '/collections',
    label: { en: 'Collections', ur: 'وصولیاں' },
    roles: ['super_admin', 'finance_reviewer', 'branch_lead'],
    live: true,
  },
  {
    href: '/reports',
    label: { en: 'Reports', ur: 'رپورٹس' },
    roles: ['super_admin', 'finance_reviewer', 'branch_lead'],
    live: true,
  },
  {
    href: '/people/applications',
    label: { en: 'Applications', ur: 'درخواستیں' },
    roles: ['super_admin', 'hr_lead'],
    live: true,
  },
  {
    href: '/people/members',
    label: { en: 'Members', ur: 'ارکان' },
    roles: ['super_admin', 'hr_lead', 'branch_lead'],
    live: true,
  },
  {
    href: '/people/teams',
    label: { en: 'Teams', ur: 'ٹیمیں' },
    roles: ['super_admin', 'hr_lead', 'branch_lead'],
    live: true,
  },
  {
    href: '/content',
    label: { en: 'Content', ur: 'مواد' },
    roles: ['content_editor', 'super_admin'],
    live: true,
  },
  {
    href: '/audit',
    label: { en: 'Audit log', ur: 'آڈٹ لاگ' },
    roles: ['finance_reviewer', 'super_admin'],
    live: 'pending',
  },
];

// One forbidden page and one forbidden API call per role (Super Admin may do everything
// these screens offer).
const FORBIDDEN: Readonly<Record<Role, { page: string; api: string } | null>> = {
  branch_lead: { page: '/dashboard', api: '/api/v1/dashboard/summary' },
  hr_lead: { page: '/reports/review', api: '/api/v1/reports/review-queue' },
  content_editor: { page: '/people/applications', api: '/api/v1/applications' },
  finance_reviewer: { page: '/content', api: '/api/v1/content/entries' },
  super_admin: null,
};

// messages/<locale>/auth.json: account.logout.
const SIGN_OUT: Readonly<Record<UiLocale, string>> = { en: 'Sign out', ur: 'سائن آؤٹ' };

test.describe('five-role access journey', { tag: '@smoke' }, () => {
  for (const role of ALL_ROLES) {
    test(`${role} sees its navigation, is refused what it may not do, and signs out`, async ({
      page,
      baseURL,
      loginAs,
      localePath,
      uiLocale,
    }) => {
      const user = await loginAs(role);
      const response = await page.goto(localePath('/account'));
      expect(response?.status()).toBe(200);

      const html = page.locator('html');
      await expect(html).toHaveAttribute('lang', uiLocale);
      await expect(html).toHaveAttribute('dir', DIR[uiLocale]);

      // Navigation: exactly the live items the permission table grants, in nav order.
      await expect(primaryNav(page, uiLocale)).toBeVisible();
      const links = await navLinkNames(page, uiLocale);
      const pending = APP_NAV.filter((item) => item.live === 'pending').map((item) => item.href);
      const expected = APP_NAV.filter((item) => item.live === true && item.roles.includes(role));
      expect(
        links.filter((link) => !pending.includes(link.href)),
        `navigation of ${role}`,
      ).toEqual(expected.map((item) => ({ href: item.href, name: item.label[uiLocale] })));
      for (const link of links.filter((entry) => pending.includes(entry.href))) {
        const item = APP_NAV.find((entry) => entry.href === link.href)!;
        expect(item.roles, `${link.href} shown to ${role}`).toContain(role);
        expect(link.name).toBe(item.label[uiLocale]);
      }

      if (uiLocale === 'ur') {
        // The email and any other Latin run on the landing screen keep LTR order.
        await expect(page.locator('main bdi[dir="ltr"]', { hasText: user.email })).toHaveCount(1);
        expect(await unisolatedLatinRuns(page.locator('main'))).toEqual([]);
      }

      // A forbidden page and API call from the same session.
      const forbidden = FORBIDDEN[role];
      if (forbidden) {
        const refused = await page.goto(localePath(forbidden.page));
        await expectForbiddenPage(page, uiLocale, refused);

        const api = await apiAs(page, baseURL).get(forbidden.api);
        expect(api.status(), `GET ${forbidden.api} as ${role}`).toBe(403);
        expect(((await api.json()) as { error: { code: string } }).error.code).toBe('forbidden');
        await page.goto(localePath('/account'));
      }

      // Sign out through the header button; the old cookie no longer opens a session.
      const cookies = await page.context().cookies();
      await page
        .getByRole('banner')
        .getByRole('button', { name: SIGN_OUT[uiLocale], exact: true })
        .click();
      await expect(page).toHaveURL((url) => url.pathname === `/${uiLocale}/login`);
      const me = await page.request.get('/api/v1/auth/me', { failOnStatusCode: false });
      expect(me.status(), '/api/v1/auth/me after sign-out').toBe(401);

      await page.context().addCookies(cookies);
      const replayed = await page.request.get('/api/v1/auth/me', { failOnStatusCode: false });
      expect(replayed.status(), 'the old session cookie after sign-out').toBe(401);
    });
  }
});
