import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

// Content manager for page content: the editor's navigation, the list of pages, and the
// draft -> preview -> publish -> unpublish journey reflected on the public page.
// The journey changes a shared public page, so it runs once, in desktop-en-light, in
// serial mode, with a title that is unique to the run.

const APP_NAV_LABEL = { en: 'Primary', ur: 'مرکزی مینو' } as const;
const DIR = { en: 'ltr', ur: 'rtl' } as const;
const KEY = 'contact';

const EN = {
  saveDraft: 'Save draft',
  saved: 'Draft saved. The public page has not changed.',
  previewLink: 'Preview draft',
  previewBanner: 'Private draft preview. Not visible to the public.',
  backToEditor: 'Back to editor',
  publish: 'Publish',
  published: 'Published. Visitors now see this version.',
  unpublish: 'Unpublish',
  unpublished: 'Unpublished. The page is no longer on the public site.',
  unsaved: 'Unsaved changes',
  unpublishedNotice:
    'This draft has changes that are not live yet. Publish to update the public page.',
};

function runId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const appNav = (page: Page, locale: 'en' | 'ur') =>
  page.getByRole('navigation', { name: APP_NAV_LABEL[locale] });

test.describe('content manager', () => {
  test('Content Editor sees the Content entry and the pages list', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('content_editor');
    const response = await page.goto(localePath('/content'));
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', DIR[uiLocale]);

    const nav = appNav(page, uiLocale);
    await expect(nav.locator(`a[href="/${uiLocale}/content"]`)).toHaveCount(1);
    await expect(nav.locator(`a[href^="/${uiLocale}/people/"]`)).toHaveCount(0);

    // Four pages, each with an English and an Urdu cell.
    for (const key of ['about', 'programs', 'get-involved', 'contact']) {
      for (const entryLocale of ['en', 'ur']) {
        await expect(
          page.locator(`table a[href="/${uiLocale}/content/${key}/${entryLocale}"]`),
        ).toHaveCount(1);
      }
    }
  });

  test('the Urdu entry editor writes right to left', async ({ page, loginAs, localePath }) => {
    await loginAs('content_editor');
    const response = await page.goto(localePath(`/content/${KEY}/ur`));
    expect(response?.status()).toBe(200);
    const title = page.locator('input[name="title"]');
    await expect(title).toHaveAttribute('lang', 'ur');
    await expect(title).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('textarea[name="body"]')).toHaveAttribute('dir', 'rtl');
  });

  test('HR Lead sees people entries but not Content', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('hr_lead');
    const response = await page.goto(localePath('/people/members'));
    expect(response?.status()).toBe(200);
    const nav = appNav(page, uiLocale);
    for (const path of ['/people/applications', '/people/members', '/people/teams']) {
      await expect(nav.locator(`a[href="/${uiLocale}${path}"]`)).toHaveCount(1);
    }
    await expect(nav.locator(`a[href="/${uiLocale}/content"]`)).toHaveCount(0);

    const content = await page.goto(localePath('/content'));
    expect(content?.status()).toBe(404);
  });
});

test.describe('page content journey', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-en-light', 'mutating journey runs once');
  });

  const id = runId();
  const title = `E2E Contact ${id}`;
  const body = `Visit your nearest branch on Saturday mornings. Marker ${id}.`;
  const newerTitle = `E2E Contact newer ${id}`;
  const editorPath = `/en/content/${KEY}/en`;

  async function publicContact(page: Page) {
    const response = await page.goto(`/en/${KEY}`);
    expect(response?.status()).toBe(200);
    return page.locator('main');
  }

  test('a saved draft is private and shows in the preview', async ({ page, loginAs }) => {
    await loginAs('content_editor');
    await page.goto(editorPath);
    await page.locator('input[name="title"]').fill(title);
    await page.locator('textarea[name="body"]').fill(body);
    await expect(page.getByText(EN.unsaved)).toBeVisible();
    await page.getByRole('button', { name: EN.saveDraft }).click();
    await expect(page.getByText(EN.saved)).toBeVisible();

    await expect(await publicContact(page)).not.toContainText(title);

    await page.goto(editorPath);
    await page.getByRole('link', { name: EN.previewLink }).click();
    await expect(page).toHaveURL(new RegExp(`${editorPath}/preview$`));
    await expect(page.getByText(EN.previewBanner)).toBeVisible();
    await expect(page.locator('article')).toContainText(title);
    await expect(page.locator('article')).toContainText(`Marker ${id}.`);
  });

  test('publishing puts the page on the public site', async ({ page, loginAs }) => {
    await loginAs('content_editor');
    await page.goto(editorPath);
    await expect(page.locator('input[name="title"]')).toHaveValue(title);

    await page.getByRole('button', { name: EN.publish, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: EN.publish, exact: true }).click();
    await expect(page.getByText(EN.published)).toBeVisible();

    const main = await publicContact(page);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(main).toContainText(`Marker ${id}.`);
  });

  test('a newer draft does not change the public page', async ({ page, loginAs }) => {
    await loginAs('content_editor');
    await page.goto(editorPath);
    await page.locator('input[name="title"]').fill(newerTitle);
    await page.getByRole('button', { name: EN.saveDraft }).click();
    await expect(page.getByText(EN.saved)).toBeVisible();
    await page.reload();
    await expect(page.getByText(EN.unpublishedNotice)).toBeVisible();

    const main = await publicContact(page);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(main).not.toContainText(newerTitle);
  });

  test('unpublishing takes the page copy off the public site', async ({ page, loginAs }) => {
    await loginAs('content_editor');
    await page.goto(editorPath);
    await page.getByRole('button', { name: EN.unpublish, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: EN.unpublish, exact: true }).click();
    await expect(page.getByText(EN.unpublished)).toBeVisible();

    const main = await publicContact(page);
    await expect(main).not.toContainText(title);
    await expect(main).not.toContainText(newerTitle);
  });
});
