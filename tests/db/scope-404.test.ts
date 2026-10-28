import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/platform/authz';
import { authorize } from '@/platform/authz';
import { Forbidden, NotFound, mapError } from '@/platform/errors';
import { getBranchById } from '../support/probe-repo';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';

const REQUEST_ID = 'req-fixed';

let branchA: Awaited<ReturnType<typeof seedBranch>>;
let branchB: Awaited<ReturnType<typeof seedBranch>>;
let leadA: Actor;
let admin: Actor;
let contentEditor: Actor;

beforeAll(async () => {
  const pool = testPool();
  await resetDb(pool);
  branchA = await seedBranch(pool);
  branchB = await seedBranch(pool);
  const lead = await seedUser(pool, { role: 'branch_lead', branchId: branchA.id });
  const sa = await seedUser(pool, { role: 'super_admin' });
  const ce = await seedUser(pool, { role: 'content_editor' });
  leadA = { userId: lead.id, role: 'branch_lead', branchId: branchA.id };
  admin = { userId: sa.id, role: 'super_admin', branchId: null };
  contentEditor = { userId: ce.id, role: 'content_editor', branchId: null };
});

afterAll(async () => {
  await closeTestPool();
});

async function mappedFailure(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(NotFound);
    return JSON.stringify(mapError(err, REQUEST_ID));
  }
  throw new Error('expected NotFound');
}

describe('403 vs identical 404', () => {
  it('gives out-of-scope, missing and malformed ids byte-identical 404 responses', async () => {
    const scope = authorize(leadA, 'branch.read');
    const pool = testPool();

    const outOfScope = await mappedFailure(() => getBranchById(pool, scope, branchB.id));
    const missing = await mappedFailure(() => getBranchById(pool, scope, randomUUID()));
    const malformed = await mappedFailure(() => getBranchById(pool, scope, 'not-a-uuid'));

    expect(outOfScope).toBe(missing);
    expect(outOfScope).toBe(malformed);
    expect(JSON.parse(outOfScope).status).toBe(404);
  });

  it('lets a branch lead read the own branch', async () => {
    const scope = authorize(leadA, 'branch.read');
    const row = await getBranchById(testPool(), scope, branchA.id);
    expect(row.id).toBe(branchA.id);
  });

  it('lets an all-scope role read any branch', async () => {
    const scope = authorize(admin, 'branch.read');
    const row = await getBranchById(testPool(), scope, branchB.id);
    expect(row.id).toBe(branchB.id);
  });

  it('throws Forbidden before any query when the role lacks the action', async () => {
    const pool = testPool();
    const spy = vi.spyOn(pool, 'query');
    try {
      let thrown: unknown;
      try {
        const scope = authorize(contentEditor, 'branch.read');
        await getBranchById(pool, scope, branchA.id);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Forbidden);
      expect(mapError(thrown, REQUEST_ID).status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
