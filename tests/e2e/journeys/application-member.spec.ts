import { expect, test } from '../support/fixtures';
import { DEMO_BRANCH_NAME } from '../support/roles';
import { URDU_DIGITS, apiAs, uniqueSuffix } from './support/journey';

// A visitor's application becomes a member: the public form, HR accepts, the member gets an
// automatic ID, HR finds the member by search, and the decision cannot be made twice.
// Submissions run in desktop-en-light only (per-address rate limit); the Urdu members
// list check is read-only.

// Strings from messages/en/{applications,members}.json.
const EN = {
  fullName: 'Full name',
  email: 'Email address',
  phone: 'Mobile number',
  message: 'Anything you would like us to know',
  send: 'Send my application',
  thanksTitle: 'Thank you, your application is with us',
  accept: 'Accept',
  confirmAccept: 'Accept and add member',
  accepted: (name: string) => `Application accepted. ${name} is now a member.`,
  search: 'Search members',
} as const;

const MEMBER_CODE = /^M\d{5}$/;

const RUN = uniqueSuffix();
// No seeded member shares this name, so @pristine member searches are unaffected.
const VISITOR = {
  fullName: `Journey Visitor ${RUN}`,
  email: `e2e+${RUN}@example.test`,
  phone: '03001234567',
  message: 'Weekends, ration drives.',
};

test.describe('application to member journey', () => {
  test.describe.configure({ mode: 'serial' });

  let applicationId = '';
  let memberCode = '';

  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'desktop-en-light', 'mutating journey runs once');
  });

  test('a visitor applies to the demo branch through the public form', async ({
    page,
    localePath,
  }) => {
    // Its own documentation-range address, so the per-address limit is not spent.
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `203.0.113.${(Date.now() % 250) + 1}` });
    const response = await page.goto(localePath('/get-involved/apply'));
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');

    await page.getByLabel(EN.fullName).fill(VISITOR.fullName);
    await page.getByLabel(EN.email).fill(VISITOR.email);
    await page.getByLabel(EN.phone).fill(VISITOR.phone);
    const branch = page.locator('select[name="branchId"]');
    const options = await branch.locator('option').evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: (node as HTMLOptionElement).value,
        text: node.textContent ?? '',
      })),
    );
    const demo = options.find((option) => option.text.startsWith(DEMO_BRANCH_NAME));
    expect(demo, `${DEMO_BRANCH_NAME} offered in the form`).toBeTruthy();
    await branch.selectOption(demo!.value);
    await page.getByLabel(EN.message).fill(VISITOR.message);
    await page.getByRole('button', { name: EN.send }).click();

    await expect(page).toHaveURL(/\/en\/get-involved\/apply\/thanks$/);
    await expect(page.getByRole('heading', { level: 1, name: EN.thanksTitle })).toBeVisible();
  });

  test('HR accepts it and the new member gets an automatic ID', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('hr_lead');
    await page.goto(localePath('/people/applications'));
    await page.locator('table').getByRole('link', { name: VISITOR.fullName }).click();
    await expect(page).toHaveURL(/\/en\/people\/applications\/[0-9a-f-]{36}$/);
    applicationId = page.url().split('/').at(-1)!;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(VISITOR.fullName);

    await page.getByRole('button', { name: EN.accept, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: EN.confirmAccept }).click();
    const notice = page.getByRole('status').filter({ hasText: EN.accepted(VISITOR.fullName) });
    await expect(notice).toBeVisible();
    const code = notice.locator('bdi[dir="ltr"]');
    await expect(code).toHaveText(MEMBER_CODE);
    memberCode = ((await code.textContent()) ?? '').trim();
    await expect(page.getByRole('button', { name: EN.accept, exact: true })).toHaveCount(0);
  });

  test('HR finds exactly that member by searching the run id', async ({
    page,
    baseURL,
    loginAs,
    localePath,
  }) => {
    expect(memberCode).toMatch(MEMBER_CODE);
    await loginAs('hr_lead');
    await page.goto(localePath('/people/members'));
    const search = page.getByLabel(EN.search);
    await search.fill(RUN);
    await search.press('Enter');
    await expect(page).toHaveURL(new RegExp(`[?&]q=${RUN}`));

    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(VISITOR.fullName);
    await expect(rows.first().locator('bdi[dir="ltr"]', { hasText: memberCode })).toHaveText(
      memberCode,
    );

    // The decision is final: a second accept is refused.
    const again = await apiAs(page, baseURL).post(`/api/v1/applications/${applicationId}/accept`);
    expect(again.status(), 'second accept').toBe(409);
  });
});

test.describe('members list in Urdu', { tag: '@smoke' }, () => {
  test('member IDs read left-to-right with Latin digits', async ({ page, loginAs }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-ur-dark', 'read-only Urdu check runs once');
    await loginAs('hr_lead');
    const response = await page.goto('/ur/people/members');
    expect(response?.status()).toBe(200);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ur');
    await expect(html).toHaveAttribute('dir', 'rtl');

    const codes = page.locator('table tbody tr td bdi[dir="ltr"]').filter({ hasText: /^M\d{5}$/ });
    await expect(codes.first()).toBeVisible();
    for (const text of await codes.allTextContents()) {
      expect(text.trim()).toMatch(MEMBER_CODE);
      expect(text).not.toMatch(URDU_DIGITS);
    }
    expect(await codes.first().evaluate((node) => getComputedStyle(node).direction)).toBe('ltr');
  });
});
