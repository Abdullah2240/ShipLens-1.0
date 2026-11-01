import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '../../support/fixtures';

// The demo dataset's oracle, db/seed/expected.json. The runner mounts it read-only next to
// playwright.config.ts (/e2e/db/seed/expected.json); on the host it sits in the repository
// root. E2E_EXPECTED_JSON overrides the location. Specs never import app code, so the
// money formatter below mirrors formatMoney: "PKR ", Latin digits, 3-digit grouping and
// two decimals, in both languages.

export type Figure = { amount: string; count: number };

export type ApprovedReport = {
  reportId: string;
  branch: string;
  weekStart: string;
  amount: string;
  count: number;
};

export type Expected = {
  asOf: string;
  kpis: Record<string, Figure | number>;
  byBranch: Record<string, Record<string, Figure>>;
  byMonth: Record<string, Record<string, Figure>>;
  approvedReports: ApprovedReport[];
};

export function expectedPath(): string {
  if (process.env.E2E_EXPECTED_JSON) return process.env.E2E_EXPECTED_JSON;
  const config = test.info().config.configFile;
  const root = config ? path.dirname(config) : process.cwd();
  return path.join(root, 'db', 'seed', 'expected.json');
}

/** The oracle, or null when the file is not mounted (for example a live-URL smoke run). */
export function loadExpected(): Expected | null {
  const file = expectedPath();
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Expected;
}

/** Skips the calling test with a clear reason when the oracle is not readable. */
export function requireExpected(): Expected {
  const expected = loadExpected();
  test.skip(
    expected === null,
    `db/seed/expected.json is not readable at ${expectedPath()}: mount it into the runner`,
  );
  return expected as Expected;
}

export function group(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "4692717.65" -> "PKR 4,692,717.65". */
export function money(amount: string): string {
  const [whole = '0', cents = '00'] = amount.replace(/^-/, '').split('.');
  return `PKR ${group(whole)}.${cents.padEnd(2, '0')}`;
}

/** The first "PKR 1,234.56" in a text, or throws. */
export function moneyIn(text: string): string {
  const match = /PKR\s*[\d,]+\.\d{2}/.exec(text.replace(/ /g, ' '));
  if (!match) throw new Error(`no money amount in "${text}"`);
  return match[0].replace(/PKR\s*/, 'PKR ');
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
