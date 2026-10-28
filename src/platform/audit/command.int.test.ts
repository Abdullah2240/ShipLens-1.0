import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../authz/actor';
import { fixedClock } from '../time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { MissingAuditError, command } from './command';
import type { AuditRow, CommandContext } from './types';

const pool = testPool();

afterAll(async () => {
  await closeTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

async function makeActor(role: 'branch_lead' | 'super_admin' = 'super_admin'): Promise<Actor> {
  const branch = role === 'branch_lead' ? await seedBranch(pool) : null;
  const user = await seedUser(pool, { role, branchId: branch?.id });
  return { userId: user.id, role, branchId: branch?.id ?? null };
}

function ctxFor(actor: Actor | null, requestId = 'req-int-1'): CommandContext {
  return { actor, requestId, clock: fixedClock('2026-10-28T10:00:00Z'), pool };
}

// Reads through the pool (a different connection from the command transaction).
async function auditRows(): Promise<AuditRow[]> {
  const { rows } = await pool.query<AuditRow>('SELECT * FROM audit_events ORDER BY id');
  return rows;
}

async function branchCount(code: string): Promise<number> {
  const { rows } = await pool.query('SELECT 1 FROM branches WHERE code = $1', [code]);
  return rows.length;
}

describe('command: atomic audit write', () => {
  it('writes the domain row and one audit row with actor, request id and changed fields', async () => {
    const actor = await makeActor();
    const branchId = await command(ctxFor(actor), 'branches.create', async (tx, audit) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO branches (code, name, city, status) VALUES ('AUD-1', 'Audit One', 'Lahore', 'active') RETURNING id",
      );
      const id = rows[0]!.id;
      audit({
        action: 'branch.create',
        entityType: 'branch',
        entityId: id,
        branchId: id,
        after: { code: 'AUD-1', name: 'Audit One', city: 'Lahore', status: 'active' },
      });
      return id;
    });

    expect(await branchCount('AUD-1')).toBe(1);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.actor_id).toBe(actor.userId);
    expect(row.actor_role).toBe('super_admin');
    expect(row.request_id).toBe('req-int-1');
    expect(row.action).toBe('branch.create');
    expect(row.entity_type).toBe('branch');
    expect(row.entity_id).toBe(branchId);
    expect(row.branch_id).toBe(branchId);
    expect(row.report_id).toBeNull();
    expect(row.before).toBeNull();
    expect(row.after).toEqual({
      code: 'AUD-1',
      name: 'Audit One',
      city: 'Lahore',
      status: 'active',
    });
    expect(row.occurred_at).toBeInstanceOf(Date);
  });

  it('records only changed allowlisted fields for an update', async () => {
    const actor = await makeActor();
    const branch = await seedBranch(pool, { name: 'Before', city: 'Karachi' });
    await command(ctxFor(actor), 'branches.update', async (tx, audit) => {
      await tx.query('UPDATE branches SET name = $1 WHERE id = $2', ['After', branch.id]);
      audit({
        action: 'branch.update',
        entityType: 'branch',
        entityId: branch.id,
        branchId: branch.id,
        before: { name: 'Before', city: 'Karachi' },
        after: { name: 'After', city: 'Karachi' },
      });
    });
    const [row] = await auditRows();
    expect(row!.before).toEqual({ name: 'Before' });
    expect(row!.after).toEqual({ name: 'After' });
  });

  it('writes two audit rows in call order', async () => {
    const actor = await makeActor();
    await command(ctxFor(actor), 'branches.create_pair', async (tx, audit) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO branches (code, name) VALUES ('AUD-A', 'A') RETURNING id",
      );
      audit({ action: 'branch.first', entityType: 'branch', entityId: rows[0]!.id });
      audit({ action: 'branch.second', entityType: 'branch', entityId: rows[0]!.id });
    });
    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['branch.first', 'branch.second']);
    expect(BigInt(rows[0]!.id)).toBeLessThan(BigInt(rows[1]!.id));
  });

  it('records a branch_lead actor with its id and role', async () => {
    const actor = await makeActor('branch_lead');
    await command(ctxFor(actor), 'auth.login', async (_tx, audit) => {
      audit({
        action: 'auth.login',
        entityType: 'session',
        entityId: 'session-1',
        branchId: actor.branchId,
      });
    });
    const [row] = await auditRows();
    expect(row!.actor_id).toBe(actor.userId);
    expect(row!.actor_role).toBe('branch_lead');
    expect(row!.branch_id).toBe(actor.branchId);
  });
});

describe('command: rollback', () => {
  it('leaves neither the change nor the audit row when fn throws after audit()', async () => {
    const actor = await makeActor();
    await expect(
      command(ctxFor(actor), 'branches.create', async (tx, audit) => {
        const { rows } = await tx.query<{ id: string }>(
          "INSERT INTO branches (code, name) VALUES ('AUD-RB', 'Rolled back') RETURNING id",
        );
        audit({ action: 'branch.create', entityType: 'branch', entityId: rows[0]!.id });
        throw new Error('boom after audit');
      }),
    ).rejects.toThrow('boom after audit');

    expect(await branchCount('AUD-RB')).toBe(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it('fails and rolls back the change when audit() gets an unknown entity type', async () => {
    const actor = await makeActor();
    await expect(
      command(ctxFor(actor), 'branches.create', async (tx, audit) => {
        await tx.query(
          "INSERT INTO branches (code, name) VALUES ('AUD-UNK', 'Unknown') RETURNING id",
        );
        audit({ action: 'x.create', entityType: 'mystery', entityId: '1' });
      }),
    ).rejects.toThrow(/unknown audit entity/i);

    expect(await branchCount('AUD-UNK')).toBe(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it('still fails when fn swallows an invalid audit() call', async () => {
    const actor = await makeActor();
    await expect(
      command(ctxFor(actor), 'branches.create', async (tx, audit) => {
        await tx.query("INSERT INTO branches (code, name) VALUES ('AUD-SW', 'Swallowed')");
        try {
          audit({ action: 'x.create', entityType: 'mystery', entityId: '1' });
        } catch {
          // deliberately ignored: command() must still refuse to commit
        }
        audit({ action: 'branch.create', entityType: 'branch', entityId: '1' });
      }),
    ).rejects.toThrow(/unknown audit entity/i);

    expect(await branchCount('AUD-SW')).toBe(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it('rejects with MissingAuditError and rolls back when no audit event was emitted', async () => {
    const actor = await makeActor();
    await expect(
      command(ctxFor(actor), 'branches.create', async (tx) => {
        await tx.query("INSERT INTO branches (code, name) VALUES ('AUD-NONE', 'No audit')");
      }),
    ).rejects.toBeInstanceOf(MissingAuditError);

    expect(await branchCount('AUD-NONE')).toBe(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it('rolls back the domain change when the audit insert itself fails', async () => {
    const actor = await makeActor();
    await expect(
      command(ctxFor(actor), 'branches.create', async (tx, audit) => {
        await tx.query("INSERT INTO branches (code, name) VALUES ('AUD-BAD', 'Bad audit')");
        // branch_id is a uuid column, so a non-uuid value fails at insert time
        audit({
          action: 'branch.create',
          entityType: 'branch',
          entityId: '1',
          branchId: 'not-a-uuid',
        });
      }),
    ).rejects.toThrow();

    expect(await branchCount('AUD-BAD')).toBe(0);
    expect(await auditRows()).toHaveLength(0);
  });
});

describe('command: system commands', () => {
  it('commits a null-actor system command with audit none and no audit row', async () => {
    await command(
      ctxFor(null),
      'auth.record_failed_login',
      async (tx) => {
        await tx.query("INSERT INTO branches (code, name) VALUES ('AUD-SYS', 'System')");
      },
      { audit: 'none' },
    );
    expect(await branchCount('AUD-SYS')).toBe(1);
    expect(await auditRows()).toHaveLength(0);
  });

  it('records the actor when a system command name is run with a real actor', async () => {
    const actor = await makeActor('branch_lead');
    await command(ctxFor(actor), 'auth.record_failed_login', async (_tx, audit) => {
      audit({ action: 'auth.failed_login', entityType: 'session', entityId: 'n/a' });
    });
    const [row] = await auditRows();
    expect(row!.actor_id).toBe(actor.userId);
    expect(row!.actor_role).toBe('branch_lead');
  });

  it('records actor_role system with a null actor_id when a system command audits', async () => {
    await command(ctxFor(null), 'auth.record_failed_login', async (_tx, audit) => {
      audit({ action: 'auth.failed_login', entityType: 'session', entityId: 'n/a' });
    });
    const [row] = await auditRows();
    expect(row!.actor_id).toBeNull();
    expect(row!.actor_role).toBe('system');
  });
});

describe('command: connection handling', () => {
  it('releases the client after success and failure', async () => {
    const actor = await makeActor();
    await command(ctxFor(actor), 'branches.noop', async (_tx, audit) => {
      audit({ action: 'branch.noop', entityType: 'branch', entityId: '1' });
    });
    await command(ctxFor(actor), 'branches.noop', async () => undefined).catch(() => {});
    expect(pool.idleCount).toBe(pool.totalCount);
  });
});
