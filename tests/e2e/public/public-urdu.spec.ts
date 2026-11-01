import { expect, test } from '../support/fixtures';
import { pageName, PUBLIC_PAGES, screenshot } from './public-helpers';

// Urdu reading checks on every public page (I18N-01, public side), signed out and read-only.
// Runs in the two Urdu projects only.

// Latin words allowed to stand alone on an Urdu page: the brand, currency, time zone and
// compact figures (numbers stay Latin, for example chart ticks such as 1.5M).
const ALLOWED_LATIN = /^(?:ShipLens|PKR|PKT|\d+(?:\.\d+)?[kMB])$/;

test.describe('public pages in Urdu', () => {
  test.beforeEach(({ uiLocale }) => {
    test.skip(uiLocale !== 'ur', 'Urdu projects only');
  });

  for (const path of PUBLIC_PAGES) {
    test(`${path}: right to left, Nastaliq heading, no stray English`, async ({
      page,
      localePath,
    }, testInfo) => {
      const response = await page.goto(localePath(path));
      expect(response?.status()).toBe(200);
      await page.waitForLoadState('load');

      const html = page.locator('html');
      await expect(html).toHaveAttribute('lang', 'ur');
      await expect(html).toHaveAttribute('dir', 'rtl');

      const h1 = page.locator('main h1').first();
      await expect(h1).toHaveClass(/font-display-ur/);
      const fontFamily = await h1.evaluate((el) => getComputedStyle(el).fontFamily);
      expect(fontFamily, 'heading font').toMatch(/Nastaliq/i);

      // Visible text runs with Latin letters and no Urdu, outside places where English is
      // expected: isolates, explicit LTR or English islands, user-entered text that carries
      // its own direction (dir="auto", such as a branch summary typed in English), and the
      // inside of charts, whose accessible name is the translated summary. Select options
      // hold branch names as typed and cannot contain isolates, so they are left out too.
      const stray = await page.evaluate((allowed) => {
        const allowedRe = new RegExp(allowed);
        const found: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = (node.textContent ?? '').trim();
          if (!/[A-Za-z]/.test(text) || /\p{Script=Arabic}/u.test(text)) continue;
          const parent = node.parentElement;
          if (!parent) continue;
          if (
            parent.closest(
              'script, style, noscript, bdi, [dir="ltr"], [dir="auto"], [lang="en"], svg[role="img"], option',
            )
          )
            continue;
          if (parent.closest('[hidden], [aria-hidden="true"]')) continue;
          const style = getComputedStyle(parent);
          // Screen-reader-only text still counts: it is read aloud.
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
          if (words.every((w) => allowedRe.test(w.replace(/[^\w.]/g, '')))) continue;
          found.push(text.slice(0, 60));
        }
        return found;
      }, ALLOWED_LATIN.source);
      expect(stray, `English text on the Urdu ${path}`).toEqual([]);

      await screenshot(page, testInfo, `ur-${pageName(path)}`);
    });
  }
});
