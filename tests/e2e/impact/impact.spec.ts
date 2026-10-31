import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

// Public impact page (PUB-05), signed out. Read-only: nothing here approves or routes.
// Specs never import app code, so the money formatter below mirrors formatMoney.

function group(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function money(amount: string): string {
  const [whole = '0', cents = '00'] = amount.split('.');
  return `PKR ${group(whole)}.${cents.padEnd(2, '0')}`;
}

type PublicImpact = {
  asOf: string;
  approvedTotal: string;
  approvedReportCount: number;
  monthsCovered: number;
  monthly: { month: string; approved: string }[];
  activeBranchCount: number;
  activeBranches: { name: string; city: string | null }[];
  cities: number;
};

// Relative to the runner's working directory (the repository root, or /e2e in the compose
// runner); E2E_EXPECTED_JSON overrides it for runners that mount the seed elsewhere.
// Specs load as CommonJS, so import.meta is not available here.
const EXPECTED_PATH =
  process.env.E2E_EXPECTED_JSON ?? path.resolve(process.cwd(), 'db/seed/expected.json');

function loadApproved(): { amount: string; activeBranches: number } | null {
  if (!existsSync(EXPECTED_PATH)) return null;
  const kpis = (
    JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as {
      kpis: { approved: { amount: string }; active_branches: number };
    }
  ).kpis;
  return { amount: kpis.approved.amount, activeBranches: kpis.active_branches };
}

// Labels of the private figures that must never appear on the public page, and
// personal data patterns from the demo dataset.
const FORBIDDEN_WORDS =
  /pending approval|awaiting review|in progress|not yet routed|unrouted|routed to|\bvoided\b/i;
const DEMO_EMAIL = /@shiplens\.test/i;
const PHONE = /(?:\+92|\b0)3\d{2}[\s-]?\d{7}\b/;

async function fetchImpact(page: Page): Promise<PublicImpact> {
  const res = await page.request.get('/api/v1/public/impact');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: PublicImpact }).data;
}

async function openImpact(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

function totalLocator(page: Page) {
  return page.locator('[data-impact-figure="approvedTotal"] dd').first();
}

test.describe('public impact page', () => {
  test('renders signed out and its approved total equals the public API', async ({
    page,
    localePath,
  }) => {
    // Other specs may approve reports while this runs; the page and the API agree on a
    // reload once the watermark has moved.
    await expect
      .poll(
        async () => {
          await openImpact(page, localePath('/impact'));
          const onScreen = (await totalLocator(page).innerText()).trim();
          const api = await fetchImpact(page);
          return onScreen === money(api.approvedTotal);
        },
        { timeout: 20_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(true);

    const api = await fetchImpact(page);
    await expect(page.locator('[data-impact-figure="reports"] dd').first()).toHaveText(
      group(String(api.approvedReportCount)),
    );
    await expect(page.locator('[data-impact-figure="months"] dd').first()).toHaveText(
      String(api.monthsCovered),
    );
    await expect(page.locator('[data-impact-figure="branches"] dd')).toHaveText(
      String(api.activeBranchCount),
    );
    for (const branch of api.activeBranches) {
      await expect(page.getByText(branch.name, { exact: true }).first()).toBeVisible();
    }
    await expect(page.locator('[data-impact-as-of] time')).toHaveAttribute('datetime', /T/);
  });

  test('the API and the page carry no private figure or personal data', async ({
    page,
    localePath,
  }) => {
    const res = await page.request.get('/api/v1/public/impact');
    const raw = await res.text();
    expect(Object.keys((JSON.parse(raw) as { data: object }).data).sort()).toEqual([
      'activeBranchCount',
      'activeBranches',
      'approvedReportCount',
      'approvedTotal',
      'asOf',
      'cities',
      'monthly',
      'monthsCovered',
    ]);
    expect(raw).not.toMatch(DEMO_EMAIL);
    expect(raw).not.toMatch(PHONE);

    await openImpact(page, localePath('/impact'));
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(FORBIDDEN_WORDS);
    expect(text).not.toMatch(DEMO_EMAIL);
    expect(text).not.toMatch(PHONE);
  });

  test('follows the locale direction, uses the Nastaliq display face in Urdu and fits the screen', async ({
    page,
    localePath,
    uiLocale,
  }, testInfo) => {
    await openImpact(page, localePath('/impact'));
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', uiLocale);
    await expect(html).toHaveAttribute('dir', uiLocale === 'ur' ? 'rtl' : 'ltr');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveClass(/font-display-ur/);
    if (uiLocale === 'ur') {
      const family = await h1.evaluate((el) => getComputedStyle(el).fontFamily);
      expect(family).toMatch(/nastaliq/i);
    }

    // Sections in order under one h1: figures, trend, branches, method, call to action.
    const headings = await page.locator('main h2').count();
    expect(headings).toBeGreaterThanOrEqual(5);

    await page.waitForLoadState('load');
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(innerWidth + 1);

    mkdirSync('test-results/screens/impact', { recursive: true });
    await page.screenshot({
      path: `test-results/screens/impact/${testInfo.project.name}-impact.png`,
      fullPage: true,
    });
  });

  test('the table alternative opens without script and lists every month', async ({
    page,
    localePath,
  }) => {
    await openImpact(page, localePath('/impact'));
    const api = await fetchImpact(page);
    test.skip(api.monthly.length === 0, 'no approved months on this stack');
    const details = page.locator('details').first();
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await expect(details.locator('tbody tr')).toHaveCount(api.monthly.length);
    await expect(details.locator('a')).toHaveCount(0);
  });

  test('keyboard Tab reaches both calls to action with a visible focus ring', async ({
    page,
    localePath,
  }) => {
    await openImpact(page, localePath('/impact'));
    const reached = new Set<string>();
    for (let i = 0; i < 80 && reached.size < 2; i += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const cta = el?.getAttribute('data-impact-cta');
        if (!el || !cta) return null;
        const style = getComputedStyle(el);
        return { cta, outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      if (focused) {
        expect(focused.outline, focused.cta).not.toBe('none');
        expect(focused.width, focused.cta).toBeGreaterThan(0);
        reached.add(focused.cta);
      }
    }
    expect([...reached].sort()).toEqual(['branches', 'getInvolved']);
  });
});

test.describe('public impact on the demo dataset', { tag: '@pristine' }, () => {
  test('the approved total equals db/seed/expected.json', async ({ page, localePath }) => {
    const expected = loadApproved();
    test.skip(
      expected === null,
      `db/seed/expected.json is not readable at ${EXPECTED_PATH}: mount it into the runner`,
    );
    if (!expected) return;

    await openImpact(page, localePath('/impact'));
    await expect(totalLocator(page)).toHaveText(money(expected.amount));
    const api = await fetchImpact(page);
    expect(api.approvedTotal).toBe(expected.amount);
    expect(api.activeBranchCount).toBe(expected.activeBranches);
  });
});
