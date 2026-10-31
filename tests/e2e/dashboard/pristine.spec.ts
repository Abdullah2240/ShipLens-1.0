import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '../support/fixtures';

// Exact on-screen values on a freshly seeded stack: every dashboard figure equals
// db/seed/expected.json. Run before any spec that approves or routes (`--grep @pristine`).
// The formatters mirror formatMoney and formatInt (specs cannot import app code).

function group(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function money(amount: string): string {
  const [whole = '0', cents = '00'] = amount.split('.');
  return `PKR ${group(whole)}.${cents.padEnd(2, '0')}`;
}
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type Kpis = Record<string, { amount: string; count: number } | number>;

// The repository root is the folder of playwright.config.ts (on the host and in the runner,
// which must mount db/seed/expected.json there); E2E_EXPECTED_JSON overrides it.
function expectedPath(): string {
  if (process.env.E2E_EXPECTED_JSON) return process.env.E2E_EXPECTED_JSON;
  const config = test.info().config.configFile;
  const root = config ? path.dirname(config) : process.cwd();
  return path.join(root, 'db', 'seed', 'expected.json');
}

function loadKpis(file: string): Kpis | null {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  return (JSON.parse(text) as { kpis: Kpis }).kpis;
}

const SLUGS: Record<string, string> = {
  collected: 'collected',
  approved: 'approved',
  pending_approval: 'pending-approval',
  in_progress: 'in-progress',
  not_yet_routed: 'not-yet-routed',
  routed: 'routed',
  active_branches: 'active-branches',
  reports_awaiting_review: 'reports-awaiting-review',
};

test.describe('dashboard on the demo dataset', { tag: '@pristine' }, () => {
  test('every figure equals db/seed/expected.json', async ({ page, loginAs, localePath }) => {
    const file = expectedPath();
    const kpis = loadKpis(file);
    test.skip(
      kpis === null,
      `db/seed/expected.json is not readable at ${file}: mount it into the runner`,
    );
    if (!kpis) return;

    await loginAs('super_admin');
    const response = await page.goto(localePath('/dashboard'));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    for (const [figure, slug] of Object.entries(SLUGS)) {
      const expected = kpis[figure];
      expect(expected, `expected.json kpis.${figure}`).toBeDefined();
      if (expected === undefined) continue;
      const name =
        typeof expected === 'number'
          ? new RegExp(`[,،] ${escape(group(String(expected)))}:`)
          : new RegExp(escape(money(expected.amount)));
      const links = page
        .locator(`main a[href="${localePath(`/dashboard/kpi/${slug}`)}"]`)
        .filter({ visible: true });
      await expect(links.first(), `${figure} link`).toBeVisible();
      for (const link of await links.all()) {
        await expect(link, `${figure} on screen`).toHaveAccessibleName(name);
      }
    }

    // Record counts behind the two hero figures.
    for (const figure of ['collected', 'approved'] as const) {
      const expected = kpis[figure];
      if (typeof expected !== 'object') continue;
      await expect(page.locator(`[data-flow-panel="${figure}"]`)).toContainText(
        group(String(expected.count)),
      );
    }
  });
});
