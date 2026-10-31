import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as getFacets } from '@/app/api/v1/audit/facets/route';
import { GET as getAudit } from '@/app/api/v1/audit/route';
import type { AuditFacets, AuditPage } from '@/modules/audit-log';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { createSessionCookie } from '../support/session';

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const base = 'http://localhost:3000/api/v1/audit';
const ENDPOINTS: [string, Handler, string][] = [
  ['list', getAudit, ''],
  ['facets', getFacets, '/facets'],
];
const FINANCE_TYPES = ['collection', 'report', 'export', 'share'];
// Bulk rows per entity type: 6 types x 40 = 240 rows, more than the 200 row ceiling.
const ENTITY_TYPES = ['collection', 'report', 'export', 'share', 'member', 'application'];
const PER_TYPE = 40;

const cookies: Record<string, string> = {};

function call(handler: Handler, path: string, cookie?: string): Promise<Response> {
  return handler(new Request(`${base}${path}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({}),
  });
}

async function page(path: string, role: string): Promise<AuditPage> {
  const res = await call(getAudit, path, cookies[role]);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: AuditPage }).data;
}

beforeAll(async () => {
  await resetDb(db);
  const a = await seedBranch(db, { name: 'Alpha' });
  const users = {
    superAdmin: await seedUser(db, { role: 'super_admin' }),
    finance: await seedUser(db, { role: 'finance_reviewer' }),
    leadA: await seedUser(db, { role: 'branch_lead', branchId: a.id }),
    hrA: await seedUser(db, { role: 'hr_lead', branchId: a.id }),
    editor: await seedUser(db, { role: 'content_editor' }),
  };
  for (const [key, user] of Object.entries(users)) {
    cookies[key] = await createSessionCookie(db, user.id);
  }
  await db.query(
    `INSERT INTO audit_events
       (occurred_at, actor_id, actor_role, action, entity_type, entity_id, branch_id, after)
     SELECT timestamptz '2026-10-01T05:00:00Z' + (n * interval '1 minute'),
            $1, 'super_admin', t.type || '.update', t.type, t.type || '-' || n, $2,
            jsonb_build_object('n', n)
     FROM unnest($3::text[]) AS t(type), generate_series(1, $4::int) AS n`,
    [users.superAdmin.id, a.id, ENTITY_TYPES, PER_TYPE],
  );
});

afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('audit endpoints access (AUD-05)', () => {
  it.each(ENDPOINTS)('%s: 401 without a session', async (_name, handler, path) => {
    const res = await call(handler, path);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each(ENDPOINTS)(
    '%s: 403 for branch lead, HR lead and content editor',
    async (_name, handler, path) => {
      for (const role of ['leadA', 'hrA', 'editor']) {
        const res = await call(handler, path, cookies[role]);
        expect(res.status, role).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
    },
  );

  it.each(ENDPOINTS)(
    '%s: 200 for super admin and finance reviewer',
    async (_name, handler, path) => {
      for (const role of ['superAdmin', 'finance']) {
        const res = await call(handler, path, cookies[role]);
        expect(res.status, role).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect((await res.json()).data).toBeTruthy();
      }
    },
  );
});

describe('GET /api/v1/audit', () => {
  it('gives super admin every entity type, unrestricted', async () => {
    for (const entity of ENTITY_TYPES) {
      const data = await page(`?entity=${entity}&limit=200`, 'superAdmin');
      expect(data.restricted).toBe(false);
      expect(data.items, entity).toHaveLength(PER_TYPE);
      expect(data.items.every((i) => i.entityType === entity)).toBe(true);
    }
  });

  it('gives finance reviewer finance entity types only, restricted', async () => {
    const data = await page('?limit=200', 'finance');
    expect(data.restricted).toBe(true);
    expect(data.items).toHaveLength(FINANCE_TYPES.length * PER_TYPE);
    expect(data.items.every((i) => FINANCE_TYPES.includes(i.entityType))).toBe(true);
    expect(data.nextBefore).toBeNull();
    const member = await page('?entity=member', 'finance');
    expect(member.items).toEqual([]);
  });

  it('returns the next page for ?before=<nextBefore>', async () => {
    const first = await page('?limit=25', 'superAdmin');
    expect(first.items).toHaveLength(25);
    expect(first.nextBefore).toBe(first.items[24]!.id);
    const second = await page(`?limit=25&before=${first.nextBefore}`, 'superAdmin');
    expect(second.items).toHaveLength(25);
    expect(BigInt(second.items[0]!.id)).toBeLessThan(BigInt(first.items[24]!.id));
    const seen = new Set([...first.items, ...second.items].map((i) => i.id));
    expect(seen.size).toBe(50);
  });

  it('clamps ?limit=9999 to 200', async () => {
    const data = await page('?limit=9999', 'superAdmin');
    expect(data.items).toHaveLength(200);
    expect(data.nextBefore).toBe(data.items[199]!.id);
  });

  it('ignores bad filter values instead of failing', async () => {
    const all = await page('', 'superAdmin');
    for (const query of [
      '?from=bad',
      '?to=2026-02-30',
      '?actor=nope',
      "?action=x'%20OR%201=1",
      '?branch=1&before=abc&limit=-1',
      '?entity=member&entity=report',
    ]) {
      const data = await page(query, 'superAdmin');
      expect(
        data.items.map((i) => i.id),
        query,
      ).toEqual(all.items.map((i) => i.id));
    }
  });

  it('applies filters from the query string', async () => {
    const data = await page('?entity=share&entityId=share-7', 'superAdmin');
    expect(data.items.map((i) => [i.entityType, i.entityId])).toEqual([['share', 'share-7']]);
    expect(data.items[0]!.after).toEqual({ n: 7 });
  });
});

describe('GET /api/v1/audit/facets', () => {
  async function facets(role: string): Promise<AuditFacets> {
    const res = await call(getFacets, '/facets', cookies[role]);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: AuditFacets }).data;
  }

  it('lists every entity type for super admin', async () => {
    const data = await facets('superAdmin');
    expect(data.restricted).toBe(false);
    expect(data.entityTypes).toEqual([...ENTITY_TYPES].sort());
    expect(data.branches).toHaveLength(1);
    expect(data.actors).toHaveLength(1);
  });

  it('lists no member or application entity type for finance reviewer', async () => {
    const data = await facets('finance');
    expect(data.restricted).toBe(true);
    expect(data.entityTypes).toEqual([...FINANCE_TYPES].sort());
    expect(data.entityTypes).not.toContain('member');
    expect(data.entityTypes).not.toContain('application');
    expect(data.actions.every((a) => FINANCE_TYPES.includes(a.split('.')[0]!))).toBe(true);
  });
});
