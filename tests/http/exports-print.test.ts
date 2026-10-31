import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/exports/print/route';
import { getEnv } from '@/platform/config/env';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, testPool } from '../support/db';
import { buildReportingScenario, type ReportingScenario } from '../support/reporting-fixtures';
import { createSessionCookie } from '../support/session';

const db = testPool();
const url = 'http://localhost:3000/api/v1/exports/print';
const RANDOM_UUID = '0f0f0f0f-0000-4000-8000-000000000000';

let s: ReportingScenario;
const cookies: Record<string, string> = {};

function send(
  body: unknown,
  opts: { cookie?: string; origin?: string | null; raw?: string } = {},
): Promise<Response> {
  const origin = opts.origin === undefined ? getEnv().APP_ORIGIN : opts.origin;
  return POST(
    new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(origin ? { origin } : {}),
      },
      body: opts.raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

const printAudits = async () =>
  (
    await db.query<{ after: Record<string, unknown> }>(
      `SELECT after FROM audit_events WHERE action = 'export.create' ORDER BY occurred_at, id`,
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

describe('POST /api/v1/exports/print', () => {
  it('records a summary print for finance and answers ok', async () => {
    const before = (await printAudits()).length;
    const res = await send({ kind: 'print_summary', rowCount: 22 }, { cookie: cookies.finance });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ data: { ok: true } });
    const rows = (await printAudits()).slice(before);
    expect(rows.map((r) => r.after)).toEqual([{ kind: 'print_summary', row_count: 22 }]);
  });

  it('records a report print for the super admin', async () => {
    const before = (await printAudits()).length;
    const res = await send(
      { kind: 'print_report', reportId: s.reports.aApproved, rowCount: 4 },
      { cookie: cookies.superAdmin },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ok: true });
    expect((await printAudits()).slice(before).map((r) => r.after)).toEqual([
      { kind: 'print_report', row_count: 4 },
    ]);
  });

  it('is 403 without an Origin or with a foreign one, and writes nothing', async () => {
    const before = (await printAudits()).length;
    for (const origin of [null, 'https://evil.example']) {
      const res = await send(
        { kind: 'print_summary', rowCount: 1 },
        { cookie: cookies.finance, origin },
      );
      expect(res.status, String(origin)).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    }
    expect((await printAudits()).length).toBe(before);
  });

  it('is 401 without a session', async () => {
    const res = await send({ kind: 'print_summary', rowCount: 1 });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
  });

  it('is 403 for branch leads, HR lead and content editor, even with a bad body', async () => {
    const before = (await printAudits()).length;
    for (const role of ['leadA', 'leadB', 'hrA', 'editor']) {
      for (const body of [{ kind: 'print_summary', rowCount: 1 }, { unexpected: true }]) {
        const res = await send(body, { cookie: cookies[role] });
        expect(res.status, role).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
      }
    }
    expect((await printAudits()).length).toBe(before);
  });

  it('rejects invalid bodies with 422 and writes nothing', async () => {
    const before = (await printAudits()).length;
    const bad: unknown[] = [
      { kind: 'print_summary', rowCount: 1, extra: 'x' },
      { kind: 'summary', rowCount: 1 },
      { kind: 'print_summary' },
      { kind: 'print_summary', rowCount: -1 },
      { kind: 'print_summary', rowCount: 100001 },
      { kind: 'print_summary', rowCount: 1.5 },
      { kind: 'print_summary', rowCount: '3' },
      { kind: 'print_report', rowCount: 1 },
      { kind: 'print_report', reportId: 'not-a-uuid', rowCount: 1 },
      { kind: 'print_summary', reportId: s.reports.aApproved, rowCount: 1 },
      [],
      null,
    ];
    for (const body of bad) {
      const res = await send(body, { cookie: cookies.finance });
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await res.json()).error.code).toBe('validation_failed');
    }
    const broken = await send(null, { cookie: cookies.finance, raw: '{"kind":' });
    expect(broken.status).toBe(422);
    expect((await printAudits()).length).toBe(before);
  });

  it('an unknown report is 404 and writes nothing', async () => {
    const before = (await printAudits()).length;
    const res = await send(
      { kind: 'print_report', reportId: RANDOM_UUID, rowCount: 1 },
      { cookie: cookies.finance },
    );
    expect(res.status).toBe(404);
    expect((await printAudits()).length).toBe(before);
  });

  it('accepts row counts at both ends of the range', async () => {
    for (const rowCount of [0, 100000]) {
      const res = await send({ kind: 'print_summary', rowCount }, { cookie: cookies.finance });
      expect(res.status, String(rowCount)).toBe(200);
    }
  });
});
