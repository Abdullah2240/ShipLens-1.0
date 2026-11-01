import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as publicVerify } from '@/app/api/v1/public/verify/[code]/route';
import { GET as reportVerification } from '@/app/api/v1/reports/[id]/verification/route';
import { approveReport, submitReport } from '@/modules/reports';
import {
  formatCode,
  verifyRateLimiter,
  type PublicReportVerification,
  type ReportVerificationLink,
} from '@/modules/verification';
import { resetChainStatusCache } from '@/platform/audit/chain/verify';
import type { Actor } from '@/platform/authz';
import { closePool } from '@/platform/db';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { seedReport } from '../support/finance-fixtures';
import { createSessionCookie } from '../support/session';

const db = testPool();
const origin = 'http://localhost:3000';
const LEAD = { name: 'Ayesha Siddiqui', email: 'ayesha.verify@example.test' };
const cookies: Record<string, string> = {};
let reportId: string;
let code: string;
let seal: string;
let n = 0;

type ErrorBody = { error: { code: string; message: string; requestId: string } };

function getPublic(
  rawCode: string,
  opts: { query?: string; ip?: string; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  if (opts.cookie) headers.cookie = opts.cookie;
  return publicVerify(
    new Request(
      `${origin}/api/v1/public/verify/${encodeURIComponent(rawCode)}${opts.query ?? ''}`,
      {
        headers,
      },
    ),
    { params: Promise.resolve({ code: rawCode }) },
  );
}

function getLink(id: string, cookie?: string): Promise<Response> {
  return reportVerification(
    new Request(`${origin}/api/v1/reports/${id}/verification`, {
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** Error body without the per-request id, for "identical response" comparisons. */
async function errorWithoutRequestId(res: Response): Promise<unknown> {
  const body = (await res.json()) as ErrorBody;
  expect(body.error.requestId).toEqual(expect.any(String));
  return { ...body.error, requestId: undefined };
}

function expectPlainHeaders(res: Response): void {
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('set-cookie')).toBeNull();
}

beforeAll(async () => {
  await resetDb(db);
  resetChainStatusCache();
  const branchA = await seedBranch(db, { name: 'Karachi Central', city: 'Karachi' });
  const branchB = await seedBranch(db, { name: 'Lahore North', city: 'Lahore' });
  const lead = await seedUser(db, { role: 'branch_lead', branchId: branchA.id, ...LEAD });
  const leadB = await seedUser(db, { role: 'branch_lead', branchId: branchB.id });
  const finance = await seedUser(db, { role: 'finance_reviewer' });
  const hr = await seedUser(db, { role: 'hr_lead', branchId: branchA.id });
  cookies.lead = await createSessionCookie(db, lead.id);
  cookies.leadB = await createSessionCookie(db, leadB.id);
  cookies.hr = await createSessionCookie(db, hr.id);

  const seeded = await seedReport(db, {
    branchId: branchA.id,
    weekStart: '2026-10-19',
    collections: ['500.00', '500.50', '500.00'].map((amount) => ({
      amount,
      purpose: 'Flood relief envelopes',
      createdBy: lead.id,
    })),
  });
  reportId = seeded.reportId;
  const ctx = (actor: Actor) => ({
    actor,
    requestId: `req-http-verify-${++n}`,
    clock: fixedClock('2026-10-28T10:00:00Z'),
    pool: db,
  });
  await submitReport(
    ctx({ userId: lead.id, role: 'branch_lead', branchId: branchA.id }),
    reportId,
    {},
  );
  await approveReport(
    ctx({ userId: finance.id, role: 'finance_reviewer', branchId: null }),
    reportId,
  );

  const { rows } = await db.query<{ code: string; hash: string }>(
    `SELECT v.code, a.hash FROM report_verifications v
       JOIN audit_events a ON a.entity_id = v.report_id::text AND a.action = 'report.approve'
      WHERE v.report_id = $1`,
    [reportId],
  );
  code = rows[0]!.code;
  seal = rows[0]!.hash.slice(0, 16);
});

beforeEach(() => {
  verifyRateLimiter.reset();
});

afterAll(async () => {
  verifyRateLimiter.reset();
  await closePool();
  await closeTestPool();
});

describe('GET /api/v1/public/verify/{code}', () => {
  it('answers without a session with the public projection', async () => {
    const res = await getPublic(formatCode(code));
    expect(res.status).toBe(200);
    expectPlainHeaders(res);
    const body = (await res.json()) as { data: PublicReportVerification };
    expect(body.data).toMatchObject({
      code: formatCode(code),
      branch: { name: 'Karachi Central', city: 'Karachi' },
      weekStart: '2026-10-19',
      weekEnd: '2026-10-25',
      approvedTotal: '1500.50',
      collectionCount: 3,
      integrity: 'verified',
      anchor: { seal },
      sealCheck: 'not_provided',
      chain: { status: 'intact', brokenAtSeq: null },
    });
    const json = JSON.stringify(body);
    for (const value of [LEAD.name, LEAD.email, reportId, 'Flood relief']) {
      expect(json).not.toContain(value);
    }
  });

  it('passes ?s= to the seal check', async () => {
    const match = await getPublic(code, { query: `?s=${seal}` });
    expect(((await match.json()) as { data: PublicReportVerification }).data.sealCheck).toBe(
      'match',
    );
    const other = await getPublic(code, { query: `?s=${'0'.repeat(16)}` });
    expect(((await other.json()) as { data: PublicReportVerification }).data.sealCheck).toBe(
      'mismatch',
    );
  });

  it('answers unknown and malformed codes with the same 404', async () => {
    const unknown = code === '0000000000' ? '1111111111' : '0000000000';
    const responses = [
      await getPublic(unknown),
      await getPublic('not a code'),
      await getPublic('%%%'),
    ];
    const bodies = [];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expectPlainHeaders(res);
      bodies.push(await errorWithoutRequestId(res));
    }
    expect(bodies[0]).toEqual({ code: 'not_found', message: 'Not found' });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it('ignores a session cookie and never sets one', async () => {
    const res = await getPublic(code, { cookie: cookies.lead });
    expect(res.status).toBe(200);
    expectPlainHeaders(res);
  });

  it('refuses the 31st lookup in a minute from one address with 429 and Retry-After', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < 30; i += 1) {
      // Lookups of unknown codes count too; later hops of x-forwarded-for are ignored.
      const res =
        i % 3 === 0
          ? await getPublic('0000000000', { ip: `${ip}, 10.0.0.${i}` })
          : await getPublic(code, { ip });
      expect(res.status, `request ${i + 1}`).not.toBe(429);
    }
    const refused = await getPublic(code, { ip });
    expect(refused.status).toBe(429);
    expectPlainHeaders(refused);
    const retryAfter = Number(refused.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = (await refused.json()) as ErrorBody;
    expect(body.error.code).toBe('rate_limited');

    // Another address is unaffected.
    expect((await getPublic(code, { ip: '203.0.113.9' })).status).toBe(200);
    // A malformed code from the limited address is still refused before any lookup.
    expect((await getPublic('nope', { ip })).status).toBe(429);
  });
});

describe('GET /api/v1/reports/{id}/verification', () => {
  it('is 401 without a session', async () => {
    const res = await getLink(reportId);
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).error.code).toBe('unauthenticated');
  });

  it('is 403 for a role without report.read', async () => {
    const res = await getLink(reportId, cookies.hr);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('forbidden');
  });

  it('answers another branch exactly like an unknown report', async () => {
    const foreign = await getLink(reportId, cookies.leadB);
    const unknown = await getLink('00000000-0000-4000-8000-000000000000', cookies.leadB);
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    const foreignBody = await errorWithoutRequestId(foreign);
    expect(foreignBody).toEqual(await errorWithoutRequestId(unknown));
    expect(JSON.stringify(foreignBody)).not.toContain(reportId);
  });

  it('gives the owning branch lead the code, public path and seal', async () => {
    const res = await getLink(reportId, cookies.lead);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { data: ReportVerificationLink };
    expect(body.data).toEqual({
      code: formatCode(code),
      path: `/verify/${formatCode(code)}?s=${seal}`,
      seal,
    });
  });
});
