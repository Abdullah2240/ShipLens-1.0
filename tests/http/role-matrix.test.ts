import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sessionCookieName } from '@/modules/auth/cookie';
import { hashToken } from '@/modules/auth/session';
import { ROLES } from '@/platform/authz/roles';
import { closePool } from '@/platform/db';
import { closeTestPool, seedUser, testPool } from '../support/db';
import { createSessionCookie } from '../support/session';
import {
  grantFor,
  isMutation,
  loadHandler,
  loadRegistry,
  routeFileExists,
  type Handler,
} from './registry';
import type { EndpointSpec, World } from './registry/types';
import { buildWorld, callEndpoint, dbFingerprint } from './support/world';

// Publish and unpublish revalidate cached public pages; outside a Next request there is no
// cache to revalidate.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// TEST-02: for every registered endpoint and every role, the expected outcome is computed
// from PERMISSIONS only. Each endpoint gets a fresh world, so an earlier mutation cannot
// turn a 403 into something else.

const db = testPool();
const registry = loadRegistry();
const present = registry.filter(routeFileExists);
const missing = registry.filter((s) => !routeFileExists(s));
const SETUP_TIMEOUT = 120_000;
const ALLOWED_MUTATION_STATUSES = [200, 201, 204, 409, 422];
let generatedRoleCases = 0;

afterAll(async () => {
  await closePool();
  await closeTestPool();
});

const title = (s: EndpointSpec) => `${s.method} /api/v1/${s.route} [${s.action}] (${s.id})`;

async function errorCode(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code?: string } }).error?.code;
}

describe('role x endpoint matrix', () => {
  for (const spec of registry) {
    describe(title(spec), () => {
      if (!routeFileExists(spec)) {
        for (const role of ROLES) it.skip(`${role}: route file not built yet`, () => {});
        return;
      }

      let w: World;
      let handler: Handler;
      const succeeded: string[] = [];
      beforeAll(async () => {
        handler = await loadHandler(spec);
        w = await buildWorld(db);
      }, SETUP_TIMEOUT);

      for (const role of ROLES) {
        generatedRoleCases += 1;
        const grant = grantFor(spec.action, role);
        if (grant === undefined) {
          it(`${role}: denied, exactly 403 forbidden${isMutation(spec) ? ', nothing written' : ''}`, async () => {
            const before = isMutation(spec) ? await dbFingerprint(db) : null;
            const res = await callEndpoint(handler, spec, w, { cookie: w.users[role].cookie });
            expect(res.status).toBe(403);
            expect(await errorCode(res)).toBe('forbidden');
            if (before) expect(await dbFingerprint(db)).toEqual(before);
          });
          continue;
        }
        it(`${role}: allowed (${grant}), never 401 or 403`, async () => {
          const res = await callEndpoint(handler, spec, w, { cookie: w.users[role].cookie });
          expect([401, 403]).not.toContain(res.status);
          if (spec.method === 'GET') {
            // A read of an own-branch or all-scope record in a fresh world must succeed.
            expect(res.status).toBe(200);
          } else {
            // State may have moved on after an earlier allowed role; the record still exists
            // and is in scope, so 404 would mean the role was wrongly scoped out.
            expect(ALLOWED_MUTATION_STATUSES).toContain(res.status);
          }
          if (res.status >= 200 && res.status < 300) succeeded.push(role);
        });
      }

      if (isMutation(spec) && ROLES.some((r) => grantFor(spec.action, r) !== undefined)) {
        it('succeeds (2xx) for at least one allowed role, so the allowed cases are not vacuous', () => {
          expect(succeeded.length).toBeGreaterThan(0);
        });
      }
    });
  }
});

describe('session and origin checks', () => {
  let w: World;
  const handlers = new Map<string, Handler>();
  const badCookies: Record<string, string> = {};

  beforeAll(async () => {
    for (const spec of present) handlers.set(spec.id, await loadHandler(spec));
    w = await buildWorld(db);
    const name = sessionCookieName(false);
    badCookies.garbage = `${name}=not-a-real-session-token`;
    badCookies.empty = `${name}=`;
    badCookies.expired = await createSessionCookie(db, w.users.super_admin.id, { ttlMinutes: -5 });
    badCookies.revoked = await createSessionCookie(db, w.users.super_admin.id);
    await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [
      hashToken(badCookies.revoked.slice(badCookies.revoked.indexOf('=') + 1)),
    ]);
    const inactive = await seedUser(db, { role: 'super_admin', email: 'inactive@matrix.test' });
    badCookies.inactive_user = await createSessionCookie(db, inactive.id);
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [inactive.id]);
  }, SETUP_TIMEOUT);

  for (const spec of missing) it.skip(`${title(spec)}: route file not built yet`, () => {});

  for (const spec of present.filter((s) => s.action !== 'public')) {
    it(`${title(spec)}: no session or an unusable session is 401`, async () => {
      const handler = handlers.get(spec.id)!;
      const before = isMutation(spec) ? await dbFingerprint(db) : null;
      const none = await callEndpoint(handler, spec, w, {});
      expect(none.status).toBe(401);
      expect(await errorCode(none)).toBe('unauthenticated');
      for (const [kind, cookie] of Object.entries(badCookies)) {
        const res = await callEndpoint(handler, spec, w, { cookie });
        expect(res.status, kind).toBe(401);
      }
      if (before) expect(await dbFingerprint(db)).toEqual(before);
    });
  }

  for (const spec of present.filter((s) => s.action === 'public')) {
    it(`${title(spec)}: public, answers without a session`, async () => {
      const res = await callEndpoint(handlers.get(spec.id)!, spec, w, {});
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(res.status).toBeLessThan(300);
    });
  }

  for (const spec of present.filter(isMutation)) {
    const allowed = ROLES.find((r) => grantFor(spec.action, r) !== undefined);
    it(`${title(spec)}: missing or foreign Origin is 403 for an allowed caller, nothing written`, async () => {
      const handler = handlers.get(spec.id)!;
      const cookie = spec.action === 'public' || !allowed ? undefined : w.users[allowed].cookie;
      const before = await dbFingerprint(db);
      for (const origin of [null, 'https://attacker.example', 'null']) {
        const res = await callEndpoint(handler, spec, w, { cookie, origin });
        expect(res.status, `origin ${origin}`).toBe(403);
        expect(await errorCode(res)).toBe('forbidden');
      }
      expect(await dbFingerprint(db)).toEqual(before);
    });
  }

  it('denied roles get 403 before the body is read (an invalid body still 403s)', async () => {
    let checked = 0;
    for (const spec of present.filter(isMutation)) {
      const denied = ROLES.find((r) => grantFor(spec.action, r) === undefined);
      if (!denied) continue;
      const res = await callEndpoint(handlers.get(spec.id)!, spec, w, {
        cookie: w.users[denied].cookie,
        body: { unexpected: 'field', amount: 'not money' },
      });
      expect(res.status, spec.id).toBe(403);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('matrix size', () => {
  it('generates at least one case per registered endpoint and role', ({ annotate }) => {
    const expected = present.length * ROLES.length;
    console.info(
      `role matrix: ${generatedRoleCases} role cases for ${present.length} endpoints x ${ROLES.length} roles; ${missing.length} endpoints skipped (route file missing)`,
    );
    void annotate(`${generatedRoleCases} role cases, ${missing.length} skipped endpoints`);
    expect(present.length).toBeGreaterThan(0);
    expect(generatedRoleCases).toBeGreaterThanOrEqual(expected);
  });
});
