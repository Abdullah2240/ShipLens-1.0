// Message gate used by `npm run i18n:check` and CI: locale parity first, then
// untranslated Urdu values and hard-coded JSX text.
// Usage: node scripts/check-i18n.mjs [messagesDir] [srcDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUntranslated } from './lib/i18n-coverage.mjs';
import { inspectMessages } from './lib/i18n-parity.mjs';
import { scanJsxText, shouldScanFile } from './lib/jsx-text-scan.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..');
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, 'messages');
const srcRoot = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repoRoot, 'src');

const { problems, keys, files } = inspectMessages(root);

if (problems.length > 0) {
  for (const problem of problems) console.log(problem.message);
  console.error(`i18n parity failed (${problems.length} problems)`);
  process.exit(1);
}

console.log(`i18n parity ok (${keys} keys, ${files} files)`);

const allowlist = JSON.parse(
  fs.readFileSync(path.join(scriptsDir, 'lib', 'i18n-allowlist.json'), 'utf8'),
);

function listTsx(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsx(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(repoRoot, file).replace(/\\/g, '/');
const sources = listTsx(srcRoot)
  .map((file) => ({ file: relative(file), abs: file }))
  .filter(({ file }) => shouldScanFile(file))
  .map(({ file, abs }) => ({ file, text: fs.readFileSync(abs, 'utf8') }));

const untranslated = findUntranslated(root, { allowlist });
const hardCoded = scanJsxText(sources, { allowlist });

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

for (const [namespace, items] of groupBy(untranslated, (f) => f.namespace)) {
  console.log(`untranslated: ${namespace} (${items.length})`);
  for (const f of items)
    console.log(`  ${namespace}.${f.key} [${f.reason}] ${JSON.stringify(f.ur)}`);
}
for (const [file, items] of groupBy(hardCoded, (f) => f.file)) {
  console.log(`hard-coded text: ${file} (${items.length})`);
  for (const f of items) console.log(`  ${f.line} [${f.kind}] ${JSON.stringify(f.text)}`);
}

if (untranslated.length + hardCoded.length > 0) {
  console.error(
    `i18n coverage failed (${untranslated.length} untranslated values, ${hardCoded.length} hard-coded texts)`,
  );
  process.exit(1);
}

console.log(`i18n coverage ok (${sources.length} files scanned)`);
