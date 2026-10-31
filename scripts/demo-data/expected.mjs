// Independent oracle for the demo dataset: reads db/seed/data/*.json only and computes the
// expected dashboard values with its own BigInt arithmetic. It never imports app code,
// the generator, or a database driver, so a bug there cannot hide in the oracle.
// Usage: node scripts/demo-data/expected.mjs [--check] [--data-dir <dir>] [--out <file>]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_DATA_DIR = path.join(root, 'db', 'seed', 'data');
const DEFAULT_OUT = path.join(root, 'db', 'seed', 'expected.json');

const MONEY_KPIS = [
  'collected',
  'approved',
  'pending_approval',
  'in_progress',
  'not_yet_routed',
  'routed',
];
const REPORT_STATUSES = ['draft', 'submitted', 'returned', 'approved'];

function toMinor(amount) {
  const match = typeof amount === 'string' ? /^(\d+)\.(\d{2})$/.exec(amount) : null;
  if (!match) throw new Error(`invalid amount ${JSON.stringify(amount)}`);
  return BigInt(match[1]) * 100n + BigInt(match[2]);
}

function fromMinor(minor) {
  if (typeof minor !== 'bigint' || minor < 0n) throw new Error('minor units must be a BigInt >= 0');
  return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}

// File text with line endings normalised, so a CRLF checkout hashes like the committed LF bytes.
function readText(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function digestOf(texts) {
  const hash = createHash('sha256');
  for (const text of texts) hash.update(text);
  return hash.digest('hex');
}

export function loadDataFiles(dir = DEFAULT_DATA_DIR) {
  const manifest = JSON.parse(readText(path.join(dir, 'manifest.json')));
  const data = { manifest };
  const texts = [];
  for (const file of manifest.files) {
    const text = readText(path.join(dir, file));
    texts.push(text);
    data[file.replace(/\.json$/, '')] = JSON.parse(text);
  }
  data.dataDigest = digestOf(texts);
  return data;
}

function emptyBucket() {
  return { amount: 0n, count: 0 };
}

function emptyFigures() {
  return Object.fromEntries(MONEY_KPIS.map((name) => [name, emptyBucket()]));
}

function add(bucket, minor) {
  bucket.amount += minor;
  bucket.count += 1;
}

function render(bucket) {
  return { amount: fromMinor(bucket.amount), count: bucket.count };
}

function renderFigures(figures) {
  return Object.fromEntries(MONEY_KPIS.map((name) => [name, render(figures[name])]));
}

function compareText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function computeExpected(data) {
  const branchByKey = new Map(data.branches.map((b) => [b.key, b]));
  const reportById = new Map(data.reports.map((r) => [r.id, r]));

  const overall = emptyFigures();
  const voided = emptyBucket();
  const byBranch = new Map(data.branches.map((b) => [b.name, emptyFigures()]));
  const byMonth = new Map();
  const approvedByReport = new Map();

  for (const c of data.collections) {
    const minor = toMinor(c.amount);
    const report = reportById.get(c.reportId);
    if (!report) throw new Error(`collection ${c.id}: unknown report ${c.reportId}`);
    const branch = branchByKey.get(report.branchKey);
    if (!branch) throw new Error(`report ${report.id}: unknown branch ${report.branchKey}`);
    if (c.status === 'voided') {
      add(voided, minor);
      continue;
    }
    if (c.status !== 'active') throw new Error(`collection ${c.id}: unknown status ${c.status}`);

    // collected_on is already a PKT business date, so its first 7 characters are the PKT month.
    const month = c.collectedOn.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, emptyFigures());
    const targets = [overall, byBranch.get(branch.name), byMonth.get(month)];

    const names = ['collected'];
    if (report.status === 'approved') {
      names.push('approved', c.routedAt ? 'routed' : 'not_yet_routed');
      if (!approvedByReport.has(report.id)) approvedByReport.set(report.id, emptyBucket());
      add(approvedByReport.get(report.id), minor);
    } else if (report.status === 'submitted') {
      names.push('pending_approval');
    } else if (report.status === 'draft' || report.status === 'returned') {
      names.push('in_progress');
    } else {
      throw new Error(`report ${report.id}: unknown status ${report.status}`);
    }
    for (const figures of targets) for (const name of names) add(figures[name], minor);
  }

  const reportsByStatus = Object.fromEntries(REPORT_STATUSES.map((s) => [s, 0]));
  for (const r of data.reports) {
    if (!(r.status in reportsByStatus))
      throw new Error(`report ${r.id}: unknown status ${r.status}`);
    reportsByStatus[r.status] += 1;
  }

  const approvedReports = data.reports
    .filter((r) => r.status === 'approved')
    .map((r) => {
      const bucket = approvedByReport.get(r.id) ?? emptyBucket();
      return {
        reportId: r.id,
        branch: branchByKey.get(r.branchKey).name,
        weekStart: r.weekStart,
        amount: fromMinor(bucket.amount),
        count: bucket.count,
      };
    })
    .sort((a, b) => compareText(a.branch, b.branch) || compareText(a.weekStart, b.weekStart));

  const dataDigest =
    typeof data.dataDigest === 'string'
      ? data.dataDigest
      : digestOf(
          data.manifest.files.map(
            (file) => `${JSON.stringify(data[file.replace(/\.json$/, '')], null, 2)}\n`,
          ),
        );

  const kpis = renderFigures(overall);
  kpis.active_branches = data.branches.filter((b) => b.status === 'active').length;
  kpis.reports_awaiting_review = reportsByStatus.submitted;

  return {
    asOf: data.manifest.asOf,
    seed: data.manifest.seed,
    dataDigest,
    kpis,
    voided: render(voided),
    reportsByStatus,
    byBranch: Object.fromEntries(
      [...byBranch.keys()]
        .sort(compareText)
        .map((name) => [name, renderFigures(byBranch.get(name))]),
    ),
    byMonth: Object.fromEntries(
      [...byMonth.keys()]
        .sort(compareText)
        .map((month) => [month, renderFigures(byMonth.get(month))]),
    ),
    approvedReports,
  };
}

// Identity checks on the rendered output (string amounts parsed back to BigInt).
function identityProblems(expected) {
  const problems = [];
  const check = (where, f) => {
    const sum = (...names) => names.reduce((acc, n) => acc + toMinor(f[n].amount), 0n);
    const count = (...names) => names.reduce((acc, n) => acc + f[n].count, 0);
    if (
      toMinor(f.collected.amount) !== sum('approved', 'pending_approval', 'in_progress') ||
      f.collected.count !== count('approved', 'pending_approval', 'in_progress')
    ) {
      problems.push(`${where}: collected != approved + pending_approval + in_progress`);
    }
    if (
      toMinor(f.approved.amount) !== sum('routed', 'not_yet_routed') ||
      f.approved.count !== count('routed', 'not_yet_routed')
    ) {
      problems.push(`${where}: approved != routed + not_yet_routed`);
    }
  };
  check('overall', expected.kpis);
  for (const [name, f] of Object.entries(expected.byBranch)) check(name, f);
  for (const [month, f] of Object.entries(expected.byMonth)) check(month, f);
  return problems;
}

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : fallback;
}

function main(argv) {
  const check = argv.includes('--check');
  const dataDir = option(argv, '--data-dir', DEFAULT_DATA_DIR);
  const out = option(argv, '--out', DEFAULT_OUT);

  const expected = computeExpected(loadDataFiles(dataDir));
  const problems = identityProblems(expected);
  if (problems.length > 0) {
    console.error(`Expected values break the KPI identities:\n${problems.join('\n')}`);
    return 1;
  }
  const content = `${JSON.stringify(expected, null, 2)}\n`;

  if (check) {
    if (!existsSync(out) || readText(out) !== content) {
      console.error(`${out} differs from the values computed from ${dataDir}.`);
      console.error('Run: node scripts/demo-data/expected.mjs');
      return 1;
    }
    console.log('Expected values are up to date.');
    return 0;
  }

  writeFileSync(out, content);
  console.log(`Wrote ${out}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
