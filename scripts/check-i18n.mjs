// Message parity gate used by `npm run i18n:check` and CI.
// Usage: node scripts/check-i18n.mjs [messagesDir]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectMessages } from './lib/i18n-parity.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'messages');
const root = process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot;

const { problems, keys, files } = inspectMessages(root);

if (problems.length > 0) {
  for (const problem of problems) console.log(problem.message);
  console.error(`i18n parity failed (${problems.length} problems)`);
  process.exit(1);
}

console.log(`i18n parity ok (${keys} keys, ${files} files)`);
