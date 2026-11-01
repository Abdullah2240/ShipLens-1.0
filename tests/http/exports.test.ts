import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/exports/[kind]/route';
import { getDashboardSummary } from '@/modules/reporting';
import { closePool } from '@/platform/db';
import enExports from '../../messages/en/exports.json';
import urExports from '../../messages/ur/exports.json';
import { closeTestPool, resetDb, testPool } from '../support/db';
import { seedReport } from '../support/finance-fixtures';
import {
  SCENARIO_EXPECTED,
  buildReportingScenario,
  type ReportingScenario,
} from '../support/reporting-fixtures';
import { createSessionCookie } from '../support/session';

const db = testPool();
const base = 'http://localhost:3000/api/v1/exports';
const KINDS = ['summary', 'reports', 'collections', 'unrouted'] as const;

let s: ReportingScenario;
const cookies: Record<string, string> = {};

function call(
  kind: string,
  opts: { cookie?: string; query?: string; site?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.site !== undefined) headers['sec-fetch-site'] = opts.site;
  return GET(new Request(`${base}/${kind}${opts.query ?? ''}`, { headers }), {
    params: Promise.resolve({ kind }),
  });
}

const exportAudits = async () =>
  (
    await db.query<{ after: Record<string, unknown> }>(
      `SELECT after FROM audit_events WHERE action = 'export.create' ORDER BY occurred_at, id`,
    )
  ).rows;

/** Last data line (the total row for money exports), split on commas. */
function lastLine(text: string): string[] {
  return text.slice(1, -2).split('\r\n').at(-1)!.split(',');
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

describe('GET /api/v1/exports/:kind access', () => {
  it.each(KINDS)('%s: 401 without a session', async (kind) => {
    const res = await call(kind);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
  });

  it.each(KINDS)('%s: 403 for branch leads, HR lead and content editor, no audit', async (kind) => {
    const before = (await exportAudits()).length;
    for (const role of ['leadA', 'leadB', 'hrA', 'editor']) {
      const res = await call(kind, { cookie: cookies[role] });
      expect(res.status, role).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    }
    expect((await exportAudits()).length).toBe(before);
  });

  it('unknown kind is 404 for an allowed role and is not audited', async () => {
    const before = (await exportAudits()).length;
    for (const kind of ['print_summary', 'everything', '..', '__proto__']) {
      const res = await call(kind, { cookie: cookies.finance });
      expect(res.status, kind).toBe(404);
    }
    expect((await exportAudits()).length).toBe(before);
  });

  it('a non-money or unknown figure is 404', async () => {
    for (const figure of [
      'active-branches',
      'reports-awaiting-review',
      'bogus',
      'pending_approval',
    ]) {
      const res = await call('collections', {
        cookie: cookies.finance,
        query: `?figure=${figure}`,
      });
      expect(res.status, figure).toBe(404);
    }
  });

  it('refuses a cross-site or same-site navigation with 403 and writes no audit row', async () => {
    const before = (await exportAudits()).length;
    for (const site of ['cross-site', 'same-site', 'CROSS-SITE']) {
      const res = await call('summary', { cookie: cookies.finance, site });
      expect(res.status, site).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    }
    expect((await exportAudits()).length).toBe(before);
  });

  it('allows same-origin, none and an absent Sec-Fetch-Site header', async () => {
    for (const site of ['same-origin', 'none', undefined]) {
      const res = await call('summary', { cookie: cookies.superAdmin, site });
      expect(res.status, String(site)).toBe(200);
    }
  });
});

describe('GET /api/v1/exports/:kind file', () => {
  it.each(KINDS)('%s: CSV attachment with BOM, no-store and one audit row', async (kind) => {
    const before = (await exportAudits()).length;
    const res = await call(kind, { cookie: cookies.finance });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toMatch(
      new RegExp(`^attachment; filename="shiplens-${kind}-[a-z0-9.-]+\\.csv"$`),
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text.endsWith('\r\n')).toBe(true);
    const audits = await exportAudits();
    expect(audits).toHaveLength(before + 1);
    expect(Object.keys(audits.at(-1)!.after).sort()).toEqual(['kind', 'row_count']);
    expect(audits.at(-1)!.after.kind).toBe(kind);
  });

  it('collections total equals the dashboard approved figure for the same filters', async () => {
    const query = '?from=2026-08&to=2026-09';
    const res = await call('collections', { cookie: cookies.finance, query });
    const text = await res.text();
    const summary = await getDashboardSummary(db, s.actors.finance, {
      from: '2026-08',
      to: '2026-09',
    });
    const footer = lastLine(text);
    expect(footer[0]).toBe(enExports.csv.total);
    expect(footer).toContain(summary.figures.approved.value);
    expect(res.headers.get('content-disposition')).toContain(
      'shiplens-collections-approved-2026-08-2026-09-',
    );
  });

  it('honours figure slug, branch and reportId', async () => {
    const pending = await (
      await call('reports', { cookie: cookies.finance, query: '?figure=pending-approval' })
    ).text();
    expect(lastLine(pending)).toContain(SCENARIO_EXPECTED.allTime.money.pending_approval.value);
    const branchB = await (
      await call('unrouted', { cookie: cookies.finance, query: `?branch=${s.branches.b.id}` })
    ).text();
    expect(lastLine(branchB)).toContain('500.00');
    const report = await (
      await call('collections', {
        cookie: cookies.finance,
        query: `?reportId=${s.reports.aApproved}`,
      })
    ).text();
    expect(lastLine(report)).toContain('1250.50');
  });

  it('uses Urdu column headers with ?locale=ur and English otherwise', async () => {
    const ur = await (
      await call('unrouted', { cookie: cookies.finance, query: '?locale=ur' })
    ).text();
    const [urHeader] = ur.replace(/^﻿/, '').split('\r\n');
    expect(urHeader!.split(',').slice(0, 2)).toEqual([
      urExports.csv.branchCode,
      urExports.csv.branchName,
    ]);
    expect(lastLine(ur)[0]).toBe(urExports.csv.total);
    for (const query of ['', '?locale=fr']) {
      const en = await (await call('unrouted', { cookie: cookies.finance, query })).text();
      expect(en.replace(/^﻿/, '').split('\r\n')[0]!.startsWith(enExports.csv.branchCode)).toBe(
        true,
      );
    }
  });

  it('neutralises a formula in a collection purpose', async () => {
    await seedReport(db, {
      branchId: s.branches.b.id,
      weekStart: '2026-10-12',
      status: 'approved',
      submittedBy: s.users.leadB.id,
      reviewedBy: s.users.finance.id,
      collections: [
        {
          amount: '12.00',
          collectedOn: '2026-10-13',
          purpose: '=cmd|',
          createdBy: s.users.leadB.id,
        },
      ],
    });
    const text = await (
      await call('collections', { cookie: cookies.finance, query: '?from=2026-10' })
    ).text();
    expect(text).toContain(",'=cmd|,12.00,");
    expect(text).not.toMatch(/(^|,)=cmd/m);
  });
});
