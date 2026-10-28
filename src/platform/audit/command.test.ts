import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../authz/actor';
import { fixedClock } from '../time';
import { COMMANDS_WITHOUT_AUDIT, COMMAND_NAMES_SEEN, SYSTEM_COMMANDS, command } from './command';
import type { CommandContext } from './types';

const TOUCHED = 'pool was touched';

// A pool that throws on any use: proves the guards reject before a transaction is opened.
function throwingPool(): Pool {
  return {
    connect: () => {
      throw new Error(TOUCHED);
    },
    query: () => {
      throw new Error(TOUCHED);
    },
  } as unknown as Pool;
}

// A pool whose client accepts any statement, for tests that need a transaction to open.
function fakePool() {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client, statements };
}

const actor: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'branch_lead',
  branchId: null,
};

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    actor,
    requestId: 'req-1',
    clock: fixedClock('2026-10-28T10:00:00Z'),
    pool: throwingPool(),
    ...overrides,
  };
}

const noop = async () => 'ok';

describe('allowlists', () => {
  it('start with the failed-login system command only', () => {
    expect([...SYSTEM_COMMANDS]).toEqual(['auth.record_failed_login']);
    expect([...COMMANDS_WITHOUT_AUDIT]).toEqual(['auth.record_failed_login']);
  });
});

describe('command guards', () => {
  it('rejects audit none for a name that is not allowlisted, before touching the pool', async () => {
    await expect(command(ctx(), 'collections.create', noop, { audit: 'none' })).rejects.toThrow(
      /collections\.create.*audit/i,
    );
  });

  it('rejects a null actor for a normal command, before touching the pool', async () => {
    await expect(command(ctx({ actor: null }), 'collections.create', noop)).rejects.toThrow(
      /collections\.create.*actor/i,
    );
  });

  it('rejects a null actor for auth.login', async () => {
    const fn = vi.fn(noop);
    await expect(command(ctx({ actor: null }), 'auth.login', fn)).rejects.toThrow(
      /auth\.login.*actor/i,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('accepts a null actor for a system command (reaches the pool)', async () => {
    await expect(
      command(ctx({ actor: null }), 'auth.record_failed_login', noop, { audit: 'none' }),
    ).rejects.toThrow(TOUCHED);
  });

  it('accepts a system command called with a real actor (reaches the pool)', async () => {
    await expect(
      command(ctx(), 'auth.record_failed_login', noop, { audit: 'none' }),
    ).rejects.toThrow(TOUCHED);
  });

  it('accepts a normal command with an actor (reaches the pool)', async () => {
    await expect(command(ctx(), 'collections.create', noop)).rejects.toThrow(TOUCHED);
  });

  it('records the command name for the later registry test', async () => {
    await command(ctx({ actor: null }), 'zzz.not_allowed', noop).catch(() => {});
    expect(COMMAND_NAMES_SEEN.has('zzz.not_allowed')).toBe(true);
  });
});

describe('one command per context', () => {
  it('rejects a second command while one is in flight and clears the marker afterwards', async () => {
    const { pool, client } = fakePool();
    const c = ctx({ pool });
    let nestedError: unknown;

    await command(
      c,
      'auth.record_failed_login',
      async () => {
        nestedError = await command(c, 'auth.record_failed_login', noop, { audit: 'none' }).catch(
          (e) => e,
        );
        return 1;
      },
      { audit: 'none' },
    );

    expect(nestedError).toBeInstanceOf(Error);
    expect((nestedError as Error).message).toMatch(/already/i);
    // a rejected nested call must not have opened a second connection
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);

    // sequential reuse of the same ctx is fine
    await command(c, 'auth.record_failed_login', noop, { audit: 'none' });
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight marker when the command fails', async () => {
    const { pool } = fakePool();
    const c = ctx({ pool });
    await expect(
      command(
        c,
        'auth.record_failed_login',
        async () => {
          throw new Error('boom');
        },
        { audit: 'none' },
      ),
    ).rejects.toThrow('boom');
    await expect(command(c, 'auth.record_failed_login', noop, { audit: 'none' })).resolves.toBe(
      'ok',
    );
  });
});
