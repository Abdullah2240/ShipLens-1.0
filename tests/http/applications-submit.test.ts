import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/public/applications/route';
import { applicationRateLimiter } from '@/modules/applications/rate-limit';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, seedBranch, testPool } from '../support/db';

const db = testPool();
const endpoint = 'http://localhost:3000/api/v1/public/applications';

function send(body: unknown, options: { origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': options.ip ?? '203.0.113.1',
  };
  if (options.origin !== null) headers.origin = options.origin ?? 'http://localhost:3000';
  return POST(new Request(endpoint, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({}),
  });
}

function valid(branchId: string, email = 'Ali@Example.com') {
  return { fullName: 'Ali Khan', email, phone: '03001234567', branchId };
}

async function count(table: 'applications' | 'audit_events') {
  const result = await db.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count);
}

beforeEach(async () => {
  applicationRateLimiter.reset();
  await resetDb(db);
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('POST /api/v1/public/applications', () => {
  it('stores a valid submission and responds without caching', async () => {
    const branch = await seedBranch(db);
    const response = await send(valid(branch.id));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await count('applications')).toBe(1);
  });

  it.each([null, 'https://elsewhere.test'])('rejects origin %s before storing', async (origin) => {
    const branch = await seedBranch(db);
    const response = await send(valid(branch.id), { origin });
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await count('applications')).toBe(0);
  });

  it('reports stable field errors', async () => {
    const response = await send({ ...valid(randomUUID()), email: 'bad', phone: 'bad' });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'email', message: 'invalid_email' }),
        expect.objectContaining({ path: 'phone', message: 'invalid_phone' }),
      ]),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers a filled honeypot like success without storing or auditing', async () => {
    const branch = await seedBranch(db);
    const success = await send(valid(branch.id), { ip: '203.0.113.2' });
    const honey = await send(
      { ...valid(branch.id), website: 'http://spam.test' },
      { ip: '203.0.113.3' },
    );
    expect(honey.status).toBe(success.status);
    expect(await honey.json()).toEqual(await success.json());
    expect(await count('applications')).toBe(1);
    expect(await count('audit_events')).toBe(1);
  });

  it('rejects a duplicate pending application', async () => {
    const branch = await seedBranch(db);
    await send(valid(branch.id));
    const response = await send(valid(branch.id, 'ALI@EXAMPLE.COM'));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('duplicate_application');
    expect(await count('applications')).toBe(1);
  });

  it.each(['forming', 'paused', 'closed'] as const)('rejects %s branch', async (status) => {
    const branch = await seedBranch(db, { status });
    const response = await send(valid(branch.id));
    expect(response.status).toBe(422);
    expect((await response.json()).error.details.fields).toEqual([
      expect.objectContaining({ path: 'branchId', code: 'invalid_branch' }),
    ]);
    expect(await count('applications')).toBe(0);
  });

  it('rejects an unknown branch', async () => {
    const response = await send(valid(randomUUID()));
    expect(response.status).toBe(422);
    expect((await response.json()).error.details.fields).toEqual([
      expect.objectContaining({ path: 'branchId', code: 'invalid_branch' }),
    ]);
  });

  it('limits the sixth request by IP and leaves a different IP unaffected', async () => {
    const branch = await seedBranch(db);
    for (let n = 0; n < 5; n++) {
      const response = await send(valid(branch.id, `applicant${n}@example.test`), {
        ip: '203.0.113.9',
      });
      expect(response.status).toBe(201);
    }
    const limited = await send(valid(branch.id, 'sixth@example.test'), { ip: '203.0.113.9' });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('rate_limited');
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
    const other = await send(valid(branch.id, 'other@example.test'), { ip: '203.0.113.10' });
    expect(other.status).toBe(201);
    expect(await count('applications')).toBe(6);
  });
});
