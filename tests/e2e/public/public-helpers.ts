import type { Page, TestInfo } from '@playwright/test';

// Shared by the public accessibility, layout and Urdu specs. Read-only helpers.

/** Every public page, locale-less ('/' is home). */
export const PUBLIC_PAGES = [
  '/',
  '/about',
  '/programs',
  '/branches',
  '/events',
  '/impact',
  '/get-involved',
  '/get-involved/apply',
  '/contact',
] as const;

export type PublicPage = (typeof PUBLIC_PAGES)[number];

export const pageName = (path: string) =>
  path === '/' ? 'home' : path.slice(1).replace(/\//g, '-');

export async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `test-results/screens/public/${testInfo.project.name}-${name}.png`,
    fullPage: true,
  });
}

export const isMobileProject = (testInfo: TestInfo) => testInfo.project.name.startsWith('mobile-');

/**
 * WCAG contrast ratio of an element's text against its effective background, worked out
 * in the browser: the background layers from the root down to the element are painted
 * onto a canvas (so any CSS colour syntax and alpha work), then the text colour on top.
 */
export async function textContrast(page: Page, selector: string): Promise<number | null> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const paint = (color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b] as const;
    };

    const layers: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      layers.unshift(getComputedStyle(node).backgroundColor);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    let background: readonly [number, number, number] = [255, 255, 255];
    for (const layer of layers) background = paint(layer);
    const text = paint(getComputedStyle(element).color);

    const luminance = ([r, g, b]: readonly [number, number, number]) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const [hi, lo] = [luminance(text), luminance(background)].sort((a, b) => b - a);
    return (hi! + 0.05) / (lo! + 0.05);
  }, selector);
}
