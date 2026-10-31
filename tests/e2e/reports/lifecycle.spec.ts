import { expect, test } from '../support/fixtures';
import { LAHORE_BRANCH, LAHORE_LEAD, loginAsEmail, pktToday } from './login-email';

// The weekly report lifecycle in the browser: draft, submit, return with a reason,
// resubmit, approve, locked. Uses the Lahore branch's current week (02-24 demo data) so it
// never collides with the collections spec (Sample Branch) or 04-16 (Islamabad).

// From db/seed/data/reports.json (the seed data is not mounted in the runner):
// an approved Sample Branch report, readable by its own lead only.
const SAMPLE_BRANCH_REPORT = '72d847f7-686c-4106-b22b-f450dc726a8c';

const EN = {
  submit: 'Submit report',
  resubmit: 'Resubmit report',
  approve: 'Approve',
  return: 'Return with reason',
  returnConfirm: 'Return report',
  confirmSubmitTitle: 'Submit this report?',
  confirmApproveTitle: 'Approve this report?',
  returnTitle: 'Return this report',
  reasonLabel: 'Reason',
  frozenTotal: 'Frozen at submission',
  returnReasonTitle: 'Returned for changes',
  lockedTitle: 'Approved and locked',
  timeline: 'Audit trail',
  thisWeek: 'This week',
  audit: [
    'Report submitted for review',
    'Report returned for changes',
    'Report resubmitted for review',
    'Report approved',
  ],
} as const;

const NOT_FOUND = {
  en: 'We could not find that page',
  ur: 'یہ صفحہ نہیں مل سکا',
} as const;

const REASON = 'Receipt total does not match';

test.describe('weekly report lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  let reportId = '';

  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'desktop-en-light', 'mutating test runs once');
  });

  test('the Lahore lead submits the current week with a new collection', async ({
    page,
    baseURL,
    localePath,
  }) => {
    await loginAsEmail(page, baseURL, LAHORE_LEAD);
    const created = await page.request.post('/api/v1/collections', {
      headers: { Origin: new URL(baseURL!).origin },
      data: { amount: '2500.00', collectedOn: pktToday(), purpose: `E2E lifecycle ${Date.now()}` },
    });
    expect(created.status(), 'log a collection for today').toBe(201);

    await page.goto(localePath('/reports'));
    const row = page.getByRole('row').filter({ hasText: EN.thisWeek });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Draft');
    await row.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/en\/reports\/[0-9a-f-]{36}$/);
    reportId = page.url().split('/').at(-1)!;

    await expect(page.getByRole('heading', { level: 1, name: LAHORE_BRANCH })).toBeVisible();
    await expect(page.getByTestId('report-status')).toHaveText('Draft');
    const actions = page.getByTestId('report-actions');
    await expect(actions.getByRole('button', { name: EN.submit })).toBeVisible();
    for (const name of [EN.approve, EN.return, EN.resubmit]) {
      await expect(actions.getByRole('button', { name })).toHaveCount(0);
    }

    await actions.getByRole('button', { name: EN.submit }).click();
    const dialog = page.getByRole('dialog', { name: EN.confirmSubmitTitle });
    await expect(dialog).toContainText('PKR');
    await dialog.getByRole('button', { name: EN.submit }).click();

    await expect(page.getByTestId('report-status')).toHaveText('Submitted');
    await expect(page.getByText(EN.frozenTotal, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: EN.submit })).toHaveCount(0);
  });

  test('Finance returns it from the review queue with a reason', async ({
    page,
    loginAs,
    localePath,
  }) => {
    expect(reportId, 'report id from the submit step').not.toBe('');
    await loginAs('finance_reviewer');
    await page.goto(localePath('/reports/review'));
    const item = page.locator(`li[data-report-id="${reportId}"]`);
    await expect(item).toBeVisible();
    await item.getByRole('link', { name: LAHORE_BRANCH }).click();
    await expect(page).toHaveURL(new RegExp(`/en/reports/${reportId}$`));

    await page.getByRole('button', { name: EN.return }).click();
    const dialog = page.getByRole('dialog', { name: EN.returnTitle });
    await dialog.getByRole('textbox', { name: EN.reasonLabel }).fill(REASON);
    await dialog.getByRole('button', { name: EN.returnConfirm }).click();

    await expect(page.getByTestId('report-status')).toHaveText('Returned');
    await expect(page.getByRole('button', { name: EN.approve })).toHaveCount(0);
  });

  test('the Lahore lead sees the reason and resubmits', async ({ page, baseURL, localePath }) => {
    await loginAsEmail(page, baseURL, LAHORE_LEAD);
    await page.goto(localePath(`/reports/${reportId}`));
    const callout = page.getByRole('region', { name: EN.returnReasonTitle });
    await expect(callout).toContainText(REASON);

    await page.getByRole('button', { name: EN.resubmit }).click();
    const dialog = page.getByRole('dialog', { name: EN.confirmSubmitTitle });
    await dialog.getByRole('button', { name: EN.resubmit }).click();

    await expect(page.getByTestId('report-status')).toHaveText('Submitted');
    await expect(page.getByRole('region', { name: EN.returnReasonTitle })).toHaveCount(0);
    const history = page.getByTestId('report-history').locator('li[data-event-type]');
    await expect
      .poll(() => history.evaluateAll((lis) => lis.map((li) => li.dataset.eventType)))
      .toEqual(['submitted', 'returned', 'resubmitted']);
    await expect(page.getByTestId('report-history')).toContainText(REASON);
  });

  test('Finance approves it and the report locks', async ({
    page,
    baseURL,
    loginAs,
    localePath,
  }) => {
    await loginAs('finance_reviewer');
    await page.goto(localePath(`/reports/${reportId}`));
    await page.getByRole('button', { name: EN.approve }).click();
    const dialog = page.getByRole('dialog', { name: EN.confirmApproveTitle });
    await expect(dialog).toContainText(LAHORE_BRANCH);
    await dialog.getByRole('button', { name: EN.approve }).click();

    await expect(page.getByTestId('report-status')).toHaveText('Approved');
    await expect(page.getByRole('region', { name: EN.lockedTitle })).toBeVisible();
    await expect(page.getByTestId('report-action-buttons')).toHaveCount(0);

    const timeline = page.getByRole('region', { name: EN.timeline });
    const labels = await timeline
      .locator('li[data-entry-id]')
      .evaluateAll((lis) => lis.map((li) => li.querySelector('p')?.textContent?.trim() ?? ''));
    expect(labels.filter((label) => (EN.audit as readonly string[]).includes(label))).toEqual([
      ...EN.audit,
    ]);

    const again = await page.request.post(`/api/v1/reports/${reportId}/approve`, {
      headers: { Origin: new URL(baseURL!).origin },
      data: {},
      failOnStatusCode: false,
    });
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_transition',
    );
  });

  test('the approved report offers the lead nothing', async ({ page, baseURL, localePath }) => {
    await loginAsEmail(page, baseURL, LAHORE_LEAD);
    await page.goto(localePath(`/reports/${reportId}`));
    await expect(page.getByTestId('report-status')).toHaveText('Approved');
    await expect(page.getByRole('region', { name: EN.lockedTitle })).toBeVisible();
    await expect(page.getByTestId('report-actions')).toHaveCount(0);

    const submit = await page.request.post(`/api/v1/reports/${reportId}/submit`, {
      headers: { Origin: new URL(baseURL!).origin },
      data: {},
      failOnStatusCode: false,
    });
    expect(submit.status()).toBe(409);
  });
});

test.describe('report branch isolation', () => {
  test('a lead cannot open another branch report; its own lead can', async ({
    page,
    baseURL,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAsEmail(page, baseURL, LAHORE_LEAD);
    await page.goto(localePath(`/reports/${SAMPLE_BRANCH_REPORT}`));
    await expect(page.getByRole('heading', { name: NOT_FOUND[uiLocale] })).toBeVisible();
    await expect(page.getByTestId('report-status')).toHaveCount(0);

    await page.context().clearCookies();
    await loginAs('branch_lead');
    await page.goto(localePath(`/reports/${SAMPLE_BRANCH_REPORT}`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sample Branch (Demo)' }),
    ).toBeVisible();
    await expect(page.getByTestId('report-status')).toBeVisible();
  });
});
