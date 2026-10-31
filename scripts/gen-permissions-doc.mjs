// Generates docs/permissions.md from src/platform/authz/permissions.ts.
// Usage: node scripts/gen-permissions-doc.mjs [--check] [--out <path>]
// Loads the .ts files with Node native type stripping (erasable syntax only).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const args = process.argv.slice(2);
const check = args.includes('--check');
const outIndex = args.indexOf('--out');
const outPath =
  outIndex >= 0 && args[outIndex + 1]
    ? path.resolve(args[outIndex + 1])
    : path.join(root, 'docs', 'permissions.md');

const { PERMISSIONS, PUBLIC_ENDPOINTS } = await import(
  new URL('../src/platform/authz/permissions.ts', import.meta.url).href
);
const { ROLES } = await import(new URL('../src/platform/authz/roles.ts', import.meta.url).href);

const CELL = { all: 'all', own_branch: 'own branch' };

function render() {
  const actions = Object.keys(PERMISSIONS).sort();
  const lines = [];
  lines.push('# Permission table');
  lines.push('');
  lines.push(
    'Generated from src/platform/authz/permissions.ts by `npm run permissions:doc`. Do not edit by hand.',
  );
  lines.push('');
  lines.push(`| Action | ${ROLES.join(' | ')} |`);
  lines.push(`| --- | ${ROLES.map(() => '---').join(' | ')} |`);
  for (const action of actions) {
    const cells = ROLES.map((role) => CELL[PERMISSIONS[action][role]] ?? '-');
    lines.push(`| ${action} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## Rules');
  lines.push('');
  lines.push('- 403 when the role lacks the action.');
  lines.push('- Identical 404 when a permitted role asks for a missing or out-of-scope record.');
  lines.push('- 409 for a wrong state.');
  lines.push('- 422 for invalid input.');
  lines.push('- 429 for login throttling.');
  lines.push('- Role and branch always come from the server session.');
  lines.push('');
  lines.push('## Public endpoints');
  lines.push('');
  lines.push('These need no session and are deliberately not in the table.');
  lines.push('');
  for (const endpoint of PUBLIC_ENDPOINTS) lines.push(`- ${endpoint}`);
  lines.push('');
  lines.push('## Defaults pending confirmation');
  lines.push('');
  lines.push('Default, confirm with the brief:');
  lines.push('');
  lines.push('- Lock anchor is `collected_on`, day 7 inclusive; a returned report reopens.');
  lines.push('- Finance Reviewer sees all branches.');
  lines.push('- HR Lead is branch scoped.');
  lines.push('- Finance Reviewer audit access is limited to finance entities.');
  lines.push('- Who marks collections routed: Finance Reviewer and Super Admin.');
  lines.push('');
  return lines.join('\n');
}

const generated = render();

if (check) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current !== generated) {
    console.error(
      `${path.relative(root, outPath)} is stale or missing. Run \`npm run permissions:doc\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`${path.relative(root, outPath)} is up to date.`);
} else {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  console.log(`Wrote ${path.relative(root, outPath)}`);
}
