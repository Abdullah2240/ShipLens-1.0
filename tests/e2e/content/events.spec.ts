import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { DEMO_BRANCH_NAME } from '../support/roles';

// Events in the content manager: times entered in Pakistan time, an optional branch,
// publish and unpublish reflected on the public Events page. The journey changes the
// public site, so it runs once, in desktop-en-light, in serial mode, with a title that is
// unique to the run.

const DIR = { en: 'ltr', ur: 'rtl' } as const;
const EN = {
  create: 'Create draft',
  saveDraft: 'Save draft',
  saved: 'Draft saved. The public Events page has not changed.',
  publish: 'Publish',
  published: 'Published. The event is now on the public Events page.',
  unpublish: 'Unpublish',
  unpublished: 'Unpublished. The event is no longer on the public site.',
  unpublishedNotice:
    'This draft has changes that are not live yet. Publish to update the public Events page.',
};

function runId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** A calendar date in Pakistan time (UTC+5, no daylight saving), `days` from now. */
function pktDateFromNow(days: number): string {
  const pkt = new Date(Date.now() + days * 86_400_000 + 5 * 3_600_000);
  return pkt.toISOString().slice(0, 10);
}

test.describe('events screens', () => {
  test('the new event form takes Pakistan time left to right', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('content_editor');
    const list = await page.goto(localePath('/content/events'));
    expect(list?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', DIR[uiLocale]);
    await expect(
      page.locator(`main a[href="/${uiLocale}/content/events/new"]`).first(),
    ).toBeVisible();

    const form = await page.goto(localePath('/content/events/new'));
    expect(form?.status()).toBe(200);
    for (const name of ['startsAt', 'endsAt']) {
      const input = page.locator(`input[name="${name}"]`);
      await expect(input).toHaveAttribute('type', 'datetime-local');
      await expect(input).toHaveAttribute('dir', 'ltr');
    }
    await expect(page.locator('input[name="titleUr"]')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('select[name="branchId"] option').first()).toHaveAttribute(
      'value',
      '',
    );
  });
});

test.describe('event journey', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-en-light', 'mutating journey runs once');
  });

  const id = runId();
  const title = `E2E Event ${id}`;
  const venue = `E2E Hall ${id}`;
  const newerVenue = `E2E Annex ${id}`;
  const day = pktDateFromNow(21);
  let editorUrl = '';

  async function save(page: Page) {
    await page.getByRole('button', { name: EN.saveDraft }).click();
    await expect(page.getByText(EN.saved)).toBeVisible();
  }

  async function publicEvent(page: Page) {
    const response = await page.goto('/en/events');
    expect(response?.status()).toBe(200);
    return page
      .locator('main ol > li')
      .filter({ has: page.getByRole('heading', { level: 3, name: title }) });
  }

  test('an event entered at 14:30 Pakistan time reads 14:30 after reload', async ({
    page,
    loginAs,
  }) => {
    await loginAs('content_editor');
    await page.goto('/en/content/events/new');
    await page.locator('input[name="titleEn"]').fill(title);
    await page.locator('input[name="location"]').fill(venue);
    await page.locator('input[name="startsAt"]').fill(`${day}T14:30`);
    await page.getByRole('button', { name: EN.create }).click();
    await expect(page).toHaveURL(/\/en\/content\/events\/[0-9a-f-]{36}$/);
    editorUrl = page.url();

    await page.reload();
    await expect(page.locator('input[name="titleEn"]')).toHaveValue(title);
    await expect(page.locator('input[name="startsAt"]')).toHaveValue(`${day}T14:30`);
    // A draft is not public.
    await expect(await publicEvent(page)).toHaveCount(0);
  });

  test('a branch can be set and cleared', async ({ page, loginAs }) => {
    await loginAs('content_editor');
    await page.goto(editorUrl);
    const branch = page.locator('select[name="branchId"]');

    await branch.selectOption({ label: DEMO_BRANCH_NAME });
    await save(page);
    await page.reload();
    await expect(branch.locator('option:checked')).toHaveText(DEMO_BRANCH_NAME);

    await branch.selectOption('');
    await save(page);
    await page.reload();
    await expect(branch).toHaveValue('');
  });

  test('publishing shows the event on the public Events page in Pakistan time', async ({
    page,
    loginAs,
  }) => {
    await loginAs('content_editor');
    await page.goto(editorUrl);
    await page.getByRole('button', { name: EN.publish, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: EN.publish, exact: true }).click();
    await expect(page.getByText(EN.published)).toBeVisible();

    const card = await publicEvent(page);
    await expect(card).toHaveCount(1);
    await expect(card.locator('time').first()).toContainText('14:30');
    await expect(card).toContainText(venue);
  });

  test('an edit after publishing waits as unpublished changes', async ({ page, loginAs }) => {
    await loginAs('content_editor');
    await page.goto(editorUrl);
    await page.locator('input[name="location"]').fill(newerVenue);
    await save(page);
    await page.reload();
    await expect(page.getByText(EN.unpublishedNotice)).toBeVisible();

    const card = await publicEvent(page);
    await expect(card).toContainText(venue);
    await expect(card).not.toContainText(newerVenue);
  });

  test('unpublishing removes the event from the public Events page', async ({ page, loginAs }) => {
    await loginAs('content_editor');
    await page.goto(editorUrl);
    await page.getByRole('button', { name: EN.unpublish, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: EN.unpublish, exact: true }).click();
    await expect(page.getByText(EN.unpublished)).toBeVisible();

    await expect(await publicEvent(page)).toHaveCount(0);
  });
});
