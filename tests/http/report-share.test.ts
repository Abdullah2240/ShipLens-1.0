import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/reports/[id]/share/route';
import { safeNextPath } from '@/modules/auth/next-path';
import { getEnv } from '@/platform/config/env';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, testPool } from '../support/db';
import { buildReportingScenario, type ReportingScenario } from '../support/reporting-fixtures';
import { createSessionCookie } from '../support/session';
import { withoutRequestId } from './support/world';

const db = testPool();
const base = 'http://localhost:3000/api/v1/reports';
const origin = () => getEnv().APP_ORIGIN;

let s: ReportingScenario;
const cookies: Record<string, string> = {};

function call(
  id: string,
  opts: {
    cookie?: string;
    origin?: string | null;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const sendOrigin = opts.origin === undefined ? origin() : opts.origin;
  return POST(
    new Request(`${base}/${id}/share`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(sendOrigin ? { origin: sendOrigin } : {}),
        ...opts.headers,
      },
      body: JSON.stringify(opts.body ?? {}),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const shareAudits = async () =>
  (
    await db.query<{ entity_id: string; after: unknown }>(
      `SELECT entity_id, after FROM audit_events WHERE action = 'report.share' ORDER BY occurred_at, id`,
    )
  ).rows;

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

describe('POST /api/v1/reports/:id/share', () => {
  it('returns the summary and an APP_ORIGIN link to the lead of the branch, and audits it', async () => {
    const before = (await shareAudits()).length;
    const res = await call(s.reports.aSubmitted, { cookie: cookies.leadA, body: { locale: 'ur' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { data: { summary: Record<string, unknown>; link: string } };
    expect(body.data.summary).toEqual({
      reportId: s.reports.aSubmitted,
      branchName: 'Alpha',
      branchCode: 'BR-A',
      weekStart: '2026-09-07',
      weekEnd: '2026-09-13',
      status: 'submitted',
      amount: '300.00',
      collectionCount: 1,
      amountIsFrozen: true,
    });
    expect(body.data.link).toBe(`${origin()}/ur/share/reports/${s.reports.aSubmitted}`);
    const rows = await shareAudits();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toEqual({
      entity_id: s.reports.aSubmitted,
      after: { channel: 'whatsapp' },
    });
  });

  it('defaults the link locale to en and ignores the Host header', async () => {
    const res = await call(s.reports.aDraft, {
      cookie: cookies.leadA,
      headers: { host: 'evil.test', 'x-forwarded-host': 'evil.test' },
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { link: string } };
    expect(data.link).toBe(`${origin()}/en/share/reports/${s.reports.aDraft}`);
    expect(data.link).not.toContain('evil.test');
  });

  it('is 403 without an Origin header or with a foreign one, and writes no audit row', async () => {
    const before = (await shareAudits()).length;
    for (const sent of [null, 'https://attacker.example']) {
      const res = await call(s.reports.aSubmitted, { cookie: cookies.leadA, origin: sent });
      expect(res.status, String(sent)).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    }
    expect(await shareAudits()).toHaveLength(before);
  });

  it('is 422 for an unknown body key or an unsupported locale, unaudited', async () => {
    const before = (await shareAudits()).length;
    for (const body of [
      { phone: '+923001234567' },
      { locale: 'fr' },
      { locale: 'en', text: 'x' },
    ]) {
      const res = await call(s.reports.aSubmitted, { cookie: cookies.leadA, body });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(await shareAudits()).toHaveLength(before);
  });

  it("gives another branch's report the same 404 body as a random id", async () => {
    const before = (await shareAudits()).length;
    const other = await call(s.reports.bApproved, { cookie: cookies.leadA });
    const random = await call(randomUUID(), { cookie: cookies.leadA });
    const malformed = await call('not-a-uuid', { cookie: cookies.leadA });
    expect(other.status).toBe(404);
    expect(random.status).toBe(404);
    expect(malformed.status).toBe(404);
    const otherBody = withoutRequestId(await other.json());
    expect(otherBody).toEqual(withoutRequestId(await random.json()));
    expect(otherBody).toEqual(withoutRequestId(await malformed.json()));
    expect(JSON.stringify(otherBody)).not.toContain(s.reports.bApproved);
    expect(await shareAudits()).toHaveLength(before);
  });

  it('is 403 for every other role, even with an invalid body', async () => {
    for (const key of ['finance', 'superAdmin', 'hrA', 'editor']) {
      const res = await call(s.reports.aSubmitted, { cookie: cookies[key] });
      expect(res.status, key).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
      const invalid = await call(s.reports.aSubmitted, {
        cookie: cookies[key],
        body: { unexpected: true },
      });
      expect(invalid.status, key).toBe(403);
    }
  });

  it('is 401 without a session', async () => {
    const res = await call(s.reports.aSubmitted);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
  });
});

describe('login next path (same-origin only)', () => {
  it('accepts the locale-prefixed share landing path', () => {
    for (const locale of ['en', 'ur']) {
      const path = `/${locale}/share/reports/${s.reports.aSubmitted}`;
      expect(safeNextPath(path)).toBe(path);
    }
  });

  it('rejects absolute, protocol-relative and backslash paths', () => {
    for (const raw of [
      '//evil.test',
      'https://evil.test',
      '/\\evil.test',
      '/%5Cevil.test',
      `https://evil.test/ur/share/reports/${s.reports.aSubmitted}`,
      'javascript:alert(1)',
    ]) {
      expect(safeNextPath(raw), raw).toBeNull();
    }
  });
});
