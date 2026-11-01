// Reconciliation guard for the branches, collections and reports routes built in Phase 2.
// It holds the explicit list below to the interim route adapter so moving them to the real
// route() wrapper (plan 01-11) is a mechanical one-line change per file. Later phases add
// routes under the same folders on either module, so those are only held to importing
// route() from exactly one of the two. Delete this guard together with the interim adapter
// (interim-route.ts and interim-server.ts) once plan 01-11's route() replaces it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = path.resolve(import.meta.dirname, '../../app/api/v1');
const INTERIM = '@/platform/http/interim-route';
const REAL = '@/platform/http/route';
const OWNER_FOLDERS = ['branches', 'collections', 'reports'];

// Paths relative to src/app/api/v1, grouped by the plan that added them.
const OWNER_ROUTES = [
  // 02-19 branches
  'branches/route.ts',
  'branches/[id]/route.ts',
  'branches/[id]/status/route.ts',
  'branches/[id]/leads/route.ts',
  'branches/lead-candidates/route.ts',
  // 02-20 timelines
  'reports/[id]/timeline/route.ts',
  'collections/[id]/timeline/route.ts',
  // 02-21 collections
  'collections/route.ts',
  'collections/current-week/route.ts',
  'collections/[id]/route.ts',
  'collections/[id]/void/route.ts',
  // 02-22 reports
  'reports/route.ts',
  'reports/review-queue/route.ts',
  'reports/[id]/route.ts',
  'reports/[id]/submit/route.ts',
  'reports/[id]/return/route.ts',
  'reports/[id]/approve/route.ts',
];

const read = (rel: string) => readFileSync(path.join(API_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/** Modules from which this file imports a `route` binding. */
function routeSources(text: string): string[] {
  const sources: string[] = [];
  const imports = /import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g;
  for (const match of text.matchAll(imports)) {
    const names = match[1]!.split(',').map((name) => name.trim().split(/\s+as\s+/)[0]);
    if (names.includes('route')) sources.push(match[2]!);
  }
  return sources;
}

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (entry.name === 'route.ts') {
      found.push(path.relative(API_ROOT, full).split(path.sep).join('/'));
    }
  }
  return found;
}

const others = OWNER_FOLDERS.flatMap((folder) => routeFiles(path.join(API_ROOT, folder)))
  .filter((rel) => !OWNER_ROUTES.includes(rel))
  .sort();

describe('owner routes on the interim route adapter', () => {
  it('lists seventeen distinct owner routes', () => {
    expect(new Set(OWNER_ROUTES).size).toBe(17);
  });

  it.each(OWNER_ROUTES)('%s exists and imports route() only from the interim adapter', (rel) => {
    expect(existsSync(path.join(API_ROOT, rel))).toBe(true);
    const sources = routeSources(read(rel));
    expect(sources).toEqual([INTERIM]);
    expect(sources).not.toContain(REAL);
  });

  it('holds later routes in the same folders to exactly one of the two modules', () => {
    const offenders = others.filter((rel) => {
      const text = read(rel);
      if (!/\broute\(/.test(text)) return false;
      const sources = routeSources(text);
      return sources.length !== 1 || ![INTERIM, REAL].includes(sources[0]!);
    });
    expect(offenders).toEqual([]);
  });

  it('prints the owner routes to move with plan 01-11', () => {
    console.info(
      `Owner routes on ${INTERIM} (${OWNER_ROUTES.length}):\n${[...OWNER_ROUTES].sort().join('\n')}` +
        (others.length ? `\nOther routes in the same folders:\n${others.join('\n')}` : ''),
    );
    expect(OWNER_ROUTES.length).toBeGreaterThan(0);
  });
});
