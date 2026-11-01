import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import {
  ISLAMABAD_BRANCH,
  ISLAMABAD_LEAD,
  URDU_DIGITS,
  apiAs,
  loginAsEmail,
  minorUnits,
  uniqueSuffix,
} from './support/journey';

// The full weekly report lifecycle across Branch Lead and Finance Reviewer, in the browser:
// log a collection, submit, return with a reason, amend, resubmit, approve, locked.
// It works on the Islamabad North (Demo) current week (02-24 demo data leaves it a draft
// with collections), so it never races the collections spec (Sample Branch) or the report
// lifecycle spec (Lahore) in the same run, and never touches the seeded submitted reports.

// Strings from messages/en/{collections,reports,audit}.json.
const EN = {
  amount: 'Amount',
  purpose: 'Purpose',
  logCollection: 'Log collection',
  logged: 'Collection logged.',
  edit: 'Edit',
  save: 'Save changes',
  saved: 'Changes saved.',
  locksIn7: 'Locks in 7 days',
  thisWeek: 'This week',
  submit: 'Submit report',
  resubmit: 'Resubmit report',
  approve: 'Approve',
  return: 'Return with reason',
  returnConfirm: 'Return report',
  confirmSubmitTitle: 'Submit this report?',
  confirmApproveTitle: 'Approve this report?',
  returnTitle: 'Return this report',
  reasonLabel: 'Reason',
  returnReasonTitle: 'Returned for changes',
  lockedTitle: 'Approved and locked',
  frozenTotal: 'Frozen at submission',
  timeline: 'Audit trail',
  verificationPanel: 'Public verification',
  collectionLogged: 'Collection logged',
  collectionAmended: 'Collection amended',
  lead: 'as Branch Lead',
  finance: 'as Finance Reviewer',
  status: { draft: 'Draft', submitted: 'Submitted', returned: 'Returned', approved: 'Approved' },
} as const;

// The report's own lifecycle entries in the timeline, in order, with the actor role.
const LIFECYCLE = [
  { label: 'Report submitted for review', actor: EN.lead },
  { label: 'Report returned for changes', actor: EN.finance },
  { label: 'Report resubmitted for review', actor: EN.lead },
  { label: 'Report approved', actor: EN.finance },
] as const;

// The approved report page shows the public verification panel.
const VERIFICATION_PANEL_ON_REPORT_PAGE = true;

const RUN = uniqueSuffix();
const PURPOSE = `Journey school fees ${RUN}`;
const REASON = `E2E return ${RUN}`;
const FIRST_AMOUNT = { input: '1234.56', shown: 'PKR 1,234.56' };
const AMENDED_AMOUNT = { input: '1300.25', shown: 'PKR 1,300.25' };

const LIFECYCLE_BUTTONS = [EN.submit, EN.resubmit, EN.approve, EN.return];

async function expectNoLifecycleButtons(page: Page) {
  for (const name of LIFECYCLE_BUTTONS) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
}

/** Minor-unit sum of the active rows of the report's collections table. */
async function activeRowsTotal(page: Page): Promise<number> {
  const amounts = await page
    .locator('tbody tr[data-collection-status="active"] td:nth-child(3)')
    .allTextContents();
  return amounts.reduce((sum, text) => sum + minorUnits(text), 0);
}

test.describe('report lifecycle journey', () => {
  test.describe.configure({ mode: 'serial' });

  let reportId = '';
  let collectionUrl = '';

  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'desktop-en-light', 'mutating journey runs once');
  });

  test('the Islamabad lead logs a collection and submits the current week', async ({
    page,
    baseURL,
    localePath,
  }) => {
    await loginAsEmail(page, baseURL, ISLAMABAD_LEAD);

    await page.goto(localePath('/collections'));
    await page.getByLabel(EN.amount).fill(FIRST_AMOUNT.input);
    await page.getByLabel(EN.purpose).fill(PURPOSE);
    await page.getByRole('button', { name: EN.logCollection }).click();
    await expect(page.getByText(EN.logged)).toBeVisible();
    const row = page.locator('tbody tr', { hasText: PURPOSE });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(FIRST_AMOUNT.shown);
    await expect(row).toContainText(EN.locksIn7);

    await page.goto(localePath('/reports'));
    const week = page.getByRole('row').filter({ hasText: EN.thisWeek });
    await expect(week).toHaveCount(1);
    await expect(week).toContainText(EN.status.draft);
    await week.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/en\/reports\/[0-9a-f-]{36}$/);
    reportId = page.url().split('/').at(-1)!;

    await expect(page.getByRole('heading', { level: 1, name: ISLAMABAD_BRANCH })).toBeVisible();
    await expect(page.getByTestId('report-status')).toHaveText(EN.status.draft);
    const ours = page.locator('tbody tr', { hasText: PURPOSE });
    await expect(ours).toContainText(FIRST_AMOUNT.shown);
    expect(minorUnits((await page.getByTestId('report-total').textContent()) ?? '')).toBe(
      await activeRowsTotal(page),
    );

    const actions = page.getByTestId('report-actions');
    await actions.getByRole('button', { name: EN.submit }).click();
    const dialog = page.getByRole('dialog', { name: EN.confirmSubmitTitle });
    await expect(dialog).toContainText('PKR');
    await dialog.getByRole('button', { name: EN.submit }).click();

    await expect(page.getByTestId('report-status')).toHaveText(EN.status.submitted);
    await expect(page.getByText(EN.frozenTotal, { exact: true })).toBeVisible();
    await expectNoLifecycleButtons(page);
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
    await item.getByRole('link', { name: ISLAMABAD_BRANCH }).click();
    await expect(page).toHaveURL(new RegExp(`/en/reports/${reportId}$`));

    await page.getByRole('button', { name: EN.return }).click();
    const dialog = page.getByRole('dialog', { name: EN.returnTitle });
    await dialog.getByRole('textbox', { name: EN.reasonLabel }).fill(REASON);
    await dialog.getByRole('button', { name: EN.returnConfirm }).click();

    await expect(page.getByTestId('report-status')).toHaveText(EN.status.returned);
    await expect(page.getByRole('button', { name: EN.approve })).toHaveCount(0);
  });

  test('the lead reads the reason, amends the collection and resubmits', async ({
    page,
    baseURL,
    localePath,
  }) => {
    await loginAsEmail(page, baseURL, ISLAMABAD_LEAD);
    await page.goto(localePath(`/reports/${reportId}`));
    await expect(page.getByRole('region', { name: EN.returnReasonTitle })).toContainText(REASON);

    await page.goto(localePath('/collections'));
    await page
      .locator('tbody tr', { hasText: PURPOSE })
      .getByRole('link', { name: EN.edit })
      .click();
    await expect(page).toHaveURL(/\/en\/collections\/[0-9a-f-]{36}#amend$/);
    collectionUrl = page.url().replace(/#.*$/, '');
    const amend = page.locator('#amend');
    await amend.getByLabel(EN.amount).fill(AMENDED_AMOUNT.input);
    await amend.getByRole('button', { name: EN.save }).click();
    await expect(amend.getByText(EN.saved)).toBeVisible();
    await expect(page.getByTestId('collection-amount')).toHaveText(AMENDED_AMOUNT.shown);

    await page.goto(localePath(`/reports/${reportId}`));
    await expect(page.locator('tbody tr', { hasText: PURPOSE })).toContainText(
      AMENDED_AMOUNT.shown,
    );
    await page.getByRole('button', { name: EN.resubmit }).click();
    const dialog = page.getByRole('dialog', { name: EN.confirmSubmitTitle });
    await dialog.getByRole('button', { name: EN.resubmit }).click();

    await expect(page.getByTestId('report-status')).toHaveText(EN.status.submitted);
    await expect(page.getByRole('region', { name: EN.returnReasonTitle })).toHaveCount(0);
  });

  test('Finance approves it: frozen total, no actions, full timeline', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('finance_reviewer');
    await page.goto(localePath(`/reports/${reportId}`));
    await page.getByRole('button', { name: EN.approve }).click();
    const dialog = page.getByRole('dialog', { name: EN.confirmApproveTitle });
    await expect(dialog).toContainText(ISLAMABAD_BRANCH);
    await dialog.getByRole('button', { name: EN.approve }).click();

    await expect(page.getByTestId('report-status')).toHaveText(EN.status.approved);
    await expect(page.getByRole('region', { name: EN.lockedTitle })).toBeVisible();
    await expectNoLifecycleButtons(page);

    // The frozen total equals the table total and the sum of the active rows shown.
    await expect(page.locator('tbody tr', { hasText: PURPOSE })).toContainText(
      AMENDED_AMOUNT.shown,
    );
    const frozen = minorUnits((await page.getByTestId('report-total').textContent()) ?? '');
    expect(minorUnits((await page.getByTestId('collections-total').textContent()) ?? '')).toBe(
      frozen,
    );
    expect(await activeRowsTotal(page)).toBe(frozen);

    // Every lifecycle step, in order, with the actor's role; the return keeps its reason.
    const entries = await page
      .getByRole('region', { name: EN.timeline })
      .locator('li[data-entry-id]')
      .evaluateAll((lis) =>
        lis.map((li) => ({
          label: li.querySelector('p')?.textContent?.trim() ?? '',
          text: li.textContent ?? '',
        })),
      );
    const lifecycle = entries.filter((entry) =>
      LIFECYCLE.some((step) => step.label === entry.label),
    );
    expect(lifecycle.map((entry) => entry.label)).toEqual(LIFECYCLE.map((step) => step.label));
    LIFECYCLE.forEach((step, i) => expect(lifecycle[i]!.text).toContain(step.actor));
    expect(lifecycle[1]!.text).toContain(REASON);
  });

  test('the approved report is locked for the lead, also through the API', async ({
    page,
    baseURL,
    localePath,
  }) => {
    await loginAsEmail(page, baseURL, ISLAMABAD_LEAD);
    await page.goto(localePath(`/reports/${reportId}`));
    await expect(page.getByTestId('report-status')).toHaveText(EN.status.approved);
    await expect(page.getByRole('region', { name: EN.lockedTitle })).toBeVisible();
    await expectNoLifecycleButtons(page);

    const submit = await apiAs(page, baseURL).post(`/api/v1/reports/${reportId}/submit`);
    expect(submit.status(), 'submit an approved report').toBe(409);

    // The collection's own timeline shows the create and the amend, in that order.
    await page.goto(collectionUrl);
    await expect(page.getByTestId('collection-amount')).toHaveText(AMENDED_AMOUNT.shown);
    const labels = (await page.locator('li[data-entry-id]').allTextContents()).join('\n');
    const created = labels.indexOf(EN.collectionLogged);
    const amended = labels.indexOf(EN.collectionAmended);
    expect(created, 'collection create in its timeline').toBeGreaterThanOrEqual(0);
    expect(amended, 'collection amend in its timeline').toBeGreaterThan(created);
    await expect(page.locator('#amend')).toHaveCount(0);
  });

  test('the approved report shows its verification panel', async ({
    page,
    baseURL,
    localePath,
  }) => {
    test.skip(
      !VERIFICATION_PANEL_ON_REPORT_PAGE,
      'pending plan 04-07: verification panel not on the report page yet',
    );
    await loginAsEmail(page, baseURL, ISLAMABAD_LEAD);
    await page.goto(localePath(`/reports/${reportId}`));
    const panel = page.getByRole('region', { name: EN.verificationPanel });
    await expect(panel).toBeVisible();
    await expect(panel.locator('bdi[dir="ltr"]').first()).toHaveText(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });
});

test.describe('report in Urdu', { tag: '@smoke' }, () => {
  test('the Islamabad current week reads right-to-left with a Latin-digit total', async ({
    page,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-ur-dark', 'read-only Urdu check runs once');
    await loginAsEmail(page, baseURL, ISLAMABAD_LEAD);
    const list = await apiAs(page, baseURL).get('/api/v1/reports?limit=100');
    expect(list.status()).toBe(200);
    const { items } = (
      (await list.json()) as {
        data: { items: { id: string; weekStart: string }[] };
      }
    ).data;
    expect(items.length).toBeGreaterThan(0);
    const current = [...items].sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0]!;

    const response = await page.goto(`/ur/reports/${current.id}`);
    expect(response?.status()).toBe(200);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ur');
    await expect(html).toHaveAttribute('dir', 'rtl');

    for (const id of ['report-total', 'collections-total']) {
      // Both totals wrap exactly one LTR isolate (`Ltr`, a bdi with dir="ltr") holding the
      // amount, so the amount keeps its order inside the Urdu row.
      const total = page.getByTestId(id).locator('bdi[dir="ltr"]');
      await expect(total, `${id} LTR isolate`).toHaveCount(1);
      await expect(total).toHaveText(/^PKR\s?[\d,]+\.\d{2}$/);
      expect(await total.textContent()).not.toMatch(URDU_DIGITS);
      expect(
        await total.evaluate((node) => getComputedStyle(node).direction),
        `${id} direction`,
      ).toBe('ltr');
    }
  });
});
