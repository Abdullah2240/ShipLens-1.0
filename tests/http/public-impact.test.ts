import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/public/impact/route';
import { resetImpactCache } from '@/modules/reporting/service-impact';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, testPool } from '../support/db';
import {
  SCENARIO_EXPECTED,
  buildReportingScenario,
  type ReportingScenario,
} from '../support/reporting-fixtures';
import { createSessionCookie } from '../support/session';

const db = testPool();
const URL_ = 'http://localhost:3000/api/v1/public/impact';
const KEYS = [
  'activeBranchCount',
  'activeBranches',
  'approvedReportCount',
  'approvedTotal',
  'asOf',
  'cities',
  'monthly',
  'monthsCovered',
];

let s: ReportingScenario;

function call(cookie?: string): Promise<Response> {
  return GET(new Request(URL_, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({}),
  });
}

beforeAll(async () => {
  await resetDb(db);
  s = await buildReportingScenario(db);
});

beforeEach(() => {
  resetImpactCache();
});

afterAll(async () => {
  resetImpactCache();
  await closePool();
  await closeTestPool();
});

describe('GET /api/v1/public/impact', () => {
  it('answers without a session with the approved aggregates only', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(['data']);
    expect(Object.keys(body.data).sort()).toEqual(KEYS);
    expect(body.data).toMatchObject({
      approvedTotal: SCENARIO_EXPECTED.allTime.money.approved.value,
      approvedReportCount: 2,
      monthsCovered: 2,
      monthly: [
        { month: '2026-08', approved: '1500.00' },
        { month: '2026-09', approved: '250.50' },
      ],
      activeBranchCount: 2,
      activeBranches: [
        { name: 'Bravo', city: 'Karachi' },
        { name: 'Alpha', city: 'Lahore' },
      ],
      cities: 2,
    });
  });

  it('returns the same body for every signed-in role', async () => {
    const anonymous = await (await call()).json();
    for (const user of Object.values(s.users)) {
      const res = await call(await createSessionCookie(db, user.id));
      expect(res.status, user.role).toBe(200);
      expect(await res.json(), user.role).toEqual(anonymous);
    }
  });

  it('never carries pending, in-progress, per-collection or personal data', async () => {
    const text = await (await call()).text();
    for (const secret of [
      '300.00',
      '40.25',
      '10.00',
      'Food parcels',
      'Medicine',
      ...Object.values(s.collections),
      ...Object.values(s.users).flatMap((u) => [u.id, u.name, u.email]),
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('ignores query parameters (no filters on the public figures)', async () => {
    const plain = await (await call()).json();
    const res = await GET(
      new Request(`${URL_}?from=2026-09&to=2026-09&branch=${s.branches.a.id}`),
      {
        params: Promise.resolve({}),
      },
    );
    expect(await res.json()).toEqual(plain);
  });
});
