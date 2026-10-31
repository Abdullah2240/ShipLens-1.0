import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPool: vi.fn() }));
vi.mock('@/platform/db', () => ({ getPool: mocks.getPool }));

import { GET as healthGet } from './route';
import { GET as dbHealthGet } from './db/route';
import { createDbHealthHandler, createHealthHandler } from './handlers';

// recorded before any test runs: importing the routes must not create a pool
const getPoolCallsAtImport = mocks.getPool.mock.calls.length;

afterEach(() => {
  vi.useRealTimers();
  mocks.getPool.mockReset();
});

const SECRET_DETAIL = 'connect ECONNREFUSED 10.0.0.7:5432 postgres://shiplens:hunter2@db/shiplens';

describe('GET /api/health', () => {
  it('answers 200 ok with no-store and touches no database', async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(mocks.getPool).not.toHaveBeenCalled();
  });

  it('the factory needs no pool', async () => {
    const res = await createHealthHandler()();
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /api/health/db', () => {
  it('importing the route does not create a pool', () => {
    expect(getPoolCallsAtImport).toBe(0);
  });

  it('answers 200 when SELECT 1 succeeds', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const res = await createDbHealthHandler(() => ({ query }))();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', db: 'up' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('answers 503 with no error detail when the query rejects', async () => {
    const query = vi.fn().mockRejectedValue(new Error(SECRET_DETAIL));
    const res = await createDbHealthHandler(() => ({ query }))();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'error', db: 'down' });
    expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.7|postgres:|hunter2/);
  });

  it('answers 503 when getPool itself throws (for example missing configuration)', async () => {
    const res = await createDbHealthHandler(() => {
      throw new Error('Invalid environment configuration: DATABASE_URL');
    })();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'error', db: 'down' });
    expect(text).not.toContain('DATABASE_URL');
  });

  it('answers 503 when the query hangs past 2 seconds, and clears its timer', async () => {
    vi.useFakeTimers();
    const query = vi.fn(() => new Promise(() => {}));
    const pending = createDbHealthHandler(() => ({ query }))();
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error', db: 'down' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the query answers quickly', async () => {
    vi.useFakeTimers();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const res = await createDbHealthHandler(() => ({ query }))();
    expect(res.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the default export uses getPool from platform/db inside the handler', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    mocks.getPool.mockReturnValue({ query });
    const res = await dbHealthGet();
    expect(res.status).toBe(200);
    expect(mocks.getPool).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });
});
