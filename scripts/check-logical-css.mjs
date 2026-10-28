import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPhysicalDirection } from './lib/logical-css.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_EXT = new Set(['.ts', '.tsx', '.css']);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SCAN_EXT.has(path.extname(entry.name)) && !/\.test\./.test(entry.name)) yield full;
  }
}

let count = 0;
for (const file of walk(path.join(root, 'src'))) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  for (const f of findPhysicalDirection(readFileSync(file, 'utf8'), rel)) {
    console.log(`${rel}:${f.line}:${f.column} ${f.match} -> ${f.hint}`);
    count += 1;
  }
}

if (count > 0) {
  console.error(`logical CSS check: ${count} physical-direction use(s) found`);
  process.exit(1);
}
console.log('logical CSS check: ok');
