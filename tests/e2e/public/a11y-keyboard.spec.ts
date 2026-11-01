import { expect, test } from '../support/fixtures';
import { PUBLIC_PAGES } from './public-helpers';

// Keyboard and landmark checks on every public page (PUB-06), signed out and read-only,
// in every project (both languages, both themes, desktop and phone).

const NAV_LABEL = { en: 'Main', ur: 'مرکزی صفحات' } as const;
const SKIP_LABEL = { en: 'Skip to main content', ur: 'مرکزی مواد پر جائیں' } as const;

// Selector for things a keyboard user can reach, minus anything taken out of the tab order.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary';

test.describe('public keyboard and landmarks', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path}: skip link, landmarks and a visible focus on every control`, async ({
      page,
      localePath,
      uiLocale,
    }) => {
      const response = await page.goto(localePath(path));
      expect(response?.status()).toBe(200);
      await page.waitForLoadState('load');

      // Landmarks: one banner, one labelled main navigation, one main, one footer.
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
      await expect(page.getByRole('navigation', { name: NAV_LABEL[uiLocale] })).toHaveCount(1);
      for (const nav of await page.locator('nav').all()) {
        await expect(nav).toHaveAttribute('aria-label', /\S/);
      }

      // The first Tab lands on the visible skip link; Enter moves focus to main.
      await page.keyboard.press('Tab');
      const skip = page.locator(':focus');
      await expect(skip).toHaveAttribute('href', '#main');
      await expect(skip).toHaveText(SKIP_LABEL[uiLocale]);
      await expect(skip).toBeVisible();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('main');

      // Fresh load, then record every element focused while tabbing from the top, with
      // whether it showed a focus outline at that moment.
      await page.goto(localePath(path));
      await page.waitForLoadState('load');
      await page.evaluate(() => {
        document.addEventListener('focusin', (event) => {
          const target = event.target as HTMLElement;
          const style = getComputedStyle(target);
          const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
          const ringed = style.boxShadow !== 'none';
          target.dataset.e2eFocused = outlined || ringed ? 'visible' : 'invisible';
        });
      });

      const expected = await page
        .locator(`header :is(${FOCUSABLE}), main :is(${FOCUSABLE})`)
        .evaluateAll(
          (nodes) =>
            nodes.filter((node) => {
              const el = node as HTMLElement;
              return el.tabIndex >= 0 && !el.closest('[aria-hidden="true"]');
            }).length,
        );
      // Skip link, then every control in header and main; a few spare presses.
      for (let i = 0; i < expected + 3; i += 1) await page.keyboard.press('Tab');

      const missed = await page
        .locator(`header :is(${FOCUSABLE}), main :is(${FOCUSABLE})`)
        .evaluateAll((nodes) =>
          nodes
            .map((node) => node as HTMLElement)
            .filter((el) => el.tabIndex >= 0 && !el.closest('[aria-hidden="true"]'))
            .filter((el) => el.dataset.e2eFocused !== 'visible')
            .map(
              (el) =>
                `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}" (${el.dataset.e2eFocused ?? 'never focused'})`,
            ),
        );
      expect(missed, 'controls not reached by Tab or focused without a visible outline').toEqual(
        [],
      );

      // The named pieces are among them: every nav item, the language switch, the theme buttons.
      const nav = page.getByRole('navigation', { name: NAV_LABEL[uiLocale] });
      await expect(nav.getByRole('link')).toHaveCount(8);
      for (const link of await nav.getByRole('link').all()) {
        await expect(link).toHaveAttribute('data-e2e-focused', 'visible');
      }
      await expect(page.locator('header a[hreflang]')).toHaveAttribute(
        'data-e2e-focused',
        'visible',
      );
      const themeButtons = page.locator('header [role="group"] button');
      await expect(themeButtons).toHaveCount(3);
      for (const button of await themeButtons.all()) {
        await expect(button).toHaveAttribute('data-e2e-focused', 'visible');
      }
    });
  }

  test('every control on the apply form has an accessible name', async ({ page, localePath }) => {
    await page.goto(localePath('/get-involved/apply'));
    const controls = page.locator(
      'main form :is(input:not([type="hidden"]), select, textarea):not([tabindex="-1"])',
    );
    expect(await controls.count()).toBeGreaterThanOrEqual(5);
    for (const control of await controls.all()) {
      await expect(control).toHaveAccessibleName(/\S/);
    }
    await expect(page.locator('main form button[type="submit"]')).toHaveAccessibleName(/\S/);
  });
});
