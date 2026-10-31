import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getApplication,
  listApplications,
  parseApplicationListQuery,
} from '@/modules/applications';
import { getBranch, listBranches } from '@/modules/branches';
import { getCollection, listCollections, parseCollectionQuery } from '@/modules/collections';
import { getMember, listMembers, listTeams, parseMemberQuery } from '@/modules/members';
import { getReport, listReports, parseReportQuery } from '@/modules/reports';
import { getCollectionTimeline, getReportTimeline } from '@/modules/timeline';
import type { Actor } from '@/platform/authz';
import { closePool } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import { systemClock } from '@/platform/time';
import { closeTestPool, testPool } from '../support/db';
import {
  allScopeRole,
  isMutation,
  loadHandler,
  loadRegistry,
  ownBranchRoles,
  paramsFor,
  routeFileExists,
  type Handler,
} from './registry';
import type { EndpointSpec, Side, World, WorldUserKey } from './registry/types';
import {
  buildWorld,
  callEndpoint,
  dbFingerprint,
  listItems,
  swapRecordId,
  withoutRequestId,
} from './support/world';

// Publish and unpublish revalidate cached public pages; outside a Next request there is no
// cache to revalidate.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// TEST-03: a branch role can never read or write another branch's records through any
// registered endpoint. Cases are generated from the registry: an endpoint joins as soon as
// its entry has a `record`, `listOf` or `createsIn` key and a branch role holds its action.

const db = testPool();
const registry = loadRegistry();
const present = registry.filter(routeFileExists);
const SETUP_TIMEOUT = 120_000;

type BranchRole = 'branch_lead' | 'hr_lead';
const userOf = (role: BranchRole, side: Side): WorldUserKey =>
  side === 'A' ? role : (`${role}_b` as WorldUserKey);
const other = (side: Side): Side => (side === 'A' ? 'B' : 'A');
const branchOf = (w: World, side: Side) => (side === 'A' ? w.branchA : w.branchB);
const title = (s: EndpointSpec) => `${s.method} /api/v1/${s.route} [${s.action}] (${s.id})`;

afterAll(async () => {
  await closePool();
  await closeTestPool();
});

const recordSpecs = present.filter((s) => s.record && ownBranchRoles(s.action).length > 0);
const listSpecs = present.filter((s) => s.listOf && s.method === 'GET');
const createSpecs = present.filter((s) => s.createsIn === 'session-branch');

describe('generated coverage', () => {
  it('generates cross-branch cases for every branch-scoped record, list and create endpoint', ({
    annotate,
  }) => {
    const notCovered = registry
      .filter((s) => !routeFileExists(s))
      .map((s) => `${s.id} (route file missing)`);
    console.info(
      `cross-branch: ${recordSpecs.length} record endpoints, ${listSpecs.length} list endpoints, ${createSpecs.length} create endpoints; skipped: ${notCovered.length}`,
    );
    if (notCovered.length) void annotate(`skipped: ${notCovered.join(', ')}`);
    expect(recordSpecs.length).toBeGreaterThan(0);
    expect(listSpecs.length).toBeGreaterThan(0);
    expect(createSpecs.length).toBeGreaterThan(0);
  });

  it('covers both timeline endpoints as record endpoints', () => {
    const timelines = present.filter((s) => s.route.endsWith('/timeline'));
    expect(timelines.map((s) => s.id).sort()).toEqual(['collections.timeline', 'reports.timeline']);
    for (const spec of timelines) expect(recordSpecs).toContain(spec);
  });

  it('gives every [id] endpoint held by a branch role a record key (so it is checked)', () => {
    const unchecked = present
      .filter((s) => /\[id\]/.test(s.route) && ownBranchRoles(s.action).length > 0 && !s.record)
      .map((s) => s.id);
    expect(unchecked).toEqual([]);
  });
});

/** Same request with the record id swapped for an unknown one. */
async function unknownIdBody(
  handler: Handler,
  spec: EndpointSpec,
  w: World,
  cookie: string,
  side: Side,
  replacement?: string,
): Promise<{ status: number; body: unknown }> {
  const params = paramsFor(spec, w, side);
  const recordId = w.records[spec.record!]![side];
  const res = await callEndpoint(handler, spec, w, {
    cookie,
    params: swapRecordId(params, recordId, replacement),
  });
  return { status: res.status, body: withoutRequestId(await res.json()) };
}

function recordCases(spec: EndpointSpec, getWorld: () => World, getHandler: () => Handler) {
  for (const role of ownBranchRoles(spec.action)) {
    for (const side of ['A', 'B'] as const) {
      const target = other(side);
      it(`${role} of ${side} on ${target}'s ${spec.record}: 404 identical to an unknown id, nothing written`, async () => {
        const w = getWorld();
        const handler = getHandler();
        const cookie = w.users[userOf(role, side)].cookie;
        const before = await dbFingerprint(db);
        const res = await callEndpoint(handler, spec, w, { cookie, side: target });
        expect(res.status).toBe(404);
        const body = withoutRequestId(await res.json());
        expect(await dbFingerprint(db)).toEqual(before);
        const unknown = await unknownIdBody(handler, spec, w, cookie, target);
        expect(unknown.status).toBe(404);
        expect(body).toEqual(unknown.body);
        expect(JSON.stringify(body)).not.toContain(w.records[spec.record!]![target]);
      });
    }
    it(`${role}: a malformed id is the same 404 as an unknown id`, async () => {
      const w = getWorld();
      const cookie = w.users[userOf(role, 'A')].cookie;
      const malformed = await unknownIdBody(getHandler(), spec, w, cookie, 'A', 'not-a-uuid');
      const unknown = await unknownIdBody(getHandler(), spec, w, cookie, 'A');
      expect(malformed.status).toBe(404);
      expect(malformed.body).toEqual(unknown.body);
    });
  }
  // Controls last: they may change the own-branch record.
  for (const role of ownBranchRoles(spec.action)) {
    it(`${role} of A on its own ${spec.record}: in scope (control, not 401/403/404)`, async () => {
      const w = getWorld();
      const res = await callEndpoint(getHandler(), spec, w, {
        cookie: w.users[userOf(role, 'A')].cookie,
        side: 'A',
      });
      expect([401, 403, 404]).not.toContain(res.status);
      if (spec.method === 'GET') expect(res.status).toBe(200);
    });
  }
}

describe('record endpoints: reads (one shared world, reads write nothing)', () => {
  let w: World;
  const handlers = new Map<string, Handler>();
  const reads = recordSpecs.filter((s) => !isMutation(s));
  beforeAll(async () => {
    for (const spec of reads) handlers.set(spec.id, await loadHandler(spec));
    w = await buildWorld(db);
  }, SETUP_TIMEOUT);

  for (const spec of reads) {
    describe(title(spec), () => {
      recordCases(
        spec,
        () => w,
        () => handlers.get(spec.id)!,
      );
    });
  }
});

describe('record endpoints: writes (fresh world per endpoint)', () => {
  for (const spec of recordSpecs.filter(isMutation)) {
    describe(title(spec), () => {
      let w: World;
      let handler: Handler;
      beforeAll(async () => {
        handler = await loadHandler(spec);
        w = await buildWorld(db);
      }, SETUP_TIMEOUT);
      recordCases(
        spec,
        () => w,
        () => handler,
      );
    });
  }
});

describe('list endpoints', () => {
  let w: World;
  const handlers = new Map<string, Handler>();
  beforeAll(async () => {
    for (const spec of listSpecs) handlers.set(spec.id, await loadHandler(spec));
    w = await buildWorld(db);
  }, SETUP_TIMEOUT);

  for (const spec of listSpecs) {
    describe(title(spec), () => {
      const field = spec.listOf!;
      for (const role of ownBranchRoles(spec.action)) {
        for (const side of ['A', 'B'] as const) {
          it(`${role} of ${side} sees only ${side} rows (and at least one)`, async () => {
            const res = await callEndpoint(handlers.get(spec.id)!, spec, w, {
              cookie: w.users[userOf(role, side)].cookie,
            });
            expect(res.status).toBe(200);
            const items = listItems(await res.json());
            expect(items.length).toBeGreaterThan(0);
            expect(new Set(items.map((i) => i[field]))).toEqual(new Set([branchOf(w, side)]));
          });
          if (spec.branchFilter) {
            it(`${role} of ${side} naming ${other(side)} in ?branchId gets 404 or no ${other(side)} rows`, async () => {
              const res = await callEndpoint(handlers.get(spec.id)!, spec, w, {
                cookie: w.users[userOf(role, side)].cookie,
                query: { branchId: branchOf(w, other(side)) },
              });
              expect([200, 404]).toContain(res.status);
              const body = await res.json();
              if (res.status === 200) {
                const items = listItems(body);
                expect(items.filter((i) => i[field] !== branchOf(w, side))).toEqual([]);
              }
            });
          }
        }
      }
      const head = allScopeRole(spec.action);
      if (head) {
        it(`${head} sees both branches (the isolation checks are not vacuous)`, async () => {
          const res = await callEndpoint(handlers.get(spec.id)!, spec, w, {
            cookie: w.users[head].cookie,
          });
          expect(res.status).toBe(200);
          const seen = new Set(listItems(await res.json()).map((i) => i[field]));
          if (spec.id === 'reports.review_queue') {
            // Only submitted reports queue; both branches have one.
            expect(seen).toEqual(new Set([w.branchA, w.branchB]));
          } else {
            expect(seen.has(w.branchA) && seen.has(w.branchB)).toBe(true);
          }
        });
      }
    });
  }
});

// Expected refusals when the body names another branch. Collections never accept a branch
// key (strict schema, 422); teams accept one but refuse another branch with the shared 404.
const FOREIGN_BRANCH_STATUS: Record<string, number[]> = {
  'collections.create': [422],
  'teams.create': [404],
};

describe('create endpoints take the branch from the session', () => {
  for (const spec of createSpecs) {
    describe(title(spec), () => {
      let w: World;
      let handler: Handler;
      beforeAll(async () => {
        handler = await loadHandler(spec);
        w = await buildWorld(db);
      }, SETUP_TIMEOUT);

      const table = spec.createsTable!;
      const countIn = async (branchId: string) =>
        (
          await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${table} WHERE branch_id = $1`,
            [branchId],
          )
        ).rows[0]!.n;

      for (const role of ownBranchRoles(spec.action)) {
        for (const side of ['A', 'B'] as const) {
          it(`${role} of ${side} naming ${other(side)} in the body is refused and writes nothing`, async () => {
            const base = spec.body!(w) as Record<string, unknown>;
            const before = await dbFingerprint(db);
            const foreignBefore = await countIn(branchOf(w, other(side)));
            const res = await callEndpoint(handler, spec, w, {
              cookie: w.users[userOf(role, side)].cookie,
              body: { ...base, branchId: branchOf(w, other(side)) },
            });
            expect(FOREIGN_BRANCH_STATUS[spec.id] ?? [404, 422]).toContain(res.status);
            expect(await countIn(branchOf(w, other(side)))).toBe(foreignBefore);
            expect(await dbFingerprint(db)).toEqual(before);
          });
        }
        it(`${role} of A without a branch in the body creates in A`, async () => {
          const body = { ...(spec.body!(w) as Record<string, unknown>) };
          delete body.branchId;
          const beforeA = await countIn(w.branchA);
          const beforeB = await countIn(w.branchB);
          const res = await callEndpoint(handler, spec, w, {
            cookie: w.users[userOf(role, 'A')].cookie,
            body,
          });
          expect(res.status).toBe(201);
          const created = ((await res.json()) as { data: { id: string; branchId: string } }).data;
          expect(created.branchId).toBe(w.branchA);
          const { rows } = await db.query<{ branch_id: string }>(
            `SELECT branch_id FROM ${table} WHERE id = $1`,
            [created.id],
          );
          expect(rows[0]?.branch_id).toBe(w.branchA);
          expect(await countIn(w.branchA)).toBe(beforeA + 1);
          expect(await countIn(w.branchB)).toBe(beforeB);
        });
      }
    });
  }
});

describe('implicitly scoped endpoints', () => {
  it(
    "collections/current-week answers with the caller's own branch only",
    async () => {
      const spec = present.find((s) => s.id === 'collections.current_week');
      if (!spec) return;
      const handler = await loadHandler(spec);
      const w = await buildWorld(db);
      for (const side of ['A', 'B'] as const) {
        const res = await callEndpoint(handler, spec, w, {
          cookie: w.users[userOf('branch_lead', side)].cookie,
          query: { branchId: branchOf(w, other(side)) },
        });
        expect(res.status).toBe(200);
        const data = ((await res.json()) as { data: { reportId: string | null } }).data;
        expect(data.reportId).toBe(w.records.report_draft![side]);
      }
    },
    SETUP_TIMEOUT,
  );
});

describe('page services (what admin pages call) never cross branches', () => {
  let w: World;
  const actor = (role: BranchRole, side: Side): Actor => ({
    userId: w.users[userOf(role, side)].id,
    role,
    branchId: branchOf(w, side),
  });
  beforeAll(async () => {
    w = await buildWorld(db);
  }, SETUP_TIMEOUT);

  for (const side of ['A', 'B'] as const) {
    const target = other(side);
    it(`branch_lead of ${side}: single-record reads of ${target} throw NotFound`, async () => {
      const lead = actor('branch_lead', side);
      const rec = (name: string) => w.records[name]![target];
      await expect(getReport(db, lead, rec('report_draft'))).rejects.toBeInstanceOf(NotFound);
      await expect(getReport(db, lead, rec('report_submitted'))).rejects.toBeInstanceOf(NotFound);
      await expect(getCollection(db, lead, systemClock, rec('collection'))).rejects.toBeInstanceOf(
        NotFound,
      );
      await expect(getBranch(db, lead, rec('branch'))).rejects.toBeInstanceOf(NotFound);
      await expect(getReportTimeline(db, lead, rec('report_draft'))).rejects.toBeInstanceOf(
        NotFound,
      );
      await expect(getCollectionTimeline(db, lead, rec('collection'))).rejects.toBeInstanceOf(
        NotFound,
      );
      await expect(getMember(db, lead, rec('member'))).rejects.toBeInstanceOf(NotFound);
    });

    it(`hr_lead of ${side}: single-record reads of ${target} throw NotFound`, async () => {
      const hr = actor('hr_lead', side);
      const rec = (name: string) => w.records[name]![target];
      await expect(getBranch(db, hr, rec('branch'))).rejects.toBeInstanceOf(NotFound);
      await expect(getMember(db, hr, rec('member'))).rejects.toBeInstanceOf(NotFound);
      await expect(getApplication(db, hr, rec('application'))).rejects.toBeInstanceOf(NotFound);
    });

    it(`branch_lead of ${side}: lists exclude ${target} rows even when filtered to ${target}`, async () => {
      const lead = actor('branch_lead', side);
      const own = branchOf(w, side);
      const foreign = branchOf(w, target);
      const reports = await listReports(db, lead, parseReportQuery({}));
      expect(reports.items.length).toBeGreaterThan(0);
      expect(reports.items.every((r) => r.branchId === own)).toBe(true);
      const filteredReports = await listReports(db, lead, parseReportQuery({ branchId: foreign }));
      expect(filteredReports.items.filter((r) => r.branchId !== own)).toEqual([]);

      const collections = await listCollections(db, lead, systemClock, parseCollectionQuery({}));
      expect(collections.items.length).toBeGreaterThan(0);
      expect(collections.items.every((c) => c.branchId === own)).toBe(true);
      const filtered = await listCollections(
        db,
        lead,
        systemClock,
        parseCollectionQuery({ branchId: foreign, reportId: w.records.report_draft![target] }),
      );
      expect(filtered.items).toEqual([]);
      expect(filtered.total).toBe(0);

      const branches = await listBranches(db, lead);
      expect(branches.map((b) => b.id)).toEqual([own]);
      const members = await listMembers(db, lead, parseMemberQuery({}));
      expect(members.items.every((m) => m.branchId === own)).toBe(true);
    });

    it(`hr_lead of ${side}: member, team and application lists exclude ${target} rows`, async () => {
      const hr = actor('hr_lead', side);
      const own = branchOf(w, side);
      const members = await listMembers(db, hr, parseMemberQuery({}));
      expect(members.items.length).toBeGreaterThan(0);
      expect(members.items.every((m) => m.branchId === own)).toBe(true);
      const teams = await listTeams(db, hr);
      expect(teams.length).toBeGreaterThan(0);
      expect(teams.every((t) => t.branchId === own)).toBe(true);
      await expect(listTeams(db, hr, { branchId: branchOf(w, target) })).rejects.toBeInstanceOf(
        NotFound,
      );
      const apps = await listApplications(db, hr, parseApplicationListQuery({}));
      expect(apps.items.length).toBeGreaterThan(0);
      expect(apps.items.every((a) => a.branchId === own)).toBe(true);
    });
  }

  it('an unknown id throws the same NotFound as a foreign id', async () => {
    const lead = actor('branch_lead', 'A');
    await expect(getReport(db, lead, randomUUID())).rejects.toBeInstanceOf(NotFound);
    await expect(getCollection(db, lead, systemClock, randomUUID())).rejects.toBeInstanceOf(
      NotFound,
    );
  });
});
