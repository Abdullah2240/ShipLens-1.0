import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

// Branch Lead collection screens: log, countdown, amend, void with reason, history, and the
// approved lock (also through the API). This spec owns writes to the Sample Branch current
// week. Strings below are copied from messages/{en,ur}/collections.json and
// messages/en/audit.json (the runner container mounts only tests/e2e).

const EN = {
  amount: 'Amount',
  date: 'Date collected',
  purpose: 'Purpose',
  submit: 'Log collection',
  logged: 'Collection logged.',
  formTitle: 'Log a collection',
  edit: 'Edit',
  save: 'Save changes',
  saved: 'Changes saved.',
  void: 'Void',
  voidReason: 'Reason',
  voidConfirm: 'Void collection',
  voided: 'Voided',
  approved: 'Approved',
  invalidMoney: 'Enter an amount above zero with at most 2 decimals, for example 2500.50.',
  branchFilter: 'Branch',
  timeline: ['Collection logged', 'Collection amended', 'Collection voided'],
};

const UR_LOCKS_IN_7 = '7 دن میں مقفل ہو گی';
const URDU_DIGITS = /[٠-٩۰-۹]/;

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PURPOSE = `Ration packs e2e-${runId}`;

function originHeader(baseURL: string | undefined) {
  if (!baseURL) throw new Error('baseURL is not configured');
  return { Origin: new URL(baseURL).origin };
}

/** "PKR 12,345.60" -> 1234560 (minor units, integers only). */
function minorUnits(text: string): number {
  const match = /PKR\s*(-?[\d,]+)\.(\d{2})/.exec(text);
  if (!match) throw new Error(`not a money string: ${text}`);
  const whole = Number((match[1] ?? '0').replaceAll(',', ''));
  return whole * 100 + Number(match[2]);
}

function rowFor(page: Page, purpose: string) {
  return page.locator('tbody tr', { hasText: purpose });
}

type CollectionJson = {
  id: string;
  status: string;
  reportStatus: string;
  branchCode: string;
  editability: string;
};

async function listCollections(request: APIRequestContext): Promise<CollectionJson[]> {
  const response = await request.get('/api/v1/collections?limit=500');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: { items: CollectionJson[] } };
  return body.data.items;
}

test.describe('collections: log, amend, void and lock', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'desktop-en-light', 'mutating test runs once');
  });

  test('branch lead logs a collection with a countdown', async ({ page, loginAs }) => {
    await loginAs('branch_lead');
    await page.goto('/en/collections');
    await expect(page.getByRole('heading', { name: EN.formTitle })).toBeVisible();

    const total = page.getByTestId('week-total');
    const before = minorUnits((await total.textContent()) ?? '');

    await page.getByLabel(EN.amount).fill('2500.75');
    await page.getByLabel(EN.purpose).fill(PURPOSE);
    await page.getByRole('button', { name: EN.submit }).click();
    await expect(page.getByText(EN.logged)).toBeVisible();

    const row = rowFor(page, PURPOSE);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('PKR 2,500.75');
    await expect(row).toContainText('Locks in 7 days');
    await expect
      .poll(async () => minorUnits((await total.textContent()) ?? ''))
      .toBe(before + 250075);
  });

  test('amend and void keep history', async ({ page, loginAs }) => {
    await loginAs('branch_lead');
    await page.goto('/en/collections');
    const row = rowFor(page, PURPOSE);
    await row.getByRole('link', { name: EN.edit }).click();
    await expect(page).toHaveURL(/\/en\/collections\/[0-9a-f-]{36}#amend$/);
    const detailUrl = page.url().replace(/#.*$/, '');

    const amend = page.locator('#amend');
    await amend.getByLabel(EN.amount).fill('2600.00');
    await amend.getByRole('button', { name: EN.save }).click();
    await expect(amend.getByText(EN.saved)).toBeVisible();
    await expect(page.getByTestId('collection-amount')).toHaveText('PKR 2,600.00');

    await page.locator('#void').getByRole('button', { name: EN.void, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(EN.voidReason).fill('Entered twice');
    await dialog.getByRole('button', { name: EN.voidConfirm }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-lock-state="voided"]').first()).toContainText(EN.voided);
    await expect(page.getByTestId('void-reason')).toContainText('Entered twice');

    // The timeline lists the whole story, oldest first.
    await page.goto(detailUrl);
    const labels = page.locator('li[data-entry-id]');
    for (const label of EN.timeline) await expect(labels.filter({ hasText: label })).toHaveCount(1);
    const text = (await labels.allTextContents()).join('\n');
    const positions = EN.timeline.map((label) => text.indexOf(label));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // The voided row stays listed, muted, with its reason and no write controls.
    await page.goto('/en/collections');
    const voidedRow = rowFor(page, PURPOSE);
    await expect(voidedRow).toHaveAttribute('data-voided', 'true');
    await expect(voidedRow).toContainText(EN.voided);
    await expect(voidedRow).toContainText('Reason: Entered twice');
    await expect(voidedRow.getByRole('link', { name: EN.edit })).toHaveCount(0);
    await expect(voidedRow.getByRole('button', { name: EN.void })).toHaveCount(0);
  });

  test('invalid input is explained', async ({ page, loginAs }) => {
    await loginAs('branch_lead');
    await page.goto('/en/collections');
    await page.getByLabel(EN.amount).fill('12.345');
    await page.getByLabel(EN.purpose).fill(`Invalid e2e-${runId}`);
    await page.getByRole('button', { name: EN.submit }).click();
    await expect(page.getByText(EN.invalidMoney)).toBeVisible();
    await expect(page.getByLabel(EN.amount)).toHaveAttribute('aria-invalid', 'true');
    await expect(rowFor(page, `Invalid e2e-${runId}`)).toHaveCount(0);

    // The date picker cannot go past today: max is today's PKT date, the default value.
    const date = page.getByLabel(EN.date);
    await expect(date).toHaveAttribute('max', await date.inputValue());
  });

  test('approved collections are locked even by direct API', async ({ page, loginAs, baseURL }) => {
    await loginAs('branch_lead');
    const approved = (await listCollections(page.request)).find(
      (item) => item.reportStatus === 'approved' && item.status === 'active',
    );
    expect(approved, 'a seeded active collection in an approved report').toBeDefined();
    const id = approved?.id ?? '';

    await page.goto(`/en/collections/${id}`);
    await expect(page.locator('[data-lock-state="report_approved"]').first()).toContainText(
      EN.approved,
    );
    await expect(page.locator('#amend')).toHaveCount(0);
    await expect(page.locator('#void')).toHaveCount(0);

    const response = await page.request.patch(`/api/v1/collections/${id}`, {
      headers: originHeader(baseURL),
      data: { purpose: 'x y' },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('report_not_open');
  });

  test('urdu collections page shows the countdown with Latin digits', async ({
    page,
    loginAs,
    baseURL,
  }) => {
    await loginAs('branch_lead');
    const purpose = `Urdu e2e-${runId}`;
    const created = await page.request.post('/api/v1/collections', {
      headers: originHeader(baseURL),
      data: {
        amount: '1250.50',
        collectedOn: new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10),
        purpose,
      },
    });
    expect(created.status()).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    await page.goto('/ur/collections');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const row = rowFor(page, purpose);
    await expect(row).toContainText('PKR 1,250.50');
    await expect(row).toContainText(UR_LOCKS_IN_7);
    expect(await row.textContent()).not.toMatch(URDU_DIGITS);
    expect(await page.getByTestId('week-total').textContent()).not.toMatch(URDU_DIGITS);

    // Leave the week as other runs expect it: the test entry is voided, not left active.
    const voided = await page.request.post(`/api/v1/collections/${data.id}/void`, {
      headers: originHeader(baseURL),
      data: { reason: 'End-to-end test entry' },
    });
    expect(voided.status()).toBe(200);
  });
});

test.describe('collections: head office', () => {
  test('head office is read only across branches', async ({ page, loginAs, uiLocale }) => {
    await loginAs('finance_reviewer');
    await page.goto(`/${uiLocale}/collections`);
    await expect(page.locator('form[role="search"]')).toBeVisible();
    await expect(page.locator('#collections-branch')).toBeVisible();
    if (uiLocale === 'en') await expect(page.getByLabel(EN.branchFilter)).toBeVisible();
    await expect(page.getByRole('heading', { name: EN.formTitle })).toHaveCount(0);
    await expect(page.getByTestId('week-total')).toHaveCount(0);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(page.locator('tbody button')).toHaveCount(0);

    const codes = new Set(
      (await page.locator('tbody bdi[dir="ltr"]').allTextContents()).map((code) => code.trim()),
    );
    expect(codes.size).toBeGreaterThan(1);
  });
});
