import type { Page } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';
import { demoPassword, ROLES_E2E } from '../support/roles';

// WhatsApp share (WA-01, WA-02): the Branch Lead shares a report summary through wa.me,
// and the shared link is an ordinary sign-in protected, scoped page. Specs never import app
// code, so the visible strings the checks rely on are pinned here (messages/<locale>/*.json).

// From db/seed/data/reports.json (the seed data is not mounted in the runner): an approved
// Sample Branch report, readable by the Sample Branch lead (the `branch_lead` role) only.
const SAMPLE_BRANCH_REPORT = '72d847f7-686c-4106-b22b-f450dc726a8c';
const LAHORE_LEAD = 'lead.lahore@shiplens.test';

const TEXT = {
  en: {
    share: 'Share to WhatsApp',
    approved: 'Approved',
    email: 'Email address',
    password: 'Password',
    submit: 'Sign in',
    notFound: 'We could not find that page',
  },
  ur: {
    share: 'واٹس ایپ پر شیئر کریں',
    approved: 'منظور شدہ',
    email: 'ای میل ایڈریس',
    password: 'پاس ورڈ',
    submit: 'سائن اِن کریں',
    notFound: 'یہ صفحہ نہیں مل سکا',
  },
} as const;

interface ReportJson {
  id: string;
  branchCode: string;
  branchName: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  amount: string;
  count: number;
  collections: { id: string; purpose: string }[];
}

/** "PKR 1,234.50" from a decimal string, the same rule as the app's money formatter. */
function formatMoney(amount: string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  return `PKR ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}`;
}

/** A business date formatted by the browser's own Intl data, as the app does. */
function formatDateIn(page: Page, date: string, locale: UiLocale): Promise<string> {
  return page.evaluate(
    ([value, loc]) => {
      const [y, m, d] = value.split('-').map((part) => parseInt(part, 10));
      return new Intl.DateTimeFormat(loc === 'ur' ? 'ur-PK-u-nu-latn' : 'en-GB-u-nu-latn', {
        calendar: 'gregory',
        numberingSystem: 'latn',
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(Date.UTC(y!, m! - 1, d!, 12)));
    },
    [date, locale] as const,
  );
}

async function loginThroughForm(page: Page, locale: UiLocale, email: string): Promise<void> {
  const text = TEXT[locale];
  await page.getByLabel(text.email, { exact: true }).fill(email);
  await page.getByLabel(text.password, { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: text.submit, exact: true }).click();
}

async function loginAsEmail(page: Page, baseURL: string | undefined, email: string) {
  const response = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: new URL(baseURL!).origin },
    data: { email, password: demoPassword() },
    failOnStatusCode: false,
  });
  expect(response.status(), `login as ${email}`).toBe(200);
}

const sharePath = (locale: UiLocale) => `/${locale}/share/reports/${SAMPLE_BRANCH_REPORT}`;

test.describe('WhatsApp share', () => {
  test.describe.configure({ mode: 'serial' });

  test('the Branch Lead shares a minimal summary through wa.me, and it is audited', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-en-light', 'writes an audit row; runs once');
    // Never reach the real WhatsApp, and capture the window the button opens.
    await page.route('https://wa.me/**', (route) => route.abort());
    await page.addInitScript(() => {
      const opened: unknown[][] = [];
      (window as unknown as { __opened: unknown[][] }).__opened = opened;
      window.open = (...args: unknown[]) => {
        opened.push(args);
        return null;
      };
    });

    await loginAs('branch_lead');
    const api = await page.request.get(`/api/v1/reports/${SAMPLE_BRANCH_REPORT}`);
    expect(api.status()).toBe(200);
    const report = ((await api.json()) as { data: ReportJson }).data;
    expect(report.status).toBe('approved');

    await page.goto(localePath(`/reports/${SAMPLE_BRANCH_REPORT}`));
    const button = page.getByRole('button', { name: TEXT[uiLocale].share });
    await expect(button).toBeVisible();
    const shared = page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/reports/${SAMPLE_BRANCH_REPORT}/share`) && r.ok(),
    );
    await button.click();
    const reply = (await (await shared).json()) as {
      data: { summary: { reportId: string }; link: string };
    };

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened))
      .toHaveLength(1);
    const [[href, target, features]] = (await page.evaluate(
      () => (window as unknown as { __opened: unknown[][] }).__opened,
    )) as [[string, string, string]];
    expect(target).toBe('_blank');
    expect(features).toBe('noopener');
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(href.slice('https://wa.me/?text='.length));
    const lines = text.split('\n');
    expect(lines).toHaveLength(5);

    expect(text).toContain(report.branchCode);
    expect(text).toContain(await formatDateIn(page, report.weekStart, uiLocale));
    expect(text).toContain(await formatDateIn(page, report.weekEnd, uiLocale));
    expect(text).toContain(TEXT[uiLocale].approved);
    expect(text).toContain(formatMoney(report.amount));
    expect(text).toContain(`${report.count} collection`);
    expect(lines[4]!.endsWith(`/${uiLocale}/share/reports/${SAMPLE_BRANCH_REPORT}`)).toBe(true);
    expect(lines[4]).toContain(reply.data.link);
    for (const c of report.collections) {
      expect(text).not.toContain(c.id);
      if (c.purpose.trim().length > 3) expect(text).not.toContain(c.purpose);
    }

    // The share is in the audit log, without any figure.
    await page.context().clearCookies();
    await loginAs('super_admin');
    const audit = await page.request.get(
      `/api/v1/audit?action=report.share&entityId=${SAMPLE_BRANCH_REPORT}`,
    );
    expect(audit.status()).toBe(200);
    const { items } = (
      (await audit.json()) as {
        data: { items: { action: string; entityType: string; reportId: string; after: unknown }[] };
      }
    ).data;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]).toMatchObject({
      action: 'report.share',
      entityType: 'share',
      reportId: SAMPLE_BRANCH_REPORT,
      after: { channel: 'whatsapp' },
    });
  });

  test('signed out, the shared link goes through login (same-origin next) to the report', async ({
    page,
    uiLocale,
  }) => {
    await page.goto(sharePath(uiLocale));
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === `/${uiLocale}/login` &&
        url.searchParams.get('next') === sharePath(uiLocale)
      );
    });
    await loginThroughForm(page, uiLocale, ROLES_E2E.branch_lead.email);
    await expect(page).toHaveURL(
      (url) => url.pathname === `/${uiLocale}/reports/${SAMPLE_BRANCH_REPORT}`,
    );
    await expect(page.getByTestId('report-status')).toBeVisible();
  });

  test("another branch's lead opening the link gets the not-found page", async ({
    page,
    baseURL,
    uiLocale,
  }) => {
    await loginAsEmail(page, baseURL, LAHORE_LEAD);
    await page.goto(sharePath(uiLocale));
    await expect(page.getByRole('heading', { name: TEXT[uiLocale].notFound })).toBeVisible();
    await expect(page.getByTestId('report-status')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(sharePath(uiLocale));
  });

  test('a foreign next path is ignored: login lands on the account page', async ({
    page,
    uiLocale,
  }) => {
    await page.goto(`/${uiLocale}/login?next=${encodeURIComponent('//evil.test')}`);
    await loginThroughForm(page, uiLocale, ROLES_E2E.branch_lead.email);
    await expect(page).toHaveURL((url) => url.pathname === `/${uiLocale}/account`);
    expect(new URL(page.url()).host).not.toContain('evil.test');
  });
});
