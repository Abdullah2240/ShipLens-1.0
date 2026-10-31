import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/platform/authz/permissions';
import { closePool } from '@/platform/db';
import { closeTestPool, testPool } from '../support/db';
import {
  API_ROOT,
  loadHandler,
  loadRegistry,
  registryFiles,
  routeFileExists,
  routeFilePath,
} from './registry';
import type { EndpointSpec } from './registry/types';
import { buildWorld } from './support/world';

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;
const EXPORT_PATTERN = new RegExp(
  `export\\s+(?:const\\s+(${METHODS.join('|')})\\s*=|(?:async\\s+)?function\\s+(${METHODS.join('|')})\\b)`,
  'g',
);

interface RouteExport {
  route: string;
  method: string;
  /** The action the route declares: its route({ action }), else 'public' or 'session' from auth. */
  action: string | null;
}

function walkRoutes(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return walkRoutes(
        path.join(dir, entry.name),
        prefix ? `${prefix}/${entry.name}` : entry.name,
      );
    }
    return entry.name === 'route.ts' ? [prefix] : [];
  });
}

/** Exported HTTP methods of a route file and the action each one declares. */
function readExports(route: string): RouteExport[] {
  const source = readFileSync(path.join(API_ROOT, route, 'route.ts'), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  const matches = [...source.matchAll(EXPORT_PATTERN)];
  return matches.map((match, i) => {
    const segment = source.slice(match.index, matches[i + 1]?.index ?? source.length);
    const options = /route\(\s*\{([^}]*)\}/.exec(segment)?.[1] ?? '';
    const action = /action:\s*'([^']+)'/.exec(options)?.[1];
    const auth = /auth:\s*'(public|session)'/.exec(options)?.[1];
    return { route, method: (match[1] ?? match[2])!, action: action ?? auth ?? null };
  });
}

const registry = loadRegistry();
const key = (s: { route: string; method: string }) => `${s.method} ${s.route}`;
const routes = walkRoutes(API_ROOT).sort();
const exported = routes.flatMap(readExports);
const db = testPool();

afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('endpoint registry', () => {
  it('loads every *.registry.ts file in the registry folder', () => {
    const files = registryFiles().map((f) => path.basename(f));
    expect(files).toEqual(expect.arrayContaining(['owner.registry.ts', 'saniya.registry.ts']));
    expect(registry.length).toBeGreaterThan(0);
  });

  it('finds the API route files on disk', () => {
    expect(routes.length).toBeGreaterThan(0);
    expect(exported.length).toBeGreaterThanOrEqual(routes.length);
  });

  it('registers every exported (route, method) pair under src/app/api/v1', () => {
    const registered = new Set(registry.map(key));
    const unregistered = exported.map(key).filter((k) => !registered.has(k));
    expect(unregistered, `unregistered endpoints:\n${unregistered.join('\n')}`).toEqual([]);
  });

  it('gives every entry a unique id and a unique (route, method)', () => {
    const ids = registry.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pairs = registry.map(key);
    const dupes = pairs.filter((p, i) => pairs.indexOf(p) !== i);
    expect(dupes, `registered twice:\n${dupes.join('\n')}`).toEqual([]);
  });

  it("uses 'public', 'session' or a permission-table action on every entry", () => {
    const valid = new Set<string>(['public', 'session', ...Object.keys(PERMISSIONS)]);
    const bad = registry.filter((s) => !valid.has(s.action)).map((s) => `${s.id}: ${s.action}`);
    expect(bad, `unknown actions:\n${bad.join('\n')}`).toEqual([]);
  });

  it('registers each existing route with the action its route file declares', () => {
    const declared = new Map(exported.map((e) => [key(e), e.action]));
    const mismatched = registry
      .filter(routeFileExists)
      .filter((s) => declared.get(key(s)) !== s.action)
      .map(
        (s) => `${s.id}: registry '${s.action}', route file '${declared.get(key(s)) ?? 'none'}'`,
      );
    expect(mismatched, `action drift:\n${mismatched.join('\n')}`).toEqual([]);
  });

  it('has no entry for a method its existing route file does not export', () => {
    const onDisk = new Set(exported.map(key));
    const stale = registry
      .filter(routeFileExists)
      .filter((s) => !onDisk.has(key(s)))
      .map((s) => `${s.id}: ${key(s)}`);
    expect(stale, `stale entries:\n${stale.join('\n')}`).toEqual([]);
  });

  it('resolves a handler for an entry through the lazy route loader', async () => {
    const spec = registry.find((s) => s.id === 'auth.me' && routeFileExists(s));
    if (!spec) return;
    expect(typeof (await loadHandler(spec))).toBe('function');
  }, 120_000);

  it('gives every route param a value through record or params', () => {
    const bad = registry
      .filter((s: EndpointSpec) => /\[[^\]]+\]/.test(s.route) && !s.record && !s.params)
      .map((s) => s.id);
    expect(bad).toEqual([]);
  });

  it('lists the entries skipped because their route file does not exist yet', ({ annotate }) => {
    const skipped = registry.filter((s) => !routeFileExists(s));
    const lines = skipped.map((s) => `${s.id}: ${key(s)} (${routeFilePath(s)})`);
    if (skipped.length > 0) {
      console.table(skipped.map((s) => ({ id: s.id, method: s.method, route: s.route })));
      void annotate(`skipped (route file missing):\n${lines.join('\n')}`);
    }
    // Skips are reported, never counted as passes: every other suite marks them it.skip.
    // The existence check must agree with the filesystem walk.
    expect(skipped.filter((s) => routes.includes(s.route)).map((s) => s.id)).toEqual([]);
    expect(registry.filter(routeFileExists).every((s) => routes.includes(s.route))).toBe(true);
  });
});

describe('world fixture', () => {
  it('names every record the registry refers to', async () => {
    const w = await buildWorld(db);
    const missing = registry
      .filter((s) => s.record && !w.records[s.record])
      .map((s) => `${s.id}: ${s.record}`);
    expect(missing).toEqual([]);
    for (const [name, ids] of Object.entries(w.records)) {
      expect(ids.A, `${name}.A`).toMatch(/^[0-9a-f-]{36}$/);
      expect(ids.B, `${name}.B`).toMatch(/^[0-9a-f-]{36}$/);
    }
    for (const user of Object.values(w.users)) expect(user.cookie).toContain('=');
  });

  it('builds exactly one world when called twice', async () => {
    await buildWorld(db);
    const w = await buildWorld(db);
    const count = async (table: string) =>
      (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
    expect(await count('branches')).toBe(2);
    expect(await count('users')).toBe(8);
    expect(await count('sessions')).toBe(7);
    expect(await count('weekly_reports')).toBe(4);
    expect(await count('collections')).toBe(4);
    expect(await count('applications')).toBe(2);
    expect(await count('teams')).toBe(2);
    expect(await count('members')).toBe(2);
    expect(await count('events')).toBe(1);
    expect(await count('content_entries')).toBe(1);
    const { rows } = await db.query<{ id: string; branch_id: string | null; role: string }>(
      'SELECT id, branch_id, role FROM users',
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(w.users.branch_lead.id)?.branch_id).toBe(w.branchA);
    expect(byId.get(w.users.hr_lead.id)?.branch_id).toBe(w.branchA);
    expect(byId.get(w.users.branch_lead_b.id)?.branch_id).toBe(w.branchB);
    expect(byId.get(w.users.hr_lead_b.id)?.branch_id).toBe(w.branchB);
    expect(byId.get(w.users.super_admin.id)?.branch_id).toBeNull();
  });
});
