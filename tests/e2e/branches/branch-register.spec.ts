import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { DEMO_BRANCH_NAME } from '../support/roles';

// Branch register flows. Tests that create or change branches run once, in
// desktop-en-light, and use English labels; the read-only checks run in every project
// and use structural locators so they hold in both languages.

const MUTATING_PROJECT = 'desktop-en-light';
const skipUnlessMutating = (testInfo: TestInfo) =>
  test.skip(testInfo.project.name !== MUTATING_PROJECT, 'mutating test runs once');

const uniqueName = (tag: string) => `E2E Branch ${Date.now()} ${tag}`;

type BranchBody = { id: string; code: string; name: string; status: string };
type Candidate = { userId: string; email: string; branchId: string | null };

function originOf(baseURL: string | undefined): string {
  if (!baseURL) throw new Error('baseURL is not configured');
  return new URL(baseURL).origin;
}

async function postJson<T>(
  request: APIRequestContext,
  origin: string,
  path: string,
  data: unknown,
): Promise<T> {
  const response = await request.post(path, {
    headers: { Origin: origin },
    data,
    failOnStatusCode: false,
  });
  expect(response.ok(), `POST ${path} -> ${response.status()}`).toBe(true);
  return ((await response.json()) as { data: T }).data;
}

/** Creates a branch through the API (Super Admin session) and returns it. */
function createBranch(page: Page, origin: string, name: string): Promise<BranchBody> {
  return postJson<BranchBody>(page.request, origin, '/api/v1/branches', {
    name,
    city: 'Hyderabad',
  });
}

test.describe('branch register', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin creates and activates a branch', async ({ page, loginAs }, testInfo) => {
    skipUnlessMutating(testInfo);
    await loginAs('super_admin');
    const name = uniqueName('create');

    await page.goto('/en/admin/branches');
    await page.locator('summary', { hasText: 'New branch' }).click();
    await page.getByLabel('Branch name').fill(name);
    await page.getByLabel('City').fill('Hyderabad');
    await page.getByRole('button', { name: 'Create branch' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: /Branch .*BR\d{3,}.* created\./ }),
    ).toBeVisible();

    const row = page.locator('tbody tr', { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.locator('bdi')).toHaveText(/^BR\d{3,}$/);
    await expect(row).toContainText('Forming');
    await expect(row).toContainText('Hyderabad');

    await row.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    await page.getByRole('button', { name: 'Move to Active' }).click();
    await expect(page.getByText('Status changed to Active.')).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveText('Active');
    await expect(page.getByRole('button', { name: 'Move to Paused' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move to Closed' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move to Active' })).toHaveCount(0);

    await page.getByLabel('Summary').fill('Opened by the end-to-end run.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Summary')).toHaveValue('Opened by the end-to-end run.');
  });

  test('close needs confirmation and closed is read only', async ({
    page,
    loginAs,
    baseURL,
  }, testInfo) => {
    skipUnlessMutating(testInfo);
    await loginAs('super_admin');
    const branch = await createBranch(page, originOf(baseURL), uniqueName('close'));

    await page.goto(`/en/admin/branches/${branch.id}`);
    await page.getByRole('button', { name: 'Move to Closed' }).click();
    const dialog = page.getByRole('dialog', { name: 'Close this branch?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(branch.name);

    // Cancelling changes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[aria-current="step"]')).toHaveText('Forming');

    await page.getByRole('button', { name: 'Move to Closed' }).click();
    await dialog.getByRole('button', { name: 'Close branch' }).click();
    await expect(page.getByText('Status changed to Closed.')).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveText('Closed');
    await expect(page.getByRole('button', { name: /^Move to/ })).toHaveCount(0);
    await expect(page.getByText('No further moves. A closed branch stays closed.')).toBeVisible();
    await expect(page.getByText(/This branch is closed\./)).toBeVisible();
    await expect(page.getByLabel('Branch name')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByLabel('Person')).toHaveCount(0);
  });

  test('assign a lead', async ({ page, loginAs, baseURL }, testInfo) => {
    skipUnlessMutating(testInfo);
    await loginAs('super_admin');
    const origin = originOf(baseURL);

    const candidatesResponse = await page.request.get('/api/v1/branches/lead-candidates');
    expect(candidatesResponse.status()).toBe(200);
    const candidates = ((await candidatesResponse.json()) as { data: Candidate[] }).data;
    const hr = candidates.find((c) => c.email === 'hr.lahore@shiplens.test');
    test.skip(!hr, 'demo dataset user hr.lahore@shiplens.test is not seeded');
    if (!hr) return;

    const branch = await createBranch(page, origin, uniqueName('lead'));
    await postJson(page.request, origin, `/api/v1/branches/${branch.id}/status`, { to: 'active' });

    try {
      await page.goto(`/en/admin/branches/${branch.id}`);
      await expect(
        page.getByText('A person leads one branch at a time.', { exact: false }),
      ).toBeVisible();
      const select = page.getByLabel('Person');
      await expect(select.locator('option', { hasText: 'hr.lahore@shiplens.test' })).toHaveCount(1);
      await select.selectOption(hr.userId);
      await page.getByRole('button', { name: 'Assign lead' }).click();
      await expect(page.getByText('Lead assigned.')).toBeVisible();
      await expect(page.getByRole('list', { name: 'HR Leads' })).toContainText(
        'hr.lahore@shiplens.test',
      );
    } finally {
      // Give the demo user back to the branch they came from, so other specs see the seed.
      if (hr.branchId) {
        await postJson(page.request, origin, `/api/v1/branches/${hr.branchId}/leads`, {
          userId: hr.userId,
        });
      }
    }
  });
});

test.describe('branch register views', () => {
  test('finance reviewer is read only', async ({ page, loginAs, localePath }) => {
    await loginAs('finance_reviewer');
    await page.goto(localePath('/admin/branches'));
    const main = page.getByRole('main');
    const rows = main.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(main.locator('details')).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);

    await rows.first().getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('combobox')).toHaveCount(0);
  });

  test('urdu register renders rtl', async ({ page, loginAs }) => {
    await loginAs('super_admin');
    await page.goto('/ur/admin/branches');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ur');
    const code = page.getByRole('main').locator('tbody tr bdi').first();
    await expect(code).toHaveText(/BR\d+/);
    await expect(code).toHaveAttribute('dir', 'ltr');
  });

  test('branch lead sees only own branch', async ({ page, loginAs, localePath }) => {
    await loginAs('branch_lead');
    await page.goto(localePath('/admin/branches'));
    const main = page.getByRole('main');
    const rows = main.locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(DEMO_BRANCH_NAME);
    await expect(main.locator('details')).toHaveCount(0);
  });
});
