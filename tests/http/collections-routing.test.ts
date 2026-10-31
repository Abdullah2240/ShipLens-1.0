import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, POST } from '@/app/api/v1/collections/[id]/routed/route';
import { getEnv } from '@/platform/config/env';
import { closePool } from '@/platform/db';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
} from '../support/db';
import { seedReport } from '../support/finance-fixtures';
import { createSessionCookie } from '../support/session';

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const base = 'http://localhost:3000/api/v1';
const origin = () => getEnv().APP_ORIGIN;

function send(
  handler: Handler,
  method: 'POST' | 'DELETE',
  id: string,
  opts: { cookie?: string; origin?: string | null } = {},
): Promise<Response> {
  const sendOrigin = opts.origin === undefined ? origin() : opts.origin;
  return handler(
    new Request(`${base}/collections/${id}/routed`, {
      method,
      headers: {
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(sendOrigin ? { origin: sendOrigin } : {}),
      },
    }),
    { params: Promise.resolve({ id }) },
  );
}

let a: BranchRow;
let approvedId: string;
let submittedId: string;
let cookies: {
  admin: string;
  finance: string;
  leadA: string;
  hrA: string;
  editor: string;
};

const routedAt = async (id: string) =>
  (
    await db.query<{ routed_at: Date | null }>('SELECT routed_at FROM collections WHERE id = $1', [
      id,
    ])
  ).rows[0]!.routed_at;
const auditCount = async () =>
  (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_events')).rows[0]!.n;
const withoutRequestId = (body: { error: Record<string, unknown> }) => ({
  ...body.error,
  requestId: undefined,
});

beforeEach(async () => {
  await resetDb(db);
  a = await seedBranch(db, { name: 'Alpha Branch', status: 'active' });
  const admin = await seedUser(db, { role: 'super_admin' });
  const finance = await seedUser(db, { role: 'finance_reviewer' });
  const leadA = await seedUser(db, { role: 'branch_lead', branchId: a.id });
  const hrA = await seedUser(db, { role: 'hr_lead', branchId: a.id });
  const editor = await seedUser(db, { role: 'content_editor' });
  const approved = await seedReport(db, {
    branchId: a.id,
    weekStart: '2026-10-19',
    status: 'approved',
    submittedBy: leadA.id,
    reviewedBy: finance.id,
    collections: [{ amount: '1500.00', createdBy: leadA.id }],
  });
  const submitted = await seedReport(db, {
    branchId: a.id,
    weekStart: '2026-10-26',
    status: 'submitted',
    submittedBy: leadA.id,
    collections: [{ amount: '700.00', createdBy: leadA.id }],
  });
  approvedId = approved.collectionIds[0]!;
  submittedId = submitted.collectionIds[0]!;
  cookies = {
    admin: await createSessionCookie(db, admin.id),
    finance: await createSessionCookie(db, finance.id),
    leadA: await createSessionCookie(db, leadA.id),
    hrA: await createSessionCookie(db, hrA.id),
    editor: await createSessionCookie(db, editor.id),
  };
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('POST and DELETE /api/v1/collections/:id/routed', () => {
  it('marks, refuses a repeat, undoes and refuses a repeat undo', async () => {
    const marked = await send(POST, 'POST', approvedId, { cookie: cookies.finance });
    expect(marked.status).toBe(200);
    const { data } = await marked.json();
    expect(data).toEqual({ collectionId: approvedId, routedAt: expect.any(String) });
    expect(new Date(data.routedAt).toISOString()).toBe(data.routedAt);
    expect((await routedAt(approvedId))?.toISOString()).toBe(data.routedAt);

    const again = await send(POST, 'POST', approvedId, { cookie: cookies.admin });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('already_routed');

    const undone = await send(DELETE, 'DELETE', approvedId, { cookie: cookies.finance });
    expect(undone.status).toBe(200);
    expect((await undone.json()).data).toEqual({ collectionId: approvedId, routedAt: null });
    expect(await routedAt(approvedId)).toBeNull();

    const undoAgain = await send(DELETE, 'DELETE', approvedId, { cookie: cookies.admin });
    expect(undoAgain.status).toBe(409);
    expect((await undoAgain.json()).error.code).toBe('not_routed');
    expect(await auditCount()).toBe(2);
  });

  it('refuses a missing or foreign Origin and leaves the collection unrouted', async () => {
    for (const bad of [null, 'https://evil.example']) {
      const res = await send(POST, 'POST', approvedId, { cookie: cookies.finance, origin: bad });
      expect(res.status).toBe(403);
    }
    expect(await routedAt(approvedId)).toBeNull();
    expect(await auditCount()).toBe(0);
  });

  it('gives 403 to branch lead, hr lead and content editor, and 401 without a session', async () => {
    await send(POST, 'POST', approvedId, { cookie: cookies.finance });
    for (const cookie of [cookies.leadA, cookies.hrA, cookies.editor]) {
      expect((await send(POST, 'POST', submittedId, { cookie })).status).toBe(403);
      expect((await send(DELETE, 'DELETE', approvedId, { cookie })).status).toBe(403);
    }
    expect((await send(POST, 'POST', submittedId)).status).toBe(401);
    expect((await send(DELETE, 'DELETE', approvedId)).status).toBe(401);
    expect(await routedAt(approvedId)).not.toBeNull();
    expect(await auditCount()).toBe(1);
  });

  it('gives identical 404 bodies for a random uuid and a malformed id', async () => {
    for (const [handler, method] of [
      [POST, 'POST'],
      [DELETE, 'DELETE'],
    ] as const) {
      const missing = await send(handler, method, randomUUID(), { cookie: cookies.finance });
      const malformed = await send(handler, method, 'not-a-uuid', { cookie: cookies.finance });
      expect(missing.status).toBe(404);
      expect(malformed.status).toBe(404);
      expect(withoutRequestId(await missing.json())).toEqual(
        withoutRequestId(await malformed.json()),
      );
    }
  });

  it('refuses a collection of a submitted report with 409 not_approved', async () => {
    const res = await send(POST, 'POST', submittedId, { cookie: cookies.finance });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('not_approved');
    expect(await routedAt(submittedId)).toBeNull();
    expect(await auditCount()).toBe(0);
  });
});
