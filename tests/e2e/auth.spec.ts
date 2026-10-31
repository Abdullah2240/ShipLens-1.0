import type { Page } from '@playwright/test';
import { expect, test, type UiLocale } from './support/fixtures';
import { DEMO_BRANCH_NAME, demoPassword, ROLES_E2E, type Role } from './support/roles';

// Login, account and logout through the real pages. Specs never import app code, so the
// visible strings the checks rely on are pinned here (messages/<locale>/auth.json).
//
// Throttle budget: the only failed logins are in "a wrong password and an unknown email
// show the same message" (@desktop, so two projects): one random unknown address and one
// wrong password per project, for a different seeded email in each locale.

const TEXT = {
  en: {
    email: 'Email address',
    password: 'Password',
    submit: 'Sign in',
    logout: 'Sign out',
    invalidCredentials:
      'That email and password do not match an account. Check them and try again.',
    noBranch: 'Head office (not tied to one branch)',
    roles: {
      super_admin: 'Super Admin',
      finance_reviewer: 'Finance Reviewer',
      content_editor: 'Content Editor',
      branch_lead: 'Branch Lead',
      hr_lead: 'HR Lead',
    },
  },
  ur: {
    email: 'ای میل ایڈریس',
    password: 'پاس ورڈ',
    submit: 'سائن اِن کریں',
    logout: 'سائن آؤٹ',
    invalidCredentials:
      'یہ ای میل اور پاس ورڈ کسی اکاؤنٹ سے میل نہیں کھاتے۔ انہیں جانچ کر دوبارہ کوشش کریں۔',
    noBranch: 'ہیڈ آفس (کسی ایک شاخ سے منسلک نہیں)',
    roles: {
      super_admin: 'سپر ایڈمن',
      finance_reviewer: 'مالیاتی جائزہ کار',
      content_editor: 'مواد ایڈیٹر',
      branch_lead: 'شاخ لیڈ',
      hr_lead: 'ایچ آر لیڈ',
    },
  },
} as const satisfies Record<UiLocale, unknown>;

const DIR: Record<UiLocale, 'ltr' | 'rtl'> = { en: 'ltr', ur: 'rtl' };
const OTHER: Record<UiLocale, UiLocale> = { en: 'ur', ur: 'en' };
const BRANCH_ROLES: ReadonlySet<Role> = new Set(['branch_lead', 'hr_lead']);
// One seeded email per locale for the wrong-password check (desktop projects only).
const WRONG_PASSWORD_ROLE: Record<UiLocale, Role> = { en: 'content_editor', ur: 'hr_lead' };

const ROLE_ORDER: Role[] = [
  'super_admin',
  'finance_reviewer',
  'content_editor',
  'branch_lead',
  'hr_lead',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const atPath = (path: string) => new RegExp(`^[^?#]*${escape(path)}(?:[?#]|$)`);

async function submitLogin(page: Page, locale: UiLocale, email: string, password: string) {
  const text = TEXT[locale];
  await page.getByLabel(text.email, { exact: true }).fill(email);
  await page.getByLabel(text.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: text.submit, exact: true }).click();
}

async function signOutFromAccount(page: Page, locale: UiLocale) {
  await page
    .getByRole('main')
    .getByRole('button', { name: TEXT[locale].logout, exact: true })
    .click();
  await expect(page).toHaveURL(atPath(`/${locale}/login`));
}

// Ends the session without the UI, so the next login starts from the login page again.
async function signOutViaApi(page: Page, baseURL: string | undefined) {
  const response = await page.request.post('/api/v1/auth/logout', {
    headers: { Origin: new URL(baseURL ?? '').origin },
    failOnStatusCode: false,
  });
  expect(response.status(), 'logout').toBe(204);
}

test.describe('auth pages', () => {
  // Desktop projects only (en and ur); mobile projects drop @desktop through grepInvert.
  test(
    'every role signs in through the form, sees the account page and signs out',
    { tag: ['@smoke', '@desktop'] },
    async ({ page, uiLocale, localePath }) => {
      test.setTimeout(120_000);
      const text = TEXT[uiLocale];

      for (const role of ROLE_ORDER) {
        const { email, name } = ROLES_E2E[role];
        await test.step(role, async () => {
          await page.goto(localePath('/login'));
          await submitLogin(page, uiLocale, email, demoPassword());

          await expect(page).toHaveURL(atPath(`/${uiLocale}/account`));
          const main = page.getByRole('main');
          await expect(main.getByText(name, { exact: true }).first()).toBeVisible();
          await expect(main.getByText(text.roles[role], { exact: true })).toBeVisible();
          await expect(
            main.getByText(BRANCH_ROLES.has(role) ? DEMO_BRANCH_NAME : text.noBranch, {
              exact: true,
            }),
          ).toBeVisible();

          await signOutFromAccount(page, uiLocale);
        });
      }

      // The session is gone server-side: the account page sends us back to login.
      await page.goto(localePath('/account'));
      await expect(page).toHaveURL(atPath(`/${uiLocale}/login`));
    },
  );

  test('the account page needs a session and redirects to the localised login', async ({
    page,
    uiLocale,
    localePath,
  }) => {
    const response = await page.request.get(localePath('/account'), { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers()['location']).toMatch(atPath(`/${uiLocale}/login`));

    await page.goto(localePath('/account'));
    await expect(page).toHaveURL(atPath(`/${uiLocale}/login`));
  });

  test('the login page follows the locale, switches language in place, and the Branch Lead can sign in and out', async ({
    page,
    uiLocale,
    localePath,
  }) => {
    const text = TEXT[uiLocale];
    const other = OTHER[uiLocale];
    const html = page.locator('html');

    const response = await page.goto(localePath('/login'));
    expect(response?.status()).toBe(200);
    await expect(html).toHaveAttribute('lang', uiLocale);
    await expect(html).toHaveAttribute('dir', DIR[uiLocale]);

    // Labels are in the page language; an email address always reads left to right.
    const email = page.getByLabel(text.email, { exact: true });
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('dir', 'ltr');
    await expect(page.getByLabel(text.password, { exact: true })).toHaveAttribute(
      'type',
      'password',
    );

    // The language switcher keeps the user on the login page.
    await page.locator(`a[hreflang="${other}"]`).first().click();
    await expect(page).toHaveURL(atPath(`/${other}/login`));
    await expect(html).toHaveAttribute('lang', other);
    await expect(html).toHaveAttribute('dir', DIR[other]);
    await expect(page.getByLabel(TEXT[other].email, { exact: true })).toBeVisible();

    // Back in the project locale, the Branch Lead signs in and out.
    const { email: leadEmail, name } = ROLES_E2E.branch_lead;
    await page.goto(localePath('/login'));
    await submitLogin(page, uiLocale, leadEmail, demoPassword());
    await expect(page).toHaveURL(atPath(`/${uiLocale}/account`));
    await expect(page.getByRole('main').getByText(name, { exact: true }).first()).toBeVisible();
    await expect(html).toHaveAttribute('dir', DIR[uiLocale]);

    // Staying signed in across a reload.
    await page.reload();
    await expect(page).toHaveURL(atPath(`/${uiLocale}/account`));
    await expect(page.getByRole('main').getByText(name, { exact: true }).first()).toBeVisible();

    await signOutFromAccount(page, uiLocale);
  });

  test('the post-login redirect stays on this site', async ({
    page,
    baseURL,
    uiLocale,
    localePath,
  }) => {
    test.setTimeout(90_000);
    const { email } = ROLES_E2E.branch_lead;
    const origin = new URL(baseURL ?? '').origin;
    const other = OTHER[uiLocale];

    for (const next of ['https://evil.test/', '//evil.test/', '/\\evil.test']) {
      await test.step(`ignores next=${next}`, async () => {
        await page.goto(`${localePath('/login')}?next=${encodeURIComponent(next)}`);
        await submitLogin(page, uiLocale, email, demoPassword());
        await expect(page).toHaveURL(atPath(`/${uiLocale}/account`));
        expect(new URL(page.url()).origin).toBe(origin);
        await signOutViaApi(page, baseURL);
      });
    }

    await test.step('honours a same-site next path', async () => {
      const target = `/${uiLocale}/account`;
      await page.goto(`${localePath('/login')}?next=${encodeURIComponent(target)}`);
      await submitLogin(page, uiLocale, email, demoPassword());
      await expect(page).toHaveURL(atPath(target));
      await signOutViaApi(page, baseURL);
    });

    await test.step('keeps a locale-prefixed next path as given', async () => {
      // A path in the other language must not gain a second prefix (/en/ur/...).
      const target = `/${other}/about`;
      await page.goto(`${localePath('/login')}?next=${encodeURIComponent(target)}`);
      await submitLogin(page, uiLocale, email, demoPassword());
      await expect(page).toHaveURL(atPath(target));
      expect(new URL(page.url()).pathname).toBe(target);
      await signOutViaApi(page, baseURL);
    });
  });

  test(
    'a wrong password and an unknown email show the same message',
    { tag: '@desktop' },
    async ({ page, uiLocale, localePath }) => {
      const text = TEXT[uiLocale];
      const seeded = ROLES_E2E[WRONG_PASSWORD_ROLE[uiLocale]].email;
      const unknown = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@unknown.example.test`;
      const messages: string[] = [];

      for (const email of [unknown, seeded]) {
        await page.goto(localePath('/login'));
        await submitLogin(page, uiLocale, email, `${demoPassword()}-wrong`);
        const alert = page.getByRole('alert').filter({ hasText: text.invalidCredentials });
        await expect(alert).toBeVisible();
        await expect(alert).toBeFocused();
        await expect(page).toHaveURL(atPath(`/${uiLocale}/login`));
        await expect(page.getByLabel(text.email, { exact: true })).toHaveValue(email);
        await expect(page.getByLabel(text.password, { exact: true })).toHaveValue('');
        messages.push((await alert.innerText()).trim());
      }

      expect(messages[0]).toBe(text.invalidCredentials);
      expect(messages[1]).toBe(messages[0]);
    },
  );
});
