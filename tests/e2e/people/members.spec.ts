import { expect, test } from '../support/fixtures';
import {
  acceptThroughApi,
  applicant,
  findApplicationId,
  laidOutLtr,
  runId,
  submitApplication,
} from './people-helpers';

// Members and teams screens. Read-only checks run in every project; edits run once, in
// desktop-en-light, in serial mode, on a member and a team this run creates. Tests that
// rely on exact seeded rows are tagged @pristine.

// Seeded members of the HR Lead's branch (db/seed/data/members.json), sorted by name.
const ADEELS = ['Adeel Butt', 'Adeel Gilani', 'Adeel Jafri', 'Adeel Rana'];
const EDUCATION_TEAM = 'Education Support';
const EDUCATION_ADEELS = ['Adeel Gilani', 'Adeel Jafri'];
const SEEDED_MEMBER = {
  fullName: 'Adeel Butt',
  email: 'adeel.butt.019@shiplens.test',
  phone: '+923000001133', // stored normalised
};

const EN = {
  save: 'Save changes',
  saved: 'Changes saved',
  leftTitle: 'Mark this member as left?',
  leftConfirm: 'Mark as left',
  cancel: 'Cancel',
  teamName: 'Team name',
  createTeam: 'Create team',
  created: 'Team created',
  duplicate: 'A team with this name already exists in this branch.',
  renamed: 'Team renamed',
  renameAction: (name: string) => `Rename ${name}`,
  renameLabel: (name: string) => `New name for ${name}`,
};

const rowNames = (page: import('@playwright/test').Page) =>
  page.locator('table tbody tr').getByRole('link').allTextContents();

test.describe('members list', () => {
  test(
    'HR Lead searches, filters and pages with shareable URLs',
    { tag: '@pristine' },
    async ({ page, context, loginAs, localePath }) => {
      await loginAs('hr_lead');
      await page.goto(localePath('/people/members'));

      // Search through the GET form: the query lands in the URL.
      const search = page.locator('form[role="search"]');
      await search.locator('#members-q').fill('Adeel');
      await search.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/[?&]q=Adeel(?:&|$)/);
      expect(await rowNames(page)).toEqual(ADEELS);

      // Smaller pages: page 1 of 2, then the next link.
      await page.goto(localePath('/people/members?q=Adeel&pageSize=3'));
      expect(await rowNames(page)).toEqual(ADEELS.slice(0, 3));
      await page.locator('nav a[href*="page=2"]').click();
      await expect(page).toHaveURL(/[?&]page=2(?:&|$)/);
      expect(await rowNames(page)).toEqual(ADEELS.slice(3));

      // The URL is shareable: a fresh tab shows the same page.
      const shared = await context.newPage();
      await shared.goto(page.url());
      expect(await rowNames(shared)).toEqual(ADEELS.slice(3));
      await shared.close();

      // Applying a filter keeps the search and page size and goes back to page 1.
      await search.locator('#members-team').selectOption({ label: EDUCATION_TEAM });
      await search.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/[?&]teamId=[0-9a-f-]{36}(?:&|$)/);
      expect(new URL(page.url()).searchParams.get('page')).toBeNull();
      expect(new URL(page.url()).searchParams.get('q')).toBe('Adeel');
      expect(new URL(page.url()).searchParams.get('pageSize')).toBe('3');
      expect(await rowNames(page)).toEqual(EDUCATION_ADEELS);

      // Role filter with no match shows the empty state, not a table.
      await page.goto(localePath('/people/members?q=Adeel&role=mentor'));
      await expect(page.locator('table')).toHaveCount(0);
    },
  );

  test(
    'IDs, emails and phones stay left-to-right',
    { tag: '@pristine' },
    async ({ page, loginAs, localePath, theme }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-ur-dark', 'Urdu dark desktop check');
      await loginAs('hr_lead');
      await page.goto(localePath(`/people/members?q=${encodeURIComponent(SEEDED_MEMBER.email)}`));
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const row = page.locator('table tbody tr').filter({ hasText: SEEDED_MEMBER.fullName });
      await expect(row).toHaveCount(1);
      // The member code is the first cell; the email and phone checked below are LTR
      // isolates of their own in the contact cell.
      const code = row.locator('td').first().locator('bdi[dir="ltr"]');
      await expect(code).toHaveCount(1);
      await expect(code).toHaveText(/^M\d{5,}$/);
      expect(await laidOutLtr(code)).toBe(true);
      const email = row.getByText(SEEDED_MEMBER.email, { exact: true });
      await expect(email).toHaveAttribute('dir', 'ltr');
      expect(await laidOutLtr(email)).toBe(true);
      const phone = row.getByText(SEEDED_MEMBER.phone, { exact: true });
      await expect(phone).toHaveAttribute('dir', 'ltr');
      expect(await laidOutLtr(phone)).toBe(true);

      // The same on the member page.
      await row.getByRole('link', { name: SEEDED_MEMBER.fullName }).click();
      await expect(page).toHaveURL(/\/ur\/people\/members\/[0-9a-f-]{36}$/);
      const main = page.locator('main');
      expect(await laidOutLtr(main.locator('bdi[dir="ltr"]'))).toBe(true);
      expect(await laidOutLtr(main.getByText(SEEDED_MEMBER.email, { exact: true }))).toBe(true);
      expect(await laidOutLtr(main.getByText(SEEDED_MEMBER.phone, { exact: true }))).toBe(true);
    },
  );

  test('Branch Lead can read members and teams but not change them', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('branch_lead');
    const list = await page.goto(localePath('/people/members'));
    expect(list?.status()).toBe(200);
    const firstMember = page.locator('table tbody tr').first().getByRole('link').first();
    await expect(firstMember).toBeVisible();

    await firstMember.click();
    await expect(page).toHaveURL(/\/people\/members\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const main = page.locator('main');
    await expect(main.locator('select')).toHaveCount(0);
    await expect(main.locator('button[type="submit"]')).toHaveCount(0);

    const teams = await page.goto(localePath('/people/teams'));
    expect(teams?.status()).toBe(200);
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('main input')).toHaveCount(0);
    await expect(page.locator('main table button')).toHaveCount(0);
  });
});

test.describe('member and team changes', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-en-light', 'mutating checks run once');
  });

  const id = runId();
  const teamName = `Clinic E2E ${id}`;
  const renamedTeam = `Clinic Crew E2E ${id}`;
  const person = applicant('Member', id);

  test('HR Lead creates a team, is told about a duplicate, and renames it', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('hr_lead');
    await page.goto(localePath('/people/teams'));

    const nameField = page.getByLabel(EN.teamName);
    await nameField.fill(teamName);
    await page.getByRole('button', { name: EN.createTeam }).click();
    await expect(page.getByText(EN.created)).toBeVisible();
    await expect(page.locator('table').getByText(teamName, { exact: true })).toBeVisible();

    await nameField.fill(teamName);
    await page.getByRole('button', { name: EN.createTeam }).click();
    await expect(page.getByText(EN.duplicate)).toBeVisible();
    await expect(nameField).toHaveAttribute('aria-invalid', 'true');

    await page.getByRole('button', { name: EN.renameAction(teamName) }).click();
    const renameField = page.getByLabel(EN.renameLabel(teamName));
    await renameField.fill(renamedTeam);
    await page.locator('table').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(EN.renamed)).toBeVisible();

    await page.reload();
    const table = page.locator('table');
    await expect(table.getByText(renamedTeam, { exact: true })).toBeVisible();
    await expect(table.getByText(teamName, { exact: true })).toHaveCount(0);
  });

  test('HR Lead edits a member and confirms marking them as left', async ({
    page,
    request,
    baseURL,
    loginAs,
    localePath,
  }) => {
    const hr = await loginAs('hr_lead');
    await submitApplication(request, baseURL, hr.branchId!, person);
    const applicationId = await findApplicationId(page, person.email);
    const accepted = await acceptThroughApi(page, baseURL, applicationId);
    expect(accepted.status).toBe(200);

    await page.goto(localePath(`/people/members/${accepted.memberId}`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(person.fullName);
    const main = page.locator('main');
    const team = main.locator('select[name="teamId"]');
    const role = main.locator('select[name="memberRole"]');
    const status = main.locator('select[name="status"]');
    const save = main.getByRole('button', { name: EN.save });

    // Team and role.
    await expect(save).toBeDisabled();
    await team.selectOption({ label: renamedTeam });
    await role.selectOption('team_lead');
    await save.click();
    await expect(main.getByText(EN.saved)).toBeVisible();
    await page.reload();
    await expect(team.locator('option:checked')).toHaveText(renamedTeam);
    await expect(role).toHaveValue('team_lead');

    // Marking as left asks first; cancelling sends nothing.
    await status.selectOption('left');
    await save.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: EN.leftTitle })).toBeVisible();
    await dialog.getByRole('button', { name: EN.cancel }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(status).toHaveValue('active');

    await status.selectOption('left');
    await save.click();
    await page.getByRole('dialog').getByRole('button', { name: EN.leftConfirm }).click();
    await expect(main.getByText(EN.saved)).toBeVisible();
    await page.reload();
    await expect(status).toHaveValue('left');

    // The member list reflects the change.
    await page.goto(
      localePath(`/people/members?q=${encodeURIComponent(person.email)}&status=left`),
    );
    await expect(page.locator('table').getByRole('link', { name: person.fullName })).toBeVisible();
  });
});
