import { expect, test } from '../support/fixtures';
import {
  isMobileProject,
  pageName,
  PUBLIC_PAGES,
  screenshot,
  textContrast,
} from './public-helpers';

// Layout and theme checks on every public page (PUB-03), signed out and read-only.
// Phones: no sideways page scroll and a usable navigation. Every project: readable text
// in both light and dark, and a full-page screenshot for review.

const NAV_LABEL = { en: 'Main', ur: 'مرکزی صفحات' } as const;

// Text that must stay readable: the page heading, the first paragraph in main, a nav link.
const TEXT_SAMPLES = ['main h1', 'main p', 'header nav a'] as const;

test.describe('public layout and themes', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path}: fits the screen and reads in light and dark`, async ({
      page,
      localePath,
      theme,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const response = await page.goto(localePath(path));
      expect(response?.status()).toBe(200);
      await page.waitForLoadState('load');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      if (isMobileProject(testInfo)) {
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(scrollWidth, `no horizontal page scroll on ${path}`).toBeLessThanOrEqual(
          innerWidth + 1,
        );
      }

      for (const mode of ['light', 'dark'] as const) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, mode);
        for (const selector of TEXT_SAMPLES) {
          const ratio = await textContrast(page, selector);
          expect(ratio, `${selector} on ${path} in ${mode}`).not.toBeNull();
          expect(ratio!, `${selector} contrast on ${path} in ${mode}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await screenshot(page, testInfo, pageName(path));
    });
  }

  test('on phones the main navigation scrolls inside itself and every item opens', async ({
    page,
    localePath,
    uiLocale,
  }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'Phone layout only');
    await page.goto(localePath('/'));
    const nav = page.getByRole('navigation', { name: NAV_LABEL[uiLocale] });
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(8);

    // The last item is reachable by scrolling the bar, and tapping it opens the page.
    const last = links.last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    const box = await last.boundingBox();
    expect(box?.height ?? 0, 'nav item tap height').toBeGreaterThanOrEqual(24);
    await last.tap();
    await expect(page).toHaveURL(new RegExp(`/${uiLocale}/contact$`));
    await expect(last).toHaveAttribute('aria-current', 'page');

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });
});
