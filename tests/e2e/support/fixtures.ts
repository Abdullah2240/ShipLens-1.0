import { test as base, expect } from '@playwright/test';
import { isMissing, PENDING, requireFeature } from './probe';
import { demoPassword, ROLES_E2E, type Role } from './roles';

export type UiLocale = 'en' | 'ur';
export type Theme = 'light' | 'dark';

/** Per-project options, set in playwright.config.ts. */
export type FixtureOptions = {
  uiLocale: UiLocale;
  theme: Theme;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchId: string | null;
};

type Fixtures = {
  /** Log in through the API as a seeded role; the session cookie stays in the browser context. */
  loginAs: (role: Role) => Promise<SessionUser>;
  /** Prefix a locale-less path with the project's locale: localePath('/login') -> '/ur/login'. */
  localePath: (path: string) => string;
};

function originOf(baseURL: string | undefined): string {
  if (!baseURL) throw new Error('baseURL is not configured');
  return new URL(baseURL).origin;
}

export const test = base.extend<FixtureOptions & Fixtures>({
  uiLocale: ['en', { option: true }],
  theme: [
    async ({ colorScheme }, provide) => {
      await provide(colorScheme === 'dark' ? 'dark' : 'light');
    },
    { option: true },
  ],

  // The app renders data-theme from the `theme` cookie, so the page matches the project.
  context: async ({ context, theme, baseURL }, provide) => {
    await context.addCookies([{ name: 'theme', value: theme, url: originOf(baseURL) }]);
    await provide(context);
  },

  localePath: async ({ uiLocale }, provide) => {
    await provide((path: string) => `/${uiLocale}${path === '/' ? '' : path}`);
  },

  loginAs: async ({ page, baseURL }, provide) => {
    const origin = originOf(baseURL);
    await provide(async (role: Role) => {
      const { email } = ROLES_E2E[role];
      const response = await page.request.post('/api/v1/auth/login', {
        headers: { Origin: origin },
        data: { email, password: demoPassword() },
        failOnStatusCode: false,
      });
      requireFeature(!isMissing(response), PENDING.authApi);
      expect(response.status(), `login as ${role}`).toBe(200);

      const me = await page.request.get('/api/v1/auth/me', { failOnStatusCode: false });
      expect(me.status(), 'GET /api/v1/auth/me after login').toBe(200);
      const { user } = (await me.json()) as { user: SessionUser };
      expect(user.role, `seeded role for ${email}`).toBe(role);
      return user;
    });
  },
});

export { expect };
