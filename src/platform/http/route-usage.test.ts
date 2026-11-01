// Permanent guard for the one HTTP contract: every mutating /api/v1 handler is built with
// route() from @/platform/http/route, so each one passes the Origin check, session
// resolution, Zod parsing and error mapping of the same wrapper. It also keeps the retired
// interim adapters from coming back.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(import.meta.dirname, '../../..');
const API_ROOT = path.join(REPO, 'src/app/api/v1');
const SELF = path.resolve(import.meta.filename);
const REAL = '@/platform/http/route';
// Built from parts so this file does not match its own scan.
const RETIRED = ['interim-route', 'interim-server'].map((name) => `platform/http/${name}`);
const SCANNED_ROOTS = ['src', 'tests', 'scripts'];
const SKIPPED_DIRS = new Set(['node_modules', '.next', 'test-results', 'playwright-report']);
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|json|md)$/;
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

const rel = (file: string) => path.relative(REPO, file).split(path.sep).join('/');
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function walk(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) found.push(...walk(path.join(dir, entry.name), keep));
    } else if (keep(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/** Modules from which this text imports a `route` binding. */
function routeSources(text: string): string[] {
  const sources: string[] = [];
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const names = match[1]!.split(',').map((name) => name.trim().split(/\s+as\s+/)[0]);
    if (names.includes('route')) sources.push(match[2]!);
  }
  return sources;
}

/** Mutating method names this route module exports, in any form. */
function mutatingExports(text: string): string[] {
  const names = new Set<string>();
  const declared = /export\s+(?:async\s+)?(?:function\s*\*?|const|let|var)\s*([A-Z]+)\b/g;
  for (const match of text.matchAll(declared)) names.add(match[1]!);
  for (const match of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1]!.split(',')) {
      const exported = part
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (exported) names.add(exported);
    }
  }
  return MUTATING.filter((method) => names.has(method));
}

/** Why this route file breaks the one-wrapper rule, or an empty list. */
function routeProblems(text: string): string[] {
  const methods = mutatingExports(text);
  if (methods.length === 0) return [];
  const problems: string[] = [];
  for (const method of methods) {
    if (!new RegExp(`export\\s+const\\s+${method}\\s*=\\s*route\\(`).test(text)) {
      problems.push(`${method} is not exported as \`export const ${method} = route(\``);
    }
  }
  const sources = routeSources(text);
  if (sources.length !== 1 || sources[0] !== REAL) {
    problems.push(`route is imported from [${sources.join(', ')}], expected ${REAL}`);
  }
  return problems;
}

describe('route() usage', () => {
  it('no source, test or script file refers to the retired interim adapters', () => {
    const offenders = SCANNED_ROOTS.flatMap((root) =>
      walk(path.join(REPO, root), (name) => TEXT_FILE.test(name)),
    )
      .filter((file) => path.resolve(file) !== SELF)
      .filter((file) => {
        const text = read(file);
        return RETIRED.some((needle) => text.includes(needle));
      })
      .map(rel)
      .sort();
    expect(
      offenders,
      `Files still referring to the interim adapters:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the interim adapter files are gone', () => {
    const present = RETIRED.map((needle) => `src/${needle}.ts`).filter((file) =>
      existsSync(path.join(REPO, file)),
    );
    expect(present).toEqual([]);
  });

  const routeFiles = walk(API_ROOT, (name) => name === 'route.ts');

  it('finds mutating API routes to check', () => {
    expect(
      routeFiles.filter((file) => mutatingExports(read(file)).length > 0).length,
    ).toBeGreaterThan(0);
  });

  it(`builds every POST, PUT, PATCH and DELETE under src/app/api/v1 with route() from ${REAL}`, () => {
    const offenders = routeFiles
      .map((file) => ({ file: rel(file), problems: routeProblems(read(file)) }))
      .filter((entry) => entry.problems.length > 0)
      .map((entry) => `${entry.file}: ${entry.problems.join('; ')}`)
      .sort();
    expect(offenders, `Mutating routes outside the one wrapper:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  describe('rule checks', () => {
    const real = `import { route } from '${REAL}';\n`;

    it('accepts a mutation built with the real route()', () => {
      expect(routeProblems(`${real}export const POST = route({ auth: 'public' }, h);`)).toEqual([]);
    });

    it('ignores GET-only modules', () => {
      expect(routeProblems('export async function GET() { return Response.json({}); }')).toEqual(
        [],
      );
    });

    it.each([
      ['export async function', `${real}export async function POST(req: Request) {}`],
      ['export function', `${real}export function DELETE(req: Request) {}`],
      ['a const not built with route()', `${real}export const PATCH = async () => new Response();`],
      [
        'a re-export',
        `${real}const handler = route({ auth: 'public' }, h);\nexport { handler as PUT };`,
      ],
    ])('rejects %s', (_label, text) => {
      expect(routeProblems(text).length).toBeGreaterThan(0);
    });

    it('rejects route() imported from any other module', () => {
      const text = `import { route } from '@/${RETIRED[0]}';\nexport const POST = route({ auth: 'public' }, h);`;
      expect(routeProblems(text)).toEqual([
        `route is imported from [@/${RETIRED[0]}], expected ${REAL}`,
      ]);
    });
  });
});
