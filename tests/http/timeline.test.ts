import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as getCollectionTimeline } from '@/app/api/v1/collections/[id]/timeline/route';
import { GET as getReportTimeline } from '@/app/api/v1/reports/[id]/timeline/route';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { seedReport } from '../support/finance-fixtures';
import { createSessionCookie } from '../support/session';

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const base = 'http://localhost:3000/api/v1';

function get(handler: Handler, path: string, id: string, cookie?: string): Promise<Response> {
  return handler(new Request(`${base}${path}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ id }),
  });
}

async function insertAudit(row: {
  occurredAt: string;
  actorId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  branchId: string;
  reportId: string;
  after?: Record<string, unknown>;
}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO audit_events
       (occurred_at, actor_id, actor_role, action, entity_type, entity_id, branch_id, report_id, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
    [
      row.occurredAt,
      row.actorId,
      row.actorRole,
      row.action,
      row.entityType,
      row.entityId,
      row.branchId,
      row.reportId,
      row.after ? JSON.stringify(row.after) : null,
    ],
  );
  return rows[0]!.id;
}

let cookies: { admin: string; finance: string; leadA: string; hrA: string; editor: string };
let ids: { reportA: string; reportB: string; collectionA: string; collectionB: string };
let order: { report: string[]; collection: string[] };

beforeEach(async () => {
  await resetDb(db);
  const a = await seedBranch(db, { name: 'Alpha' });
  const b = await seedBranch(db, { name: 'Bravo' });
  const admin = await seedUser(db, { role: 'super_admin' });
  const finance = await seedUser(db, { role: 'finance_reviewer' });
  const editor = await seedUser(db, { role: 'content_editor' });
  const leadA = await seedUser(db, { role: 'branch_lead', branchId: a.id });
  const leadB = await seedUser(db, { role: 'branch_lead', branchId: b.id });
  const hrA = await seedUser(db, { role: 'hr_lead', branchId: a.id });

  const rA = await seedReport(db, {
    branchId: a.id,
    weekStart: '2026-10-26',
    collections: [{ amount: '100.00', createdBy: leadA.id }],
  });
  const rB = await seedReport(db, {
    branchId: b.id,
    weekStart: '2026-10-26',
    collections: [{ amount: '75.00', createdBy: leadB.id }],
  });
  const cA = rA.collectionIds[0]!;
  const cB = rB.collectionIds[0]!;

  const amend = await insertAudit({
    occurredAt: '2026-10-27T09:00:00Z',
    actorId: leadA.id,
    actorRole: 'branch_lead',
    action: 'collection.amend',
    entityType: 'collection',
    entityId: cA,
    branchId: a.id,
    reportId: rA.reportId,
    after: { amount: '150.00' },
  });
  const create = await insertAudit({
    occurredAt: '2026-10-26T05:05:00Z',
    actorId: leadA.id,
    actorRole: 'branch_lead',
    action: 'collection.create',
    entityType: 'collection',
    entityId: cA,
    branchId: a.id,
    reportId: rA.reportId,
    after: { amount: '100.00' },
  });
  const draft = await insertAudit({
    occurredAt: '2026-10-26T05:00:00Z',
    actorId: null,
    actorRole: 'system',
    action: 'report.create_draft',
    entityType: 'report',
    entityId: rA.reportId,
    branchId: a.id,
    reportId: rA.reportId,
    after: { status: 'draft' },
  });
  await insertAudit({
    occurredAt: '2026-10-26T06:00:00Z',
    actorId: leadB.id,
    actorRole: 'branch_lead',
    action: 'collection.create',
    entityType: 'collection',
    entityId: cB,
    branchId: b.id,
    reportId: rB.reportId,
  });

  cookies = {
    admin: await createSessionCookie(db, admin.id),
    finance: await createSessionCookie(db, finance.id),
    leadA: await createSessionCookie(db, leadA.id),
    hrA: await createSessionCookie(db, hrA.id),
    editor: await createSessionCookie(db, editor.id),
  };
  ids = { reportA: rA.reportId, reportB: rB.reportId, collectionA: cA, collectionB: cB };
  order = { report: [draft, create, amend], collection: [create, amend] };
});

afterAll(async () => {
  await closePool();
  await closeTestPool();
});

const withoutRequestId = (body: { error: Record<string, unknown> }) => {
  const { requestId, ...rest } = body.error;
  expect(typeof requestId).toBe('string');
  return rest;
};

const cases = [
  {
    name: 'GET /api/v1/reports/:id/timeline',
    handler: getReportTimeline as Handler,
    path: (id: string) => `/reports/${id}/timeline`,
    own: () => ids.reportA,
    other: () => ids.reportB,
    expected: () => order.report,
  },
  {
    name: 'GET /api/v1/collections/:id/timeline',
    handler: getCollectionTimeline as Handler,
    path: (id: string) => `/collections/${id}/timeline`,
    own: () => ids.collectionA,
    other: () => ids.collectionB,
    expected: () => order.collection,
  },
];

describe.each(cases)('$name', ({ handler, path, own, other, expected }) => {
  it('returns the ordered timeline to the own-branch lead with no-store caching', async () => {
    const res = await get(handler, path(own()), own(), cookies.leadA);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { data: { id: string; changes: unknown[] }[] };
    expect(body.data.map((e) => e.id)).toEqual(expected());
    expect(body.data[0]!.changes.length).toBeGreaterThan(0);
  });

  it('gives another branch the same 404 as a missing or malformed id', async () => {
    const responses = await Promise.all(
      [other(), randomUUID(), 'not-a-uuid'].map((id) => get(handler, path(id), id, cookies.leadA)),
    );
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    const [first, ...rest] = await Promise.all(
      responses.map(async (r) => withoutRequestId(await r.json())),
    );
    for (const body of rest) expect(body).toEqual(first);
  });

  it('lets finance and super admin read any branch', async () => {
    for (const cookie of [cookies.finance, cookies.admin]) {
      expect((await get(handler, path(own()), own(), cookie)).status).toBe(200);
      expect((await get(handler, path(other()), other(), cookie)).status).toBe(200);
    }
  });

  it('forbids HR leads and content editors and needs a session', async () => {
    expect((await get(handler, path(own()), own(), cookies.hrA)).status).toBe(403);
    expect((await get(handler, path(own()), own(), cookies.editor)).status).toBe(403);
    const anonymous = await get(handler, path(own()), own());
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe('no-store');
  });
});
