import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as getRouted } from '@/app/api/v1/dashboard/routed/route';
import { GET as getSummary } from '@/app/api/v1/dashboard/summary/route';
import { GET as getTrend } from '@/app/api/v1/dashboard/trend/route';
import { GET as getUnrouted } from '@/app/api/v1/dashboard/unrouted/route';
import {
  getDashboardSummary,
  getMonthlyTrend,
  listRecentlyRouted,
  listUnrouted,
} from '@/modules/reporting';
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
const base = 'http://localhost:3000/api/v1/dashboard';
const ENDPOINTS: [string, Handler][] = [
  ['summary', getSummary],
  ['trend', getTrend],
  ['unrouted', getUnrouted],
  ['routed', getRouted],
];

let s: ReportingScenario;
const cookies: Record<string, string> = {};

function call(handler: Handler, path: string, cookie?: string): Promise<Response> {
  return handler(new Request(`${base}${path}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({}),
  });
}

/** JSON round trip without the snapshot time, which differs between two reads. */
function comparable(value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete copy.asOf;
  return copy;
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

describe('dashboard endpoints access (DASH-06)', () => {
  it.each(ENDPOINTS)('%s: 401 without a session', async (_name, handler) => {
    const res = await call(handler, `/${_name}`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
  });

  it.each(ENDPOINTS)(
    '%s: 403 for branch lead, HR lead and content editor',
    async (name, handler) => {
      for (const role of ['leadA', 'leadB', 'hrA', 'editor']) {
        const res = await call(handler, `/${name}`, cookies[role]);
        expect(res.status, role).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
    },
  );

  it.each(ENDPOINTS)('%s: 200 for super admin and finance reviewer', async (name, handler) => {
    for (const role of ['superAdmin', 'finance']) {
      const res = await call(handler, `/${name}`, cookies[role]);
      expect(res.status, role).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await res.json()).data).toBeTruthy();
    }
  });
});

describe('dashboard endpoints data', () => {
  it('summary returns the service result for the same filters', async () => {
    const res = await call(getSummary, '/summary?from=2026-09&to=2026-09', cookies.finance);
    const body = await res.json();
    const expected = await getDashboardSummary(db, s.actors.finance, {
      from: '2026-09',
      to: '2026-09',
    });
    expect(comparable(body.data)).toEqual(comparable(expected));
    expect(body.data.figures.collected).toEqual({
      figure: 'collected',
      measure: 'amount',
      value: SCENARIO_EXPECTED.september.money.collected.value,
      recordCount: SCENARIO_EXPECTED.september.money.collected.recordCount,
    });
    expect(body.data.filters).toEqual({ from: '2026-09', to: '2026-09' });
    expect(typeof body.data.asOf).toBe('string');
  });

  it('summary treats invalid query values as no filter', async () => {
    const res = await call(
      getSummary,
      '/summary?from=garbage&to=2026-13&branch=nope',
      cookies.superAdmin,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.filters).toEqual({});
    expect(body.data.figures.collected.value).toBe(SCENARIO_EXPECTED.allTime.money.collected.value);
    expect(body.data.figures.approved.value).toBe(SCENARIO_EXPECTED.allTime.money.approved.value);
    expect(body.data.identities).toEqual({ collected: true, approved: true });
  });

  it('summary narrows by branch', async () => {
    const body = await (
      await call(getSummary, `/summary?branch=${s.branches.b.id}`, cookies.finance)
    ).json();
    expect(body.data.figures.approved.value).toBe(SCENARIO_EXPECTED.branchB.money.approved.value);
    expect(body.data.figures.active_branches.value).toBe('1');
  });

  it('trend returns the service result and amounts as strings', async () => {
    const body = await (
      await call(getTrend, '/trend?from=2026-08&to=2026-10', cookies.finance)
    ).json();
    const expected = await getMonthlyTrend(db, s.actors.finance, {
      from: '2026-08',
      to: '2026-10',
    });
    expect(comparable(body.data)).toEqual(comparable(expected));
    expect(body.data.months).toEqual(SCENARIO_EXPECTED.trend);
    expect(body.data.totals.collected).toBe(SCENARIO_EXPECTED.allTime.money.collected.value);
  });

  it('unrouted returns the service result, oldest approval first', async () => {
    const body = await (await call(getUnrouted, '/unrouted', cookies.finance)).json();
    const expected = await listUnrouted(db, s.actors.finance, { page: 1, pageSize: 50 });
    expect(comparable(body.data)).toEqual(comparable(expected));
    expect(body.data.items.map((r: { amount: string }) => r.amount)).toEqual(
      SCENARIO_EXPECTED.unroutedAmounts,
    );
    expect(body.data.totalAmount).toBe(SCENARIO_EXPECTED.unroutedTotal);
    expect(typeof body.data.items[0].amount).toBe('string');
  });

  it('unrouted pages and clamps the page size', async () => {
    const second = await (
      await call(getUnrouted, '/unrouted?page=2&pageSize=1', cookies.finance)
    ).json();
    expect(second.data.items.map((r: { collectionId: string }) => r.collectionId)).toEqual([
      s.collections.b500,
    ]);
    expect(second.data).toMatchObject({ page: 2, pageSize: 1, total: 2, totalAmount: '1500.00' });

    const clamped = await (
      await call(getUnrouted, '/unrouted?pageSize=5000&page=abc', cookies.finance)
    ).json();
    expect(clamped.data).toMatchObject({ page: 1, pageSize: 200 });
  });

  it('routed returns the service result', async () => {
    const body = await (
      await call(getRouted, '/routed?page=1&pageSize=10', cookies.superAdmin)
    ).json();
    const expected = await listRecentlyRouted(db, s.actors.superAdmin, { page: 1, pageSize: 10 });
    expect(comparable(body.data)).toEqual(comparable(expected));
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      collectionId: s.collections.a250,
      amount: '250.50',
      routedByName: 'Faraz Finance',
    });
  });
});
