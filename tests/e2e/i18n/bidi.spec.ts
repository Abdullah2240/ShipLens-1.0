import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { DEMO_BRANCH_NAME } from '../support/roles';

// I18N-04 on the pre-existing screens: in Urdu, member codes, emails, phones, branch codes
// and amounts sit in left-to-right isolates and keep their exact text. Read-only, so it runs
// in both Urdu projects; the English projects have nothing to check here.

const PATTERNS = {
  memberCode: /^M\d{5,}$/,
  email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
  // Seeded phones are stored as typed (0300...) or normalised (+92300...).
  phone: /^(?:0\d{3}-?\d{7}|\+92\d{10})$/,
  branchCode: /^BR\d{3,}$/,
  amount: /^PKR [\d,]+\.\d{2}$/,
} as const;

type Kind = keyof typeof PATTERNS;

type Isolate = { text: string; direction: string; dir: string | null };

/** Every LTR isolate inside the locator, with its computed direction. */
async function ltrIsolates(scope: Locator): Promise<Isolate[]> {
  return scope.locator('bdi[dir="ltr"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: (node.textContent ?? '').trim(),
      direction: getComputedStyle(node).direction,
      dir: node.getAttribute('dir'),
    })),
  );
}

/** At least one isolate of each kind matches its pattern, and every isolate lays out LTR. */
async function expectValues(scope: Locator, kinds: Kind[]) {
  const found = await ltrIsolates(scope);
  for (const isolate of found) {
    expect(isolate.direction, `computed direction of "${isolate.text}"`).toBe('ltr');
  }
  for (const kind of kinds) {
    const matches = found.filter((isolate) => PATTERNS[kind].test(isolate.text));
    expect(
      matches.length,
      `${kind} in an LTR isolate (found: ${found.map((f) => f.text).join(' | ')})`,
    ).toBeGreaterThan(0);
  }
  return found;
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `test-results/screens/bidi/${testInfo.project.name}-${name}.png`,
    fullPage: true,
  });
}

test.beforeEach(async ({ uiLocale, page }) => {
  test.skip(uiLocale !== 'ur', 'Mixed-direction checks run on the Urdu projects');
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('HR Lead: member codes, emails and phones stay intact in the Urdu members list', async ({
  page,
  loginAs,
  localePath,
}, testInfo) => {
  await loginAs('hr_lead');
  await page.goto(localePath('/people/members'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible();
  const first = rows.first();
  const code = first.locator('td').first().locator('bdi[dir="ltr"]');
  await expect(code).toHaveText(PATTERNS.memberCode);

  // Seeded members all have an email; the phone check runs over the first rows together.
  await expectValues(first, ['memberCode', 'email']);
  const sample = page.locator('table tbody tr:nth-child(-n+10)');
  const values = await ltrIsolates(sample);
  expect(values.some((v) => PATTERNS.phone.test(v.text))).toBe(true);
  for (const value of values) {
    expect(
      Object.values(PATTERNS).some((pattern) => pattern.test(value.text)),
      `"${value.text}" is a code, email, phone or amount`,
    ).toBe(true);
  }
  await screenshot(page, testInfo, 'members');
});

test('Branch Lead: amounts stay intact on the collections list and a report page', async ({
  page,
  loginAs,
  localePath,
}, testInfo) => {
  await loginAs('branch_lead');
  await page.goto(localePath('/collections'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const total = page.getByTestId('week-total');
  if ((await total.count()) > 0) {
    await expect(total.locator('bdi[dir="ltr"]')).toHaveText(PATTERNS.amount);
  }
  const table = page.locator('table').first();
  await expect(table).toBeVisible();
  await expectValues(table, ['amount']);
  await screenshot(page, testInfo, 'collections');

  // A report of the lead's branch, from the reports list.
  await page.goto(localePath('/reports'));
  const reportLink = page
    .locator('table tbody a[href*="/reports/"]:not([href$="/reports/review"])')
    .first();
  const href = await reportLink.getAttribute('href');
  expect(href).toMatch(/\/reports\/[0-9a-f-]{36}$/);
  await page.goto(href!);

  const main = page.locator('main');
  await expect(page.getByTestId('report-total').locator('bdi[dir="ltr"]')).toHaveText(
    PATTERNS.amount,
  );
  await expectValues(main, ['branchCode', 'amount']);
  await screenshot(page, testInfo, 'report');
});

test('Super Admin: branch codes, lead emails and the account email stay intact', async ({
  page,
  loginAs,
  localePath,
}, testInfo) => {
  await loginAs('super_admin');
  await page.goto(localePath('/admin/branches'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expectValues(page.locator('table').first(), ['branchCode']);

  await page.getByRole('link', { name: DEMO_BRANCH_NAME }).first().click();
  await expect(page).toHaveURL(/\/admin\/branches\/[0-9a-f-]{36}$/);
  const main = page.locator('main');
  const header = main.locator('header').first();
  await expect(header.locator('bdi[dir="ltr"]').first()).toHaveText(PATTERNS.branchCode);
  const found = await expectValues(main, ['branchCode']);
  // Lead emails, when the branch has leads, are LTR isolates too.
  const emails = found.filter((isolate) => isolate.text.includes('@'));
  for (const email of emails) expect(email.text).toMatch(PATTERNS.email);
  await screenshot(page, testInfo, 'branch');

  await page.goto(localePath('/account'));
  const isolates = await expectValues(page.locator('main'), ['email']);
  expect(isolates.map((isolate) => isolate.text)).toContain('admin@shiplens.test');
  await screenshot(page, testInfo, 'account');
});
