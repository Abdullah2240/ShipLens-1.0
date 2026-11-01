import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import type { Role } from '../support/roles';
import { AUTH_ROUTES, LATIN_TOKENS, routesFor, type PrivateRoute } from './private-routes';

// I18N-01 and I18N-04 on the private side: every private screen, for every role that can
// open it, renders in Urdu right to left with no untranslated text, no horizontal page
// overflow at phone width and no clipped headings or buttons. Read-only, so it runs in
// both Urdu projects (dark desktop, light phone). Screenshots go to
// test-results/screens/rtl/<project>/<route>--<role>.png for review.

const PHONE = { width: 390, height: 844 };
const ROLES: Role[] = [
  'super_admin',
  'finance_reviewer',
  'content_editor',
  'branch_lead',
  'hr_lead',
];

type Findings = {
  lang: string | null;
  dir: string | null;
  latinOnly: string[];
  clipped: string[];
  overflow: number;
};

/** Runs in the page: collects what a reader of the Urdu screen would see in the wrong shape. */
function inspect(tokens: string[]): Findings {
  // Isolates (bdi, dir ltr or auto), code, form fields, decorative glyphs, text in another
  // declared language, and chart tick labels the chart itself sets to LTR (Latin numbers).
  const SKIP =
    'script, style, noscript, template, code, pre, kbd, samp, input, textarea, select, option, bdi, [dir="ltr"], [dir="auto"], [direction="ltr"], [aria-hidden="true"], [lang]:not([lang="ur"])';
  const tokenPattern = new RegExp(`(?<![A-Za-z])(?:${tokens.join('|')})(?![A-Za-z])`, 'g');
  const visible = (el: Element) => {
    const style = getComputedStyle(el);
    return (
      style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0
    );
  };

  const latinOnly = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP) || !visible(parent)) continue;
    if (/[؀-ۿ]/.test(text)) continue;
    if (/[A-Za-z]/.test(text.replace(tokenPattern, ' '))) latinOnly.add(text);
  }

  const clipped: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(
    'h1, h2, h3, h4, h5, h6, button, [role="button"]',
  )) {
    if (!visible(el)) continue;
    // Visually hidden (sr-only) headings are clipped on purpose.
    const box = el.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) continue;
    const style = getComputedStyle(el);
    const hides = ['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis';
    if (hides && el.scrollWidth > el.clientWidth + 1) {
      clipped.push((el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80));
    }
  }

  const root = document.documentElement;
  return {
    lang: root.getAttribute('lang'),
    dir: root.getAttribute('dir'),
    latinOnly: [...latinOnly],
    clipped,
    overflow: Math.max(0, root.scrollWidth - window.innerWidth),
  };
}

function isPhone(testInfo: TestInfo) {
  return testInfo.project.name.startsWith('mobile');
}

async function sweep(page: Page, testInfo: TestInfo, url: string, shot: string) {
  const response = await page.goto(url);
  expect.soft(response?.status() ?? 0, `${url} status`).toBeLessThan(400);
  await page.locator('main').first().waitFor();
  // Settle client-side requests; a screen that keeps polling is still swept.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);

  const found = await page.evaluate(inspect, LATIN_TOKENS);
  expect.soft(found.lang, `${url}: html lang`).toBe('ur');
  expect.soft(found.dir, `${url}: html dir`).toBe('rtl');
  expect.soft(found.latinOnly, `${url}: Latin-only text outside isolates`).toEqual([]);
  expect.soft(found.clipped, `${url}: clipped headings or buttons`).toEqual([]);
  if (isPhone(testInfo)) {
    expect.soft(found.overflow, `${url}: horizontal page overflow at ${PHONE.width}px`).toBe(0);
  }

  await page.screenshot({
    path: `test-results/screens/rtl/${testInfo.project.name}/${shot}.png`,
    fullPage: true,
  });
}

test.describe('Urdu RTL sweep of the private screens', () => {
  test.beforeEach(async ({ uiLocale, page }, testInfo) => {
    test.skip(uiLocale !== 'ur', 'The RTL sweep runs on the Urdu projects');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (isPhone(testInfo)) await page.setViewportSize(PHONE);
  });

  for (const role of ROLES) {
    test(`${role}: every screen reads right to left in Urdu`, async ({
      page,
      loginAs,
      localePath,
    }, testInfo) => {
      test.setTimeout(10 * 60_000);
      await loginAs(role);
      for (const route of routesFor(role)) {
        await test.step(route.name, async () => {
          const path = await resolvePath(page, route);
          if (!path) {
            testInfo.annotations.push({
              type: 'skipped-route',
              description: `${route.name}: no record for ${role} in the demo data`,
            });
            return;
          }
          await sweep(page, testInfo, localePath(path), `${route.name}--${role}`);
        });
      }
    });
  }

  test('signed out: the sign-in screen reads right to left in Urdu', async ({
    page,
    localePath,
  }, testInfo) => {
    for (const route of AUTH_ROUTES) {
      await test.step(route.name, async () => {
        await sweep(page, testInfo, localePath(route.path), route.name);
      });
    }
  });
});

async function resolvePath(page: Page, route: PrivateRoute): Promise<string | null> {
  return typeof route.path === 'string' ? route.path : route.path(page);
}
