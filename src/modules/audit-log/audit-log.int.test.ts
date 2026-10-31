import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/platform/authz';
import { Forbidden } from '@/platform/errors';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
  type UserRow,
} from '../../../tests/support/db';
import { FINANCE_AUDIT_ENTITY_TYPES, resolveAuditAccess } from './policy';
import { parseAuditQuery } from './schema';
import { getAuditFacets, listAuditEvents } from './service';
import type { AuditListItem, AuditQuery } from './types';

const db = testPool();

const actorOf = (u: UserRow): Actor => ({
  userId: u.id,
  role: u.role as Actor['role'],
  branchId: u.branch_id,
});

type UserKey = 'admin' | 'finance' | 'leadA' | 'hrA' | 'editor';
type EventSpec = {
  at: string;
  by: UserKey | null;
  action: string;
  entity: string;
  entityId: string;
  branch: 'A' | 'B' | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

const SHARED_AT = '2026-10-15T10:00:00Z';
const PKT_31_0030 = '2026-10-30T19:30:00Z';
const PKT_30_2359 = '2026-10-30T18:59:00Z';
const FINANCE = new Set<string>(FINANCE_AUDIT_ENTITY_TYPES);

// 30 events, inserted out of time order on purpose (ids are the paging key).
const EVENTS: EventSpec[] = [
  {
    at: '2026-10-01T05:00:00Z',
    by: 'admin',
    action: 'branch.create',
    entity: 'branch',
    entityId: 'branch-a',
    branch: 'A',
    after: { name: 'Alpha' },
  },
  {
    at: '2026-10-01T06:00:00Z',
    by: 'admin',
    action: 'branch.create',
    entity: 'branch',
    entityId: 'branch-b',
    branch: 'B',
    after: { name: 'Bravo' },
  },
  {
    at: '2026-10-01T07:00:00Z',
    by: 'admin',
    action: 'user.create',
    entity: 'user',
    entityId: 'user-1',
    branch: null,
    after: { role: 'branch_lead' },
  },
  {
    at: '2026-10-01T07:30:00Z',
    by: 'admin',
    action: 'user.create',
    entity: 'user',
    entityId: 'user-2',
    branch: null,
    after: { role: 'hr_lead' },
  },
  {
    at: '2026-10-02T04:00:00Z',
    by: 'leadA',
    action: 'session.login',
    entity: 'session',
    entityId: 'sess-1',
    branch: 'A',
  },
  {
    at: '2026-10-02T04:10:00Z',
    by: 'hrA',
    action: 'session.login',
    entity: 'session',
    entityId: 'sess-2',
    branch: 'A',
  },
  {
    at: '2026-10-03T05:00:00Z',
    by: 'leadA',
    action: 'collection.create',
    entity: 'collection',
    entityId: 'col-1',
    branch: 'A',
    after: { amount: '100.00' },
  },
  {
    at: '2026-10-03T05:10:00Z',
    by: 'leadA',
    action: 'collection.create',
    entity: 'collection',
    entityId: 'col-2',
    branch: 'A',
    after: { amount: '250.50' },
  },
  {
    at: '2026-10-03T05:20:00Z',
    by: 'leadA',
    action: 'collection.amend',
    entity: 'collection',
    entityId: 'col-1',
    branch: 'A',
    before: { amount: '100.00' },
    after: { amount: '120.00' },
  },
  {
    at: '2026-10-04T09:00:00Z',
    by: null,
    action: 'collection.create',
    entity: 'collection',
    entityId: 'col-3',
    branch: 'B',
    after: { amount: '75.00' },
  },
  {
    at: '2026-10-05T05:00:00Z',
    by: 'leadA',
    action: 'report.submit',
    entity: 'report',
    entityId: 'rep-1',
    branch: 'A',
    before: { status: 'draft' },
    after: { status: 'submitted' },
  },
  {
    at: '2026-10-06T05:00:00Z',
    by: 'finance',
    action: 'report.return',
    entity: 'report',
    entityId: 'rep-1',
    branch: 'A',
    before: { status: 'submitted' },
    after: { status: 'returned' },
  },
  {
    at: '2026-10-07T05:00:00Z',
    by: 'leadA',
    action: 'report.submit',
    entity: 'report',
    entityId: 'rep-1',
    branch: 'A',
    before: { status: 'returned' },
    after: { status: 'submitted' },
  },
  {
    at: '2026-10-08T05:00:00Z',
    by: 'finance',
    action: 'report.approve',
    entity: 'report',
    entityId: 'rep-1',
    branch: 'A',
    before: { status: 'submitted' },
    after: { status: 'approved' },
  },
  {
    at: '2026-10-09T05:00:00Z',
    by: 'hrA',
    action: 'application.approve',
    entity: 'application',
    entityId: 'app-1',
    branch: 'A',
    before: { status: 'pending' },
    after: { status: 'approved' },
  },
  {
    at: '2026-10-09T06:00:00Z',
    by: 'hrA',
    action: 'application.reject',
    entity: 'application',
    entityId: 'app-2',
    branch: 'A',
    before: { status: 'pending' },
    after: { status: 'rejected' },
  },
  {
    at: '2026-10-09T07:00:00Z',
    by: 'admin',
    action: 'application.approve',
    entity: 'application',
    entityId: 'app-3',
    branch: 'B',
  },
  {
    at: '2026-10-10T05:00:00Z',
    by: 'hrA',
    action: 'member.update',
    entity: 'member',
    entityId: 'mem-1',
    branch: 'A',
    before: { phone: '***' },
    after: { phone: '***' },
  },
  {
    at: '2026-10-10T06:00:00Z',
    by: 'admin',
    action: 'member.update',
    entity: 'member',
    entityId: 'mem-2',
    branch: 'B',
  },
  {
    at: '2026-10-10T07:00:00Z',
    by: 'hrA',
    action: 'member.create',
    entity: 'member',
    entityId: 'mem-3',
    branch: 'A',
  },
  {
    at: SHARED_AT,
    by: 'editor',
    action: 'content.publish',
    entity: 'content',
    entityId: 'cnt-1',
    branch: null,
  },
  {
    at: SHARED_AT,
    by: 'finance',
    action: 'collection.mark_routed',
    entity: 'collection',
    entityId: 'col-1',
    branch: 'A',
    before: { routed_at: null },
    after: { routed_at: '2026-10-15T10:00:00.000Z' },
  },
  {
    at: SHARED_AT,
    by: 'editor',
    action: 'content.unpublish',
    entity: 'content',
    entityId: 'cnt-1',
    branch: null,
  },
  {
    at: '2026-10-16T05:00:00Z',
    by: 'finance',
    action: 'export.create',
    entity: 'export',
    entityId: 'exp-1',
    branch: null,
    after: { kind: 'summary', row_count: 8 },
  },
  {
    at: '2026-10-17T05:00:00Z',
    by: 'admin',
    action: 'export.create',
    entity: 'export',
    entityId: 'exp-2',
    branch: null,
    after: { kind: 'collections', row_count: 3 },
  },
  {
    at: '2026-10-18T05:00:00Z',
    by: 'leadA',
    action: 'report.share',
    entity: 'share',
    entityId: 'shr-1',
    branch: 'A',
    after: { channel: 'whatsapp' },
  },
  {
    at: '2026-10-19T05:00:00Z',
    by: 'leadA',
    action: 'report.share',
    entity: 'share',
    entityId: 'shr-2',
    branch: 'A',
    after: { channel: 'whatsapp' },
  },
  {
    at: PKT_31_0030,
    by: 'leadA',
    action: 'collection.void',
    entity: 'collection',
    entityId: 'col-2',
    branch: 'A',
    before: { status: 'active' },
    after: { status: 'voided' },
  },
  {
    at: '2026-10-20T05:00:00Z',
    by: 'admin',
    action: 'branch.transition',
    entity: 'branch',
    entityId: 'branch-b',
    branch: 'B',
    before: { status: 'forming' },
    after: { status: 'active' },
  },
  {
    at: PKT_30_2359,
    by: 'finance',
    action: 'collection.unmark_routed',
    entity: 'collection',
    entityId: 'col-1',
    branch: 'A',
    before: { routed_at: '2026-10-15T10:00:00.000Z' },
    after: { routed_at: null },
  },
];

let users: Record<UserKey, UserRow>;
let actors: Record<UserKey, Actor>;
let branches: Record<'A' | 'B', BranchRow>;
/** Inserted ids, in EVENTS order. */
let ids: string[];

const q = (overrides: Partial<AuditQuery> = {}): AuditQuery => ({ limit: 50, ...overrides });
const idsOf = (items: AuditListItem[]) => items.map((i) => i.id);
const specOf = (id: string) => EVENTS[ids.indexOf(id)]!;
const descending = (list: string[]) => [...list].sort((a, b) => Number(b) - Number(a));

beforeAll(async () => {
  await resetDb(db);
  branches = {
    A: await seedBranch(db, { name: 'Alpha' }),
    B: await seedBranch(db, { name: 'Bravo' }),
  };
  users = {
    admin: await seedUser(db, { role: 'super_admin', name: 'Sana Admin' }),
    finance: await seedUser(db, { role: 'finance_reviewer', name: 'Faisal Finance' }),
    leadA: await seedUser(db, {
      role: 'branch_lead',
      branchId: branches.A.id,
      name: 'Ayesha Lead',
    }),
    hrA: await seedUser(db, { role: 'hr_lead', branchId: branches.A.id, name: 'Hamza HR' }),
    editor: await seedUser(db, { role: 'content_editor', name: 'Erum Editor' }),
  };
  actors = Object.fromEntries(
    Object.entries(users).map(([key, user]) => [key, actorOf(user)]),
  ) as Record<UserKey, Actor>;

  ids = [];
  for (const [i, e] of EVENTS.entries()) {
    const actor = e.by ? users[e.by] : null;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO audit_events
         (occurred_at, request_id, actor_id, actor_role, action, entity_type, entity_id, branch_id, report_id, before, after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10) RETURNING id::text AS id`,
      [
        e.at,
        `req-${i}`,
        actor?.id ?? null,
        actor?.role ?? 'system',
        e.action,
        e.entity,
        e.entityId,
        e.branch ? branches[e.branch].id : null,
        e.before ? JSON.stringify(e.before) : null,
        e.after ? JSON.stringify(e.after) : null,
      ],
    );
    ids.push(rows[0]!.id);
  }
});

afterAll(async () => {
  await closeTestPool();
});

describe('resolveAuditAccess', () => {
  it('gives Super Admin every entity type', () => {
    const access = resolveAuditAccess(actors.admin);
    expect(access.entityTypes).toBeNull();
    expect(access.scope.kind).toBe('all');
  });

  it('limits Finance Reviewer to finance entity types', () => {
    const access = resolveAuditAccess(actors.finance);
    expect(access.entityTypes).toEqual(['collection', 'report', 'export', 'share']);
    expect(access.scope.kind).toBe('all');
  });

  it.each(['leadA', 'hrA', 'editor'] as const)('refuses %s', (key) => {
    expect(() => resolveAuditAccess(actors[key])).toThrow(Forbidden);
  });
});

describe('listAuditEvents access', () => {
  it('Super Admin sees every event newest first by id', async () => {
    const page = await listAuditEvents(db, actors.admin, q());
    expect(page.restricted).toBe(false);
    expect(page.nextBefore).toBeNull();
    expect(page.items).toHaveLength(30);
    expect(idsOf(page.items)).toEqual(descending(ids));
  });

  it('Finance Reviewer sees only collection, report, export and share events', async () => {
    const page = await listAuditEvents(db, actors.finance, q());
    expect(page.restricted).toBe(true);
    const expected = ids.filter((id) => FINANCE.has(specOf(id).entity));
    expect(expected).toHaveLength(15);
    expect(idsOf(page.items)).toEqual(descending(expected));
    expect(page.items.every((i) => FINANCE.has(i.entityType))).toBe(true);
  });

  it('Finance Reviewer asking for a non-finance entity type gets an empty list', async () => {
    for (const entity of ['member', 'application', 'branch', 'user']) {
      const page = await listAuditEvents(db, actors.finance, q({ entity }));
      expect(page.items, entity).toEqual([]);
      expect(page.nextBefore).toBeNull();
    }
    const byId = await listAuditEvents(db, actors.finance, q({ entityId: 'mem-1' }));
    expect(byId.items).toEqual([]);
  });

  it.each(['leadA', 'hrA', 'editor'] as const)('%s is Forbidden', async (key) => {
    await expect(listAuditEvents(db, actors[key], q())).rejects.toBeInstanceOf(Forbidden);
    await expect(getAuditFacets(db, actors[key])).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('listAuditEvents paging', () => {
  async function walk(actor: Actor, limit: number): Promise<string[][]> {
    const pages: string[][] = [];
    let before: string | undefined;
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await listAuditEvents(db, actor, q({ limit, ...(before ? { before } : {}) }));
      pages.push(idsOf(page.items));
      if (!page.nextBefore) break;
      expect(page.items).toHaveLength(limit);
      expect(page.nextBefore).toBe(page.items[page.items.length - 1]!.id);
      before = page.nextBefore;
    }
    return pages;
  }

  it('pages through all 30 rows with limit 10, no duplicates and no gaps', async () => {
    const pages = await walk(actors.admin, 10);
    expect(pages.map((p) => p.length)).toEqual([10, 10, 10]);
    const all = pages.flat();
    expect(new Set(all).size).toBe(30);
    expect(all).toEqual(descending(ids));
  });

  it('pages across rows sharing occurred_at without skipping or repeating', async () => {
    const pages = await walk(actors.admin, 7);
    const all = pages.flat();
    expect(all).toEqual(descending(ids));
    const shared = ids.filter((id) => specOf(id).at === SHARED_AT);
    expect(shared).toHaveLength(3);
    for (const id of shared) expect(all.filter((x) => x === id)).toHaveLength(1);
  });

  it('pages the finance view without leaking other entity types', async () => {
    const all = (await walk(actors.finance, 4)).flat();
    expect(all).toEqual(descending(ids.filter((id) => FINANCE.has(specOf(id).entity))));
  });

  it('returns nextBefore only when another page exists', async () => {
    const full = await listAuditEvents(db, actors.admin, q({ limit: 30 }));
    expect(full.items).toHaveLength(30);
    expect(full.nextBefore).toBeNull();
    const short = await listAuditEvents(db, actors.admin, q({ limit: 29 }));
    expect(short.nextBefore).toBe(short.items[28]!.id);
  });

  it('clamps an out-of-range limit passed directly to the service', async () => {
    const page = await listAuditEvents(db, actors.admin, q({ limit: 0 }));
    expect(page.items).toHaveLength(1);
    const big = await listAuditEvents(db, actors.admin, q({ limit: 10_000 }));
    expect(big.items).toHaveLength(30);
  });
});

describe('listAuditEvents filters', () => {
  const pktIdOf = (at: string) => ids[EVENTS.findIndex((e) => e.at === at)]!;

  it('uses PKT day boundaries for the date range', async () => {
    const day31 = await listAuditEvents(
      db,
      actors.admin,
      q({ from: '2026-10-31', to: '2026-10-31' }),
    );
    expect(idsOf(day31.items)).toEqual([pktIdOf(PKT_31_0030)]);

    const day30 = await listAuditEvents(
      db,
      actors.admin,
      q({ from: '2026-10-30', to: '2026-10-30' }),
    );
    expect(idsOf(day30.items)).toEqual([pktIdOf(PKT_30_2359)]);

    const fromOnly = await listAuditEvents(db, actors.admin, q({ from: '2026-10-31' }));
    expect(idsOf(fromOnly.items)).toEqual([pktIdOf(PKT_31_0030)]);

    const toOnly = await listAuditEvents(db, actors.admin, q({ to: '2026-10-30' }));
    expect(toOnly.items).toHaveLength(29);
    expect(idsOf(toOnly.items)).not.toContain(pktIdOf(PKT_31_0030));
  });

  it('filters by actor', async () => {
    const page = await listAuditEvents(db, actors.admin, q({ actor: users.hrA.id }));
    const expected = ids.filter((id) => specOf(id).by === 'hrA');
    expect(expected.length).toBeGreaterThan(1);
    expect(idsOf(page.items)).toEqual(descending(expected));
  });

  it('filters by action', async () => {
    const page = await listAuditEvents(db, actors.admin, q({ action: 'report.submit' }));
    expect(idsOf(page.items)).toEqual(
      descending(ids.filter((id) => specOf(id).action === 'report.submit')),
    );
    expect(page.items).toHaveLength(2);
  });

  it('filters by entity type and entity id', async () => {
    const byType = await listAuditEvents(db, actors.admin, q({ entity: 'member' }));
    expect(byType.items.map((i) => i.entityType)).toEqual(['member', 'member', 'member']);
    const byId = await listAuditEvents(db, actors.admin, q({ entityId: 'col-1' }));
    expect(idsOf(byId.items)).toEqual(
      descending(ids.filter((id) => specOf(id).entityId === 'col-1')),
    );
    expect(byId.items).toHaveLength(4);
  });

  it('filters by branch', async () => {
    const page = await listAuditEvents(db, actors.admin, q({ branch: branches.B.id }));
    expect(idsOf(page.items)).toEqual(descending(ids.filter((id) => specOf(id).branch === 'B')));
    expect(page.items.every((i) => i.branchCode === branches.B.code)).toBe(true);
  });

  it('combines filters with AND', async () => {
    const page = await listAuditEvents(
      db,
      actors.admin,
      q({
        actor: users.finance.id,
        entity: 'collection',
        branch: branches.A.id,
        from: '2026-10-15',
        to: '2026-10-15',
      }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.action).toBe('collection.mark_routed');

    const none = await listAuditEvents(
      db,
      actors.admin,
      q({ actor: users.finance.id, action: 'report.submit' }),
    );
    expect(none.items).toEqual([]);
  });

  it('combines filters with the finance restriction', async () => {
    const page = await listAuditEvents(db, actors.finance, q({ actor: users.admin.id }));
    expect(page.items.map((i) => i.entityId)).toEqual(['exp-2']);
  });

  it('applies the filters parsed from a query string', async () => {
    const parsed = parseAuditQuery(
      new URLSearchParams({ action: 'report.approve', from: 'bad', limit: '9999' }),
    );
    const page = await listAuditEvents(db, actors.admin, parsed);
    expect(page.items.map((i) => i.entityId)).toEqual(['rep-1']);
  });
});

describe('listAuditEvents items', () => {
  it('carries actor name and role, branch code and snapshots exactly as stored', async () => {
    const page = await listAuditEvents(db, actors.admin, q());
    const byId = new Map(page.items.map((i) => [i.id, i]));
    for (const [index, e] of EVENTS.entries()) {
      const item = byId.get(ids[index]!)!;
      expect(item.id).toMatch(/^\d+$/);
      expect(item.occurredAt).toBe(new Date(e.at).toISOString());
      expect(item.requestId).toBe(`req-${index}`);
      expect(item.action).toBe(e.action);
      expect(item.entityType).toBe(e.entity);
      expect(item.entityId).toBe(e.entityId);
      expect(item.before).toEqual(e.before ?? null);
      expect(item.after).toEqual(e.after ?? null);
      expect(item.reportId).toBeNull();
      if (e.by) {
        expect(item.actorId).toBe(users[e.by].id);
        expect(item.actorName).toBe(users[e.by].name);
        expect(item.actorRole).toBe(users[e.by].role);
      } else {
        expect(item.actorId).toBeNull();
        expect(item.actorName).toBeNull();
        expect(item.actorRole).toBe('system');
      }
      if (e.branch) {
        expect(item.branchId).toBe(branches[e.branch].id);
        expect(item.branchCode).toBe(branches[e.branch].code);
      } else {
        expect(item.branchId).toBeNull();
        expect(item.branchCode).toBeNull();
      }
    }
  });
});

describe('getAuditFacets', () => {
  it('lists every distinct value for Super Admin', async () => {
    const facets = await getAuditFacets(db, actors.admin);
    expect(facets.restricted).toBe(false);
    expect(facets.actions).toEqual([...new Set(EVENTS.map((e) => e.action))].sort());
    expect(facets.entityTypes).toEqual([...new Set(EVENTS.map((e) => e.entity))].sort());
    expect(facets.actors.map((a) => a.id).sort()).toEqual(
      Object.values(users)
        .map((u) => u.id)
        .sort(),
    );
    const finance = facets.actors.find((a) => a.id === users.finance.id);
    expect(finance).toEqual({
      id: users.finance.id,
      name: 'Faisal Finance',
      role: 'finance_reviewer',
    });
    expect(facets.branches).toEqual(
      [branches.A, branches.B]
        .map((b) => ({ id: b.id, code: b.code, name: b.name }))
        .sort((x, y) => x.code.localeCompare(y.code)),
    );
  });

  it('lists only finance entity types and their actions for Finance Reviewer', async () => {
    const facets = await getAuditFacets(db, actors.finance);
    expect(facets.restricted).toBe(true);
    expect(facets.entityTypes).toEqual(['collection', 'export', 'report', 'share']);
    const financeEvents = EVENTS.filter((e) => FINANCE.has(e.entity));
    expect(facets.actions).toEqual([...new Set(financeEvents.map((e) => e.action))].sort());
    expect(facets.actions).not.toContain('member.update');
    expect(facets.actions).not.toContain('content.publish');
    const actorKeys = new Set(financeEvents.map((e) => e.by).filter((k) => k !== null));
    expect(facets.actors.map((a) => a.id).sort()).toEqual(
      [...actorKeys].map((k) => users[k].id).sort(),
    );
    expect(facets.actors.map((a) => a.id)).not.toContain(users.hrA.id);
    expect(facets.actors.map((a) => a.id)).not.toContain(users.editor.id);
  });
});
