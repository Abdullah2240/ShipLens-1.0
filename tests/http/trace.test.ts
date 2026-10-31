import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as getFigure } from '@/app/api/v1/trace/[slug]/route';
import { GET as getBranch } from '@/app/api/v1/trace/[slug]/branches/[branchId]/route';
import { GET as getReport } from '@/app/api/v1/trace/[slug]/branches/[branchId]/reports/[reportId]/route';
import { GET as getCollection } from '@/app/api/v1/trace/[slug]/branches/[branchId]/reports/[reportId]/collections/[collectionId]/route';
import {
  getBranchReports,
  getCollectionEvidence,
  getFigureByBranch,
  getReportCollections,
} from '@/modules/reporting/service-trace';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, testPool } from '../support/db';
import {
  SCENARIO_EXPECTED,
  buildReportingScenario,
  type ReportingScenario,
} from '../support/reporting-fixtures';
import { createSessionCookie } from '../support/session';

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const origin = 'http://localhost:3000';
const API = '/api/v1/trace';

let s: ReportingScenario;
const cookies: Record<string, string> = {};

/** Resolves an API path the way the app router would: handler plus path params. */
function resolve(path: string): { handler: Handler; params: Record<string, string> } {
  const pathname = path.split('?')[0]!;
  const parts = pathname.slice(API.length + 1).split('/');
  const [slug, b, branchId, r, reportId, c, collectionId, ...rest] = parts;
  if (!slug || rest.length) throw new Error(`unroutable path ${path}`);
  if (collectionId !== undefined) {
    expect([b, r, c]).toEqual(['branches', 'reports', 'collections']);
    return {
      handler: getCollection,
      params: { slug, branchId, reportId, collectionId } as Record<string, string>,
    };
  }
  if (reportId !== undefined) {
    expect([b, r]).toEqual(['branches', 'reports']);
    return { handler: getReport, params: { slug, branchId, reportId } as Record<string, string> };
  }
  if (branchId !== undefined) {
    expect(b).toBe('branches');
    return { handler: getBranch, params: { slug, branchId } };
  }
  return { handler: getFigure, params: { slug } };
}

function get(path: string, cookie?: string): Promise<Response> {
  const { handler, params } = resolve(path);
  return handler(new Request(`${origin}${path}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve(params),
  });
}

/** App href ('/dashboard/kpi/...') to the API form ('/api/v1/trace/...'). */
function apiPath(href: string): string {
  expect(href.startsWith('/dashboard/kpi/')).toBe(true);
  return href.replace(/^\/dashboard\/kpi/, API);
}

/** JSON round trip without snapshot instants, which differ between two reads. */
function comparable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, v: unknown) => (key === 'asOf' ? undefined : v));
}

function paths() {
  const a = s.branches.a.id;
  const r = s.reports.aApproved;
  const c = s.collections.a1000;
  return [
    `${API}/approved`,
    `${API}/approved/branches/${a}`,
    `${API}/approved/branches/${a}/reports/${r}`,
    `${API}/approved/branches/${a}/reports/${r}/collections/${c}`,
  ];
}

beforeAll(async () => {
  await resetDb(db);
  s = await buildReportingScenario(db);
  for (const [key, user] of Object.entries(s.users)) {
    cookies[key] = await createSessionCookie(db, user.id);
  }
});

afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('trace endpoints access (DASH-06)', () => {
  it('401 without a session on every level', async () => {
    for (const path of paths()) {
      const res = await get(path);
      expect(res.status, path).toBe(401);
      expect((await res.json()).error.code).toBe('unauthenticated');
    }
  });

  it('403 for branch lead, HR lead and content editor on every level', async () => {
    for (const path of [...paths(), `${API}/bogus`, `${API}/approved/branches/not-a-uuid`]) {
      for (const role of ['leadA', 'leadB', 'hrA', 'editor']) {
        const res = await get(path, cookies[role]);
        expect(res.status, `${role} ${path}`).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
    }
  });

  it('200 for super admin and finance reviewer on every level', async () => {
    for (const path of paths()) {
      for (const role of ['superAdmin', 'finance']) {
        const res = await get(path, cookies[role]);
        expect(res.status, `${role} ${path}`).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect((await res.json()).data).toBeTruthy();
      }
    }
  });
});

describe('trace endpoints data', () => {
  it('each level returns the service result', async () => {
    const fin = s.actors.finance;
    const a = s.branches.a.id;
    const r = s.reports.aApproved;
    const c = s.collections.a1000;
    const expected = [
      await getFigureByBranch(db, fin, 'approved', {}),
      await getBranchReports(db, fin, 'approved', a, {}),
      await getReportCollections(db, fin, 'approved', a, r, {}),
      await getCollectionEvidence(db, fin, 'approved', a, r, c, {}),
    ];
    const ps = paths();
    for (let i = 0; i < ps.length; i += 1) {
      const body = await (await get(ps[i]!, cookies.finance)).json();
      expect(comparable(body.data), ps[i]).toEqual(comparable(expected[i]));
      expect(typeof body.data.asOf).toBe('string');
    }
  });

  it('honours the month filter and ignores invalid values', async () => {
    const september = await (
      await get(`${API}/collected?from=2026-09&to=2026-09`, cookies.finance)
    ).json();
    expect(september.data.total).toBe(SCENARIO_EXPECTED.september.money.collected.value);
    expect(september.data.explain.filters).toEqual({ from: '2026-09', to: '2026-09' });

    const ignored = await (await get(`${API}/collected?from=nonsense`, cookies.finance)).json();
    expect(ignored.data.total).toBe(SCENARIO_EXPECTED.allTime.money.collected.value);
    expect(ignored.data.explain.filters).toEqual({});

    const branchFiltered = await (
      await get(`${API}/collected?branch=${s.branches.b.id}`, cookies.finance)
    ).json();
    expect(branchFiltered.data.total).toBe(SCENARIO_EXPECTED.branchB.money.collected.value);

    const l2 = await (
      await get(
        `${API}/approved/branches/${s.branches.a.id}?from=2026-09&to=2026-09`,
        cookies.finance,
      )
    ).json();
    expect(l2.data.total).toBe('250.50');
    expect(l2.data.explain.filters).toEqual({
      from: '2026-09',
      to: '2026-09',
      branchId: s.branches.a.id,
    });
  });

  it('gives the same 404 body for an unknown slug, a snake_case slug and broken chains', async () => {
    const a = s.branches.a.id;
    const r = s.reports;
    const broken = [
      `${API}/bogus`,
      `${API}/pending_approval`,
      `${API}/approved/branches/${a}/reports/${r.aDraft}`,
      `${API}/approved/branches/${a}/reports/${r.bApproved}`,
      `${API}/approved/branches/not-a-uuid`,
      `${API}/approved/branches/0f0f0f0f-0000-4000-8000-000000000000`,
      `${API}/active-branches/branches/${a}`,
      `${API}/approved/branches/${a}/reports/${r.aApproved}/collections/${s.collections.a300}`,
      `${API}/collected/branches/${a}/reports/${r.aApproved}/collections/${s.collections.aVoid999}`,
      `${API}/approved/branches/${a}/reports/${r.aApproved}/collections/${s.collections.a1000}?from=2026-09`,
    ];
    const bodies: unknown[] = [];
    for (const path of broken) {
      const res = await get(path, cookies.superAdmin);
      expect(res.status, path).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('not_found');
      expect(res.headers.get('x-request-id')).toBe(body.error.requestId);
      delete body.error.requestId;
      bodies.push(body);
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it('walks L1 to L4 by following hrefs, every level matching its parent', async () => {
    const walks: string[] = [
      `${API}/approved`,
      `${API}/approved?from=2026-09&to=2026-09`,
      `${API}/collected?from=2026-08`,
      `${API}/pending-approval`,
      `${API}/in-progress`,
      `${API}/not-yet-routed`,
      `${API}/routed`,
      `${API}/reports-awaiting-review`,
    ];
    for (const start of walks) {
      const l1 = (await (await get(start, cookies.finance)).json()).data;
      expect(l1.matchesParent, start).toBe(true);
      expect(l1.rows.length, start).toBeGreaterThan(0);
      const l2 = (await (await get(apiPath(l1.rows[0].href), cookies.finance)).json()).data;
      expect(l2.level).toBe('reports');
      expect(l2.matchesParent, start).toBe(true);
      expect(l2.parentValue).toBe(l1.rows[0].value);
      const l3 = (await (await get(apiPath(l2.rows[0].href), cookies.finance)).json()).data;
      expect(l3.level).toBe('collections');
      expect(l3.matchesParent, start).toBe(true);
      expect(l3.total).toBe(l2.rows[0].value);
      const res = await get(apiPath(l3.rows[0].href), cookies.finance);
      expect(res.status, start).toBe(200);
      const l4 = (await res.json()).data;
      expect(l4.collection.collectionId).toBe(l3.rows[0].collectionId);
      expect(l4.collection.amount).toBe(l3.rows[0].amount);
      expect(l4.trail.map((t: { value: string }) => t.value)).toEqual([
        l1.parentValue,
        l1.parentValue,
        l1.rows[0].value,
        l2.rows[0].value,
        l3.rows[0].amount,
      ]);
      expect(Array.isArray(l4.collectionTimeline)).toBe(true);
      expect(Array.isArray(l4.reportTimeline)).toBe(true);
    }
  });

  it('active branches rows link into the approved branch level', async () => {
    const l1 = (await (await get(`${API}/active-branches`, cookies.finance)).json()).data;
    expect(l1.total).toBe(String(SCENARIO_EXPECTED.allTime.counts.active_branches));
    expect(l1.matchesParent).toBe(true);
    for (const row of l1.rows) {
      const res = await get(apiPath(row.href), cookies.finance);
      expect(res.status).toBe(200);
      const l2 = (await res.json()).data;
      expect(l2.figure).toBe('approved');
      expect(l2.matchesParent).toBe(true);
    }
  });
});
