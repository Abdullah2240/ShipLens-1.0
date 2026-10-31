// Reconciliation guard for the interim route adapter. It lists every API route that still
// imports route() from interim-route.ts, and holds the people, applications and content
// routes to that one file so moving them to the real route() wrapper (plan 01-11) is a
// mechanical one-line change per file. Delete this guard together with the interim
// adapter (interim-route.ts and interim-server.ts) once those routes move to the real
// route(): it must never outlive the adapter.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = path.resolve(import.meta.dirname, '../../app/api/v1');
const INTERIM = '@/platform/http/interim-route';
const REAL = '@/platform/http/route';
const SOURCES = [INTERIM, REAL] as const;

// Folders whose routes must use the interim adapter until the move.
const INTERIM_ONLY = ['public/applications', 'applications', 'members', 'teams', 'content'];
// Folders outside the scan (session endpoints and health checks are not on the adapter).
const EXCLUDED = ['auth', 'health'];

interface RouteFile {
  /** Path relative to src/app/api/v1, with forward slashes. */
  rel: string;
  text: string;
}

function routeFiles(dir: string): RouteFile[] {
  const found: RouteFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (entry.name === 'route.ts') {
      const rel = path.relative(API_ROOT, full).split(path.sep).join('/');
      found.push({ rel, text: readFileSync(full, 'utf8').replace(/\r\n/g, '\n') });
    }
  }
  return found;
}

const inFolder = (rel: string, folder: string) => rel.startsWith(`${folder}/`);

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

const files = routeFiles(API_ROOT).filter(
  (file) => !EXCLUDED.some((folder) => inFolder(file.rel, folder)),
);
const callers = files.filter((file) => /\broute\(/.test(file.text));

describe('interim route adapter usage', () => {
  it('finds the API routes to check', () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  it.each(callers.map((file) => [file.rel, file] as const))(
    '%s imports route() from exactly one of the two modules',
    (_rel, file) => {
      const sources = routeSources(file.text);
      expect(sources).toHaveLength(1);
      expect(SOURCES).toContain(sources[0]);
    },
  );

  it('keeps every people, applications and content route on the interim adapter', () => {
    const held = callers.filter((file) =>
      INTERIM_ONLY.some((folder) => inFolder(file.rel, folder)),
    );
    expect(held.length).toBeGreaterThan(0);
    const offenders = held
      .filter((file) => routeSources(file.text).join() !== INTERIM)
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('lists the routes still on the interim adapter', () => {
    const interim = callers
      .filter((file) => routeSources(file.text).includes(INTERIM))
      .map((file) => file.rel)
      .sort();
    console.info(`Routes on ${INTERIM} (${interim.length}):\n${interim.join('\n')}`);
    expect(interim.length).toBeGreaterThan(0);
  });
});
