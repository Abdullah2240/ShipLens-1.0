import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';

// The "not yet routed" page (DASH-04) and the routing flow (COLL-06). Specs never import app
// code, so the visible strings the checks rely on are pinned here (messages/<locale>/unrouted.json).

const TEXT = {
  en: {
    tabs: { label: 'Routing lists', open: 'Not yet routed', recent: 'Recently routed' },
    markFor: 'Mark as sent: ',
    undoFor: 'Undo routing: ',
    confirmMarkTitle: 'Mark as sent to the main account?',
    confirmMark: 'Mark as sent',
    confirmUndoTitle: 'Undo routing?',
    confirmUndo: 'Undo routing',
    marked: 'Marked as sent: ',
    undone: 'Routing undone: ',
  },
  ur: {
    tabs: { label: 'منتقلی کی فہرستیں', open: 'منتقلی باقی', recent: 'حال ہی میں منتقل شدہ' },
    markFor: 'منتقل شدہ نشان زد کریں: ',
    undoFor: 'منتقلی واپس لیں: ',
    confirmMarkTitle: 'مرکزی اکاؤنٹ میں منتقل شدہ نشان زد کریں؟',
    confirmMark: 'نشان زد کریں',
    confirmUndoTitle: 'منتقلی واپس لیں؟',
    confirmUndo: 'منتقلی واپس لیں',
    marked: 'منتقل شدہ نشان زد کر دی گئی: ',
    undone: 'منتقلی واپس لے لی گئی: ',
  },
} as const satisfies Record<UiLocale, unknown>;

const PATH = '/dashboard/unrouted';
const MUTATING_PROJECT = 'desktop-en-light';

type Figure = { value: string; recordCount: number };
type UnroutedItem = {
  collectionId: string;
  branchCode: string;
  collectedOn: string;
  amount: string;
};

/** Same output as the app's money formatter: "PKR 1,234.50" in both locales. */
function money(amount: string): string {
  const [whole = '0', fraction = ''] = amount.replace(/^-/, '').split('.');
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount.startsWith('-') ? '-' : ''}PKR ${grouped}.${fraction.padEnd(2, '0')}`;
}

function toMinor(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = amount.replace(/^-/, '').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -minor : minor;
}

function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const cents = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${abs / 100n}.${cents}`;
}

/** Business date as the app shows it (PKT calendar day, Latin digits). */
function businessDate(value: string, locale: UiLocale): string {
  const [y = 0, m = 1, d = 1] = value.split('-').map((part) => parseInt(part, 10));
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB-u-nu-latn' : 'ur-PK-u-nu-latn', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function summaryOf(item: UnroutedItem, locale: UiLocale): string {
  const sep = locale === 'en' ? ', ' : '، ';
  return [item.branchCode, businessDate(item.collectedOn, locale), money(item.amount)].join(sep);
}

async function readData<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path, { failOnStatusCode: false });
  expect(response.status(), `GET ${path}`).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

async function notYetRouted(request: APIRequestContext): Promise<Figure> {
  const summary = await readData<{ figures: { not_yet_routed: Figure } }>(
    request,
    '/api/v1/dashboard/summary',
  );
  return summary.figures.not_yet_routed;
}

/**
 * The footer total equals the Not yet routed figure the API reports for the same filter.
 * Retried with a fresh read and reload, because the routing spec may change the figure
 * between the two reads in a parallel worker.
 */
async function expectFooterMatchesFigure(page: Page, query = '') {
  const foot = page.getByRole('main').getByRole('table').locator('tfoot');
  await expect(async () => {
    const summary = await readData<{ figures: { not_yet_routed: Figure } }>(
      page.request,
      `/api/v1/dashboard/summary${query}`,
    );
    await page.reload();
    await expect(foot).toContainText(money(summary.figures.not_yet_routed.value), {
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
}

/** The Open / Recently routed tab links (the header figure also names the figure). */
function tabsOf(main: Locator, locale: UiLocale): Locator {
  return main.getByRole('navigation', { name: TEXT[locale].tabs.label });
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `test-results/screens/unrouted/${testInfo.project.name}-${name}.png`,
    fullPage: true,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal page overflow in px').toBeLessThanOrEqual(0);
}

test.describe('not yet routed page', () => {
  test('lists unrouted collections whose total equals the Not yet routed figure', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }, testInfo) => {
    await loginAs('finance_reviewer');
    const figure = await notYetRouted(page.request);

    const response = await page.goto(localePath(PATH));
    expect(response?.status()).toBe(200);
    const main = page.getByRole('main');
    const table = main.getByRole('table');

    if (figure.recordCount > 0) {
      await expectFooterMatchesFigure(page);
      const first = table.locator('tbody tr').first();
      await expect(first.getByRole('link').first()).toHaveAttribute(
        'href',
        new RegExp(
          `/${uiLocale}/dashboard/kpi/not-yet-routed/branches/[^/]+/reports/[^/]+/collections/[^/?]+$`,
        ),
      );
      await expect(
        first.getByRole('button', { name: new RegExp(`^${TEXT[uiLocale].markFor}`) }),
      ).toBeVisible();
    } else {
      await expect(table).toHaveCount(0);
    }
    await expect(
      tabsOf(main, uiLocale).getByRole('link', { name: new RegExp(TEXT[uiLocale].tabs.open) }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('html')).toHaveAttribute('dir', uiLocale === 'ur' ? 'rtl' : 'ltr');
    await screenshot(page, testInfo, 'open');
    await expectNoHorizontalOverflow(page);

    await tabsOf(main, uiLocale)
      .getByRole('link', { name: TEXT[uiLocale].tabs.recent, exact: true })
      .click();
    await expect(page).toHaveURL(/[?&]tab=recent/);
    await expect(
      tabsOf(main, uiLocale).getByRole('link', { name: TEXT[uiLocale].tabs.recent, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await screenshot(page, testInfo, 'recent');
    await expectNoHorizontalOverflow(page);
  });

  test('keeps the branch filter and the page in the URL', async ({ page, loginAs, localePath }) => {
    await loginAs('finance_reviewer');
    const all = await readData<{ total: number; items: { branchId: string }[] }>(
      page.request,
      '/api/v1/dashboard/unrouted?pageSize=1',
    );
    test.skip(all.total === 0, 'no unrouted collections in this dataset');
    const branchId = all.items[0]!.branchId;

    await page.goto(localePath(PATH));
    const main = page.getByRole('main');
    await main.getByRole('combobox').selectOption(branchId);
    await main.getByRole('search').locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`[?&]branch=${branchId}`));

    await expect(main.getByRole('combobox')).toHaveValue(branchId);
    await expectFooterMatchesFigure(page, `?branch=${branchId}`);
  });

  test('is not found for roles outside head office', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    // The not-found page title (messages shell.notFound.title).
    const notFound = { en: 'We could not find that page', ur: 'یہ صفحہ نہیں مل سکا' } as const;
    for (const role of ['branch_lead', 'content_editor'] as const) {
      await page.context().clearCookies();
      await loginAs(role);
      const response = await page.goto(localePath(PATH));
      // 404, or 200 when the dashboard loading shell was already streamed before the refusal.
      expect([200, 404], `${role} on ${PATH}`).toContain(response?.status());
      await expect(page.getByRole('heading', { name: notFound[uiLocale] })).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    }
  });
});

test.describe('routing to the main account', () => {
  test.describe.configure({ mode: 'serial' });

  test('mark the oldest collection as sent, then undo it', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== MUTATING_PROJECT, 'mutates shared routing state');
    test.setTimeout(90_000);
    await loginAs('finance_reviewer');
    const origin = new URL(baseURL ?? '').origin;

    const oldest = await readData<{ items: UnroutedItem[]; total: number }>(
      page.request,
      '/api/v1/dashboard/unrouted?page=1&pageSize=1',
    );
    test.skip(oldest.total === 0, 'no unrouted collections in this dataset');
    const item = oldest.items[0]!;
    const summary = summaryOf(item, uiLocale);
    const text = TEXT[uiLocale];
    let routed = false;

    try {
      const before = await notYetRouted(page.request);
      await page.goto(localePath(PATH));
      const main = page.getByRole('main');
      const foot = main.getByRole('table').locator('tfoot');
      await expect(foot).toContainText(money(before.value));

      const mark = main.getByRole('button', { name: `${text.markFor}${summary}`, exact: true });
      await expect(main.locator('tbody tr').first().getByRole('button')).toHaveAccessibleName(
        `${text.markFor}${summary}`,
      );
      await mark.click();
      const confirmMark = page.getByRole('dialog', { name: text.confirmMarkTitle });
      await expect(confirmMark).toContainText(summary);
      await confirmMark.getByRole('button', { name: text.confirmMark, exact: true }).click();
      routed = true;

      await expect(page.getByText(`${text.marked}${summary}`)).toBeVisible();
      await expect(mark).toHaveCount(0);
      const less = fromMinor(toMinor(before.value) - toMinor(item.amount));
      await expect(foot).toContainText(money(less));
      expect((await notYetRouted(page.request)).value).toBe(less);

      await tabsOf(main, uiLocale)
        .getByRole('link', { name: text.tabs.recent, exact: true })
        .click();
      await expect(page).toHaveURL(/[?&]tab=recent/);
      const undo = main.getByRole('button', { name: `${text.undoFor}${summary}`, exact: true });
      await expect(main.locator('tbody tr').first().getByRole('button')).toHaveAccessibleName(
        `${text.undoFor}${summary}`,
      );
      await screenshot(page, testInfo, 'recent-after-mark');
      await undo.click();
      const confirmUndo = page.getByRole('dialog', { name: text.confirmUndoTitle });
      await expect(confirmUndo).toContainText(summary);
      await confirmUndo.getByRole('button', { name: text.confirmUndo, exact: true }).click();
      await expect(page.getByText(`${text.undone}${summary}`)).toBeVisible();
      await expect(undo).toHaveCount(0);
      routed = false;

      await tabsOf(main, uiLocale)
        .getByRole('link', { name: new RegExp(text.tabs.open) })
        .click();
      await expect(
        main.getByRole('button', { name: `${text.markFor}${summary}`, exact: true }),
      ).toBeVisible();
      await expect(foot).toContainText(money(before.value));
      expect((await notYetRouted(page.request)).value).toBe(before.value);
    } finally {
      if (routed) {
        // Put the collection back whatever failed above; a 409 means it is already unrouted.
        const restore = await page.request.delete(
          `/api/v1/collections/${item.collectionId}/routed`,
          {
            headers: { Origin: origin },
            failOnStatusCode: false,
          },
        );
        expect([200, 409]).toContain(restore.status());
      }
    }
  });

  test('a second mark of the same collection is a conflict the API reports', async ({
    page,
    loginAs,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== MUTATING_PROJECT, 'mutates shared routing state');
    await loginAs('finance_reviewer');
    const origin = new URL(baseURL ?? '').origin;
    const oldest = await readData<{ items: UnroutedItem[]; total: number }>(
      page.request,
      '/api/v1/dashboard/unrouted?page=1&pageSize=1',
    );
    test.skip(oldest.total === 0, 'no unrouted collections in this dataset');
    const id = oldest.items[0]!.collectionId;
    const path = `/api/v1/collections/${id}/routed`;
    try {
      const first = await page.request.post(path, { headers: { Origin: origin } });
      expect(first.status()).toBe(200);
      const second = await page.request.post(path, {
        headers: { Origin: origin },
        failOnStatusCode: false,
      });
      expect(second.status()).toBe(409);
      expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
        'already_routed',
      );
    } finally {
      const undo = await page.request.delete(path, {
        headers: { Origin: origin },
        failOnStatusCode: false,
      });
      expect([200, 409]).toContain(undo.status());
    }
  });
});
