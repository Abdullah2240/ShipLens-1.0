import { expect, test } from '../support/fixtures';
import {
  acceptThroughApi,
  applicant,
  findApplicationId,
  laidOutLtr,
  runId,
  submitApplication,
} from './people-helpers';

// HR applications screens: list with status tabs, detail, accept and decline.
// Read-only checks run in every project; the decision journey changes data, so it runs
// once, in desktop-en-light, in serial mode. Tests that rely on exact seeded rows are
// tagged @pristine.

// Seeded pending application in the HR Lead's branch (db/seed/data/applications.json).
const SEEDED_PENDING = {
  id: 'bd76373e-bd60-477d-9180-5e2785efe0bf',
  fullName: 'Danish Soomro',
  email: 'danish.soomro.003@shiplens.test',
  phone: '+923000001021', // stored normalised
};
const SEEDED_ACCEPTED = 'Adeel Jafri';

const EN = {
  accept: 'Accept',
  decline: 'Decline',
  confirmAccept: 'Accept and add member',
  confirmDecline: 'Decline application',
  noteLabel: 'Note for the record (optional)',
  declined: 'Application declined.',
  viewMember: 'Open member record',
  decidedBy: 'Decided by',
  alreadyDecided: /already decided/,
  accepted: (name: string) => `Application accepted. ${name} is now a member.`,
};

test.describe('applications screens', () => {
  test(
    'HR Lead lands on pending applications with status tabs',
    { tag: '@pristine' },
    async ({ page, loginAs, localePath, uiLocale }) => {
      await loginAs('hr_lead');
      const response = await page.goto(localePath('/people/applications'));
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('dir', uiLocale === 'ur' ? 'rtl' : 'ltr');

      // The status tabs, told apart from the app navigation by their status links.
      const tabs = page.locator('nav').filter({ has: page.locator('a[href$="?status=accepted"]') });
      const current = tabs.locator('a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('href', `/${uiLocale}/people/applications`);

      const table = page.locator('table');
      await expect(table.getByRole('link', { name: SEEDED_PENDING.fullName })).toBeVisible();
      await expect(table.getByRole('link', { name: SEEDED_ACCEPTED })).toHaveCount(0);
      // HR Lead is scoped to one branch: no branch column.
      await expect(table.locator('thead th')).toHaveCount(4);

      // Email and phone keep their left-to-right order in both languages.
      const email = table.getByText(SEEDED_PENDING.email);
      await expect(email).toHaveAttribute('dir', 'ltr');
      expect(await laidOutLtr(email)).toBe(true);
      await expect(table.getByText(SEEDED_PENDING.phone)).toHaveAttribute('dir', 'ltr');

      // The "all" tab is the last one and shows decided applications too.
      await tabs.locator('a').last().click();
      await expect(page).toHaveURL(/\/people\/applications\?status=all$/);
      await expect(current).toHaveAttribute('href', `/${uiLocale}/people/applications?status=all`);
      await expect(
        page.locator('table').getByRole('link', { name: SEEDED_ACCEPTED }),
      ).toBeVisible();
    },
  );

  test(
    'application detail shows contact details left-to-right',
    { tag: '@pristine' },
    async ({ page, loginAs, localePath }) => {
      await loginAs('hr_lead');
      const response = await page.goto(localePath(`/people/applications/${SEEDED_PENDING.id}`));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(SEEDED_PENDING.fullName);
      const email = page.getByText(SEEDED_PENDING.email, { exact: true });
      await expect(email).toHaveAttribute('dir', 'ltr');
      expect(await laidOutLtr(email)).toBe(true);
      await expect(page.getByText(SEEDED_PENDING.phone, { exact: true })).toHaveAttribute(
        'dir',
        'ltr',
      );
    },
  );

  test('Super Admin sees every branch with a branch column', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('super_admin');
    const response = await page.goto(localePath('/people/applications?status=all'));
    expect(response?.status()).toBe(200);
    await expect(page.locator('table thead th')).toHaveCount(5);
  });

  test('Branch Lead gets the not-found page', async ({ page, loginAs, localePath }) => {
    await loginAs('branch_lead');
    const list = await page.goto(localePath('/people/applications'));
    expect(list?.status()).toBe(404);
    const detail = await page.goto(localePath(`/people/applications/${SEEDED_PENDING.id}`));
    expect(detail?.status()).toBe(404);
  });
});

test.describe('application decisions', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-en-light', 'mutating journey runs once');
  });

  const id = runId();
  const toAccept = applicant('Accept', id);
  const toDecline = applicant('Decline', id);
  const toRace = applicant('Race', id);

  test('HR Lead accepts an application and opens the new member', async ({
    page,
    request,
    baseURL,
    loginAs,
    localePath,
  }) => {
    const hr = await loginAs('hr_lead');
    expect(hr.branchId).toBeTruthy();
    await submitApplication(request, baseURL, hr.branchId!, toAccept);

    await page.goto(localePath('/people/applications'));
    await page.locator('table').getByRole('link', { name: toAccept.fullName }).click();
    await expect(page).toHaveURL(/\/en\/people\/applications\/[0-9a-f-]{36}$/);
    const applicationUrl = page.url();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(toAccept.fullName);
    // The message is plain, pre-wrapped text.
    await expect(page.getByText('Weekend volunteer (Accept).')).toHaveCSS(
      'white-space',
      'pre-wrap',
    );

    // Cancelling the confirmation records nothing.
    await page.getByRole('button', { name: EN.accept, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(toAccept.fullName);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: EN.accept, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: EN.confirmAccept }).click();
    await expect(page.getByText(EN.accepted(toAccept.fullName))).toBeVisible();
    const code = page
      .getByRole('status')
      .filter({ hasText: EN.accepted(toAccept.fullName) })
      .locator('bdi[dir="ltr"]');
    await expect(code).toHaveText(/\S+/);
    await expect(page.getByRole('button', { name: EN.accept, exact: true })).toHaveCount(0);

    await page.getByRole('link', { name: EN.viewMember }).first().click();
    await expect(page).toHaveURL(/\/en\/people\/members\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(toAccept.fullName);

    // Back on the application: decided, with who decided and no controls.
    await page.goto(applicationUrl);
    await expect(page.getByText(EN.decidedBy)).toBeVisible();
    await expect(page.locator('main').getByText(hr.name, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: EN.accept, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: EN.decline, exact: true })).toHaveCount(0);

    // The new member is findable in the members list.
    await page.goto(localePath(`/people/members?q=${encodeURIComponent(toAccept.email)}`));
    await expect(
      page.locator('table').getByRole('link', { name: toAccept.fullName }),
    ).toBeVisible();
  });

  test('HR Lead declines an application with a note', async ({
    page,
    request,
    baseURL,
    loginAs,
    localePath,
  }) => {
    const hr = await loginAs('hr_lead');
    await submitApplication(request, baseURL, hr.branchId!, toDecline);
    const applicationId = await findApplicationId(page, toDecline.email);

    await page.goto(localePath(`/people/applications/${applicationId}`));
    await page.getByRole('button', { name: EN.decline, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(EN.noteLabel).fill('  Not recruiting for this role this month.  ');
    await dialog.getByRole('button', { name: EN.confirmDecline }).click();
    await expect(page.getByText(EN.declined)).toBeVisible();

    await page.reload();
    await expect(page.getByText('Not recruiting for this role this month.')).toBeVisible();
    await expect(page.getByRole('button', { name: EN.decline, exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: EN.viewMember })).toHaveCount(0);
  });

  test('a decision that loses a race explains it', async ({
    page,
    request,
    baseURL,
    loginAs,
    localePath,
  }) => {
    const hr = await loginAs('hr_lead');
    await submitApplication(request, baseURL, hr.branchId!, toRace);
    const applicationId = await findApplicationId(page, toRace.email);

    await page.goto(localePath(`/people/applications/${applicationId}`));
    await expect(page.getByRole('button', { name: EN.accept, exact: true })).toBeEnabled();
    // Someone else decides first.
    const first = await acceptThroughApi(page, baseURL, applicationId);
    expect(first.status).toBe(200);

    await page.getByRole('button', { name: EN.accept, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: EN.confirmAccept }).click();
    await expect(page.getByText(EN.alreadyDecided)).toBeVisible();
    // The refreshed page shows the final decision without controls.
    await expect(page.getByText(EN.decidedBy)).toBeVisible();
    await expect(page.getByRole('button', { name: EN.accept, exact: true })).toHaveCount(0);
  });
});
