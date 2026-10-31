import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { computeExpected, loadDataFiles } from './expected.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(root, 'scripts', 'demo-data', 'expected.mjs');
const dataDir = path.join(root, 'db', 'seed', 'data');
const expectedFile = path.join(root, 'db', 'seed', 'expected.json');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'demo-expected-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const MONEY_KPIS = [
  'collected',
  'approved',
  'pending_approval',
  'in_progress',
  'not_yet_routed',
  'routed',
];
const CANONICAL = /^(0|[1-9]\d*)\.\d{2}$/;

function run(...args) {
  try {
    execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: 'pipe' });
    return 0;
  } catch (error) {
    return error.status;
  }
}

function money(amount, count) {
  return { amount, count };
}

const ZERO = money('0.00', 0);

function collection(id, reportId, branchKey, amount, collectedOn, extra = {}) {
  return {
    id,
    reportId,
    branchKey,
    amount,
    collectedOn,
    purpose: 'General donations',
    note: null,
    status: 'active',
    voidReason: null,
    voidedAt: null,
    createdByKey: 'lead',
    createdAt: `${collectedOn}T06:00:00.000Z`,
    routedAt: null,
    routedByKey: null,
    ...extra,
  };
}

// Hand-built: Alpha (active) holds a draft and a returned report, Beta (paused) a submitted
// and an approved one. Eight collections over two PKT months, one voided, one routed.
const mini = {
  manifest: { version: 1, seed: 7, asOf: '2026-10-31', weeks: [], files: [] },
  branches: [
    { key: 'a', name: 'Alpha (Demo)', city: 'X', summary: '', status: 'active', adopt: false },
    { key: 'b', name: 'Beta (Demo)', city: 'Y', summary: '', status: 'paused', adopt: false },
  ],
  users: [],
  teams: [],
  members: [],
  applications: [],
  reports: [
    {
      id: 'r-draft',
      branchKey: 'a',
      weekStart: '2026-09-07',
      status: 'draft',
      history: [],
      confirmNil: false,
    },
    {
      id: 'r-returned',
      branchKey: 'a',
      weekStart: '2026-08-17',
      status: 'returned',
      history: [],
      confirmNil: false,
    },
    {
      id: 'r-submitted',
      branchKey: 'b',
      weekStart: '2026-08-31',
      status: 'submitted',
      history: [],
      confirmNil: false,
    },
    {
      id: 'r-approved',
      branchKey: 'b',
      weekStart: '2026-08-24',
      status: 'approved',
      history: [],
      confirmNil: false,
    },
  ],
  collections: [
    collection('c1', 'r-draft', 'a', '100.00', '2026-09-08'),
    collection('c2', 'r-draft', 'a', '50.25', '2026-09-09', {
      status: 'voided',
      voidReason: 'Entered twice.',
      voidedAt: '2026-09-09T08:00:00.000Z',
    }),
    collection('c3', 'r-approved', 'b', '1000.00', '2026-08-25', {
      routedAt: '2026-09-05T08:00:00.000Z',
      routedByKey: 'finance',
    }),
    collection('c4', 'r-approved', 'b', '250.50', '2026-08-26'),
    collection('c5', 'r-submitted', 'b', '300.00', '2026-09-01'),
    collection('c6', 'r-submitted', 'b', '0.75', '2026-09-02'),
    collection('c7', 'r-returned', 'a', '40.00', '2026-08-18'),
    collection('c8', 'r-returned', 'a', '9.99', '2026-08-19'),
  ],
};

describe('computeExpected on a hand-built dataset', () => {
  const expected = computeExpected(mini);

  it('computes the headline KPIs', () => {
    expect(expected.kpis).toEqual({
      collected: money('1701.24', 7),
      approved: money('1250.50', 2),
      pending_approval: money('300.75', 2),
      in_progress: money('149.99', 3),
      not_yet_routed: money('250.50', 1),
      routed: money('1000.00', 1),
      active_branches: 1,
      reports_awaiting_review: 1,
    });
  });

  it('computes voided totals and report counts', () => {
    expect(expected.voided).toEqual(money('50.25', 1));
    expect(expected.reportsByStatus).toEqual({ draft: 1, submitted: 1, returned: 1, approved: 1 });
  });

  it('computes per-branch figures keyed by branch name', () => {
    expect(expected.byBranch).toEqual({
      'Alpha (Demo)': {
        collected: money('149.99', 3),
        approved: ZERO,
        pending_approval: ZERO,
        in_progress: money('149.99', 3),
        not_yet_routed: ZERO,
        routed: ZERO,
      },
      'Beta (Demo)': {
        collected: money('1551.25', 4),
        approved: money('1250.50', 2),
        pending_approval: money('300.75', 2),
        in_progress: ZERO,
        not_yet_routed: money('250.50', 1),
        routed: money('1000.00', 1),
      },
    });
  });

  it('computes per-month figures keyed by PKT month of collectedOn', () => {
    expect(expected.byMonth).toEqual({
      '2026-08': {
        collected: money('1300.49', 4),
        approved: money('1250.50', 2),
        pending_approval: ZERO,
        in_progress: money('49.99', 2),
        not_yet_routed: money('250.50', 1),
        routed: money('1000.00', 1),
      },
      '2026-09': {
        collected: money('400.75', 3),
        approved: ZERO,
        pending_approval: money('300.75', 2),
        in_progress: money('100.00', 1),
        not_yet_routed: ZERO,
        routed: ZERO,
      },
    });
    expect(Object.keys(expected.byMonth)).toEqual(['2026-08', '2026-09']);
  });

  it('lists approved reports with their live totals', () => {
    expect(expected.approvedReports).toEqual([
      {
        reportId: 'r-approved',
        branch: 'Beta (Demo)',
        weekStart: '2026-08-24',
        amount: '1250.50',
        count: 2,
      },
    ]);
  });

  it('carries asOf, seed and a sha256 digest', () => {
    expect(expected.asOf).toBe('2026-10-31');
    expect(expected.seed).toBe(7);
    expect(expected.dataDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses malformed amounts and collections of unknown reports', () => {
    const bad = structuredClone(mini);
    bad.collections[0].amount = '100.5';
    expect(() => computeExpected(bad)).toThrow(/amount/);
    const orphan = structuredClone(mini);
    orphan.collections[0].reportId = 'nope';
    expect(() => computeExpected(orphan)).toThrow(/unknown report/);
  });
});

describe('expected values for the committed dataset', () => {
  const data = loadDataFiles(dataDir);
  const expected = computeExpected(data);
  const committed = JSON.parse(readFileSync(expectedFile, 'utf8'));
  const toMinor = (amount) => BigInt(amount.replace('.', ''));

  function assertIdentities(where, figures) {
    const sum = (...names) => names.reduce((acc, name) => acc + toMinor(figures[name].amount), 0n);
    const count = (...names) => names.reduce((acc, name) => acc + figures[name].count, 0);
    expect(toMinor(figures.collected.amount), where).toBe(
      sum('approved', 'pending_approval', 'in_progress'),
    );
    expect(figures.collected.count, where).toBe(
      count('approved', 'pending_approval', 'in_progress'),
    );
    expect(toMinor(figures.approved.amount), where).toBe(sum('routed', 'not_yet_routed'));
    expect(figures.approved.count, where).toBe(count('routed', 'not_yet_routed'));
    for (const name of MONEY_KPIS)
      expect(figures[name].amount, `${where} ${name}`).toMatch(CANONICAL);
  }

  it('matches db/seed/expected.json', () => {
    expect(committed).toEqual(expected);
  });

  it('holds the identities overall, per branch and per month', () => {
    assertIdentities('overall', expected.kpis);
    for (const [name, figures] of Object.entries(expected.byBranch))
      assertIdentities(name, figures);
    for (const [month, figures] of Object.entries(expected.byMonth))
      assertIdentities(month, figures);
  });

  it('adds branches and months up to the overall figures', () => {
    for (const name of MONEY_KPIS) {
      for (const groups of [expected.byBranch, expected.byMonth]) {
        const parts = Object.values(groups);
        const total = parts.reduce((acc, g) => acc + toMinor(g[name].amount), 0n);
        expect(total, name).toBe(toMinor(expected.kpis[name].amount));
        expect(
          parts.reduce((acc, g) => acc + g[name].count, 0),
          name,
        ).toBe(expected.kpis[name].count);
      }
    }
  });

  it('accounts for every collection and report', () => {
    expect(expected.kpis.collected.count + expected.voided.count).toBe(data.collections.length);
    const reports = Object.values(expected.reportsByStatus).reduce((a, b) => a + b, 0);
    expect(reports).toBe(data.reports.length);
    expect(expected.kpis.reports_awaiting_review).toBe(expected.reportsByStatus.submitted);
    const approvedTotal = expected.approvedReports.reduce((acc, r) => acc + toMinor(r.amount), 0n);
    expect(approvedTotal).toBe(toMinor(expected.kpis.approved.amount));
  });

  it('sorts branches by name, months ascending and approved reports by branch then week', () => {
    const branchNames = Object.keys(expected.byBranch);
    expect(branchNames).toEqual([...branchNames].sort());
    expect(branchNames).toHaveLength(data.branches.length);
    const months = Object.keys(expected.byMonth);
    expect(months).toEqual([...months].sort());
    const order = expected.approvedReports.map((r) => `${r.branch}|${r.weekStart}`);
    expect(order).toEqual([...order].sort());
  });

  it('records the sha256 of the data files concatenated in manifest order', () => {
    const manifest = JSON.parse(readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));
    const hash = createHash('sha256');
    for (const file of manifest.files) {
      hash.update(readFileSync(path.join(dataDir, file), 'utf8').replace(/\r\n/g, '\n'));
    }
    expect(expected.dataDigest).toBe(hash.digest('hex'));
  });
});

describe('independence', () => {
  const source = readFileSync(script, 'utf8');

  it('imports only node: built-ins', () => {
    const specifiers = [...source.matchAll(/(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier).toMatch(/^node:/);
    expect(source).not.toMatch(/src\//);
    expect(source).not.toMatch(/generate\.mjs/);
    expect(source).not.toMatch(/\bpg\b/);
  });

  it('never parses or formats money as a float', () => {
    expect(source).not.toMatch(/parseFloat/);
    expect(source).not.toMatch(/toFixed/);
    expect(source).not.toMatch(/Number\(/);
  });
});

describe('expected.mjs CLI', () => {
  it('passes --check on the committed files', () => {
    expect(run('--check')).toBe(0);
  });

  it('fails --check after a data file is altered', () => {
    const copy = path.join(tmp, 'data');
    cpSync(dataDir, copy, { recursive: true });
    expect(run('--check', '--data-dir', copy)).toBe(0);
    const file = path.join(copy, 'collections.json');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace(/"amount": "(\d+)\.(\d{2})"/, '"amount": "1$1.$2"'));
    expect(run('--check', '--data-dir', copy)).toBe(1);
  });

  it('fails --check when the expected file is missing', () => {
    expect(run('--check', '--out', path.join(tmp, 'missing.json'))).toBe(1);
  });

  it('writes the expected file to --out', () => {
    const out = path.join(tmp, 'expected.json');
    expect(run('--out', out)).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(
      readFileSync(expectedFile, 'utf8').replace(/\r\n/g, '\n'),
    );
  });
});
