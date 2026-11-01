import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditEventInput, CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { Conflict, Forbidden, NotFound, Unauthenticated } from '@/platform/errors';
import { fixedClock } from '@/platform/time';

// The routing service decides on what the repo reports; the repo and the transaction are
// replaced here so the lost-race and guard-mapping paths can be driven directly.
const mocks = vi.hoisted(() => ({
  lockCollectionForRouting: vi.fn(),
  setRouted: vi.fn(),
  clearRouted: vi.fn(),
  command: vi.fn(),
  audited: [] as AuditEventInput[],
}));

vi.mock('./repo-routing', () => ({
  lockCollectionForRouting: mocks.lockCollectionForRouting,
  setRouted: mocks.setRouted,
  clearRouted: mocks.clearRouted,
}));

vi.mock('@/platform/audit/command', () => ({ command: mocks.command }));

import { markCollectionRouted, unmarkCollectionRouted } from './service-routing';

const NOW = '2026-11-04T06:00:00.000Z';
const TX = { query: vi.fn() };
const ID = '11111111-1111-4111-8111-111111111111';

const finance: Actor = { userId: 'user-finance', role: 'finance_reviewer', branchId: null };
const lead: Actor = { userId: 'user-lead', role: 'branch_lead', branchId: 'branch-a' };

const ctx = (actor: Actor | null): CommandContext => ({
  actor,
  requestId: 'req-1',
  clock: fixedClock(NOW),
  pool: {} as Pool,
});

const target = (over: Partial<Record<string, unknown>> = {}) => ({
  id: ID,
  branchId: 'branch-a',
  reportId: 'report-a',
  status: 'active',
  reportStatus: 'approved',
  routedAt: null,
  ...over,
});

const pgGuard = (message: string, code = 'P0001') => Object.assign(new Error(message), { code });

mocks.command.mockImplementation(
  async (_ctx: CommandContext, _name: string, fn: (tx: unknown, audit: unknown) => unknown) =>
    fn(TX, (event: AuditEventInput) => mocks.audited.push(event)),
);

afterEach(() => {
  mocks.lockCollectionForRouting.mockReset();
  mocks.setRouted.mockReset();
  mocks.clearRouted.mockReset();
  mocks.command.mockClear();
  mocks.audited.length = 0;
});

describe('markCollectionRouted', () => {
  it('refuses a missing session before opening a transaction', async () => {
    await expect(markCollectionRouted(ctx(null), ID)).rejects.toBeInstanceOf(Unauthenticated);
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('refuses a branch lead before opening a transaction', async () => {
    await expect(markCollectionRouted(ctx(lead), ID)).rejects.toBeInstanceOf(Forbidden);
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('stamps the clock instant and the actor, and audits null to the stored value', async () => {
    mocks.lockCollectionForRouting.mockResolvedValue(target());
    mocks.setRouted.mockResolvedValue(NOW);

    await expect(markCollectionRouted(ctx(finance), ID)).resolves.toEqual({
      collectionId: ID,
      routedAt: NOW,
    });
    expect(mocks.command).toHaveBeenCalledWith(
      expect.anything(),
      'collection.mark_routed',
      expect.any(Function),
    );
    expect(mocks.lockCollectionForRouting).toHaveBeenCalledWith(TX, { kind: 'all' }, ID);
    const [, , at, actorId] = mocks.setRouted.mock.calls[0]!;
    expect((at as Date).toISOString()).toBe(NOW);
    expect(actorId).toBe('user-finance');
    expect(mocks.audited).toEqual([
      {
        action: 'collection.mark_routed',
        entityType: 'collection',
        entityId: ID,
        branchId: 'branch-a',
        reportId: 'report-a',
        before: { routed_at: null },
        after: { routed_at: NOW },
      },
    ]);
  });

  it.each([
    ['a voided collection', { status: 'voided' }],
    ['a submitted report', { reportStatus: 'submitted' }],
    ['a returned report', { reportStatus: 'returned' }],
  ])('answers not_approved for %s without writing', async (_label, over) => {
    mocks.lockCollectionForRouting.mockResolvedValue(target(over));
    await expect(markCollectionRouted(ctx(finance), ID)).rejects.toMatchObject({
      status: 409,
      code: 'not_approved',
    });
    expect(mocks.setRouted).not.toHaveBeenCalled();
    expect(mocks.audited).toEqual([]);
  });

  it('answers already_routed when the row is already marked', async () => {
    mocks.lockCollectionForRouting.mockResolvedValue(target({ routedAt: NOW }));
    await expect(markCollectionRouted(ctx(finance), ID)).rejects.toMatchObject({
      code: 'already_routed',
    });
    expect(mocks.setRouted).not.toHaveBeenCalled();
  });

  it('answers already_routed and audits nothing when a concurrent writer wins the update', async () => {
    mocks.lockCollectionForRouting.mockResolvedValue(target());
    mocks.setRouted.mockResolvedValue(null);
    await expect(markCollectionRouted(ctx(finance), ID)).rejects.toMatchObject({
      status: 409,
      code: 'already_routed',
    });
    expect(mocks.audited).toEqual([]);
  });

  it('maps a finance_guard refusal from the database to a 409 not_approved', async () => {
    mocks.lockCollectionForRouting.mockResolvedValue(target());
    mocks.setRouted.mockRejectedValue(pgGuard('finance_guard: report is not approved'));
    const error = await markCollectionRouted(ctx(finance), ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Conflict);
    expect(error).toMatchObject({ code: 'not_approved' });
  });

  it.each([
    ['another P0001 message', pgGuard('some other raise')],
    ['a finance_guard message under another SQLSTATE', pgGuard('finance_guard: x', '23514')],
    ['a P0001 error whose message is not a string', { code: 'P0001', message: 42 }],
    ['a non-object rejection', 'connection reset'],
    ['a null rejection', null],
  ])('passes %s through unchanged', async (_label, thrown) => {
    mocks.lockCollectionForRouting.mockResolvedValue(target());
    mocks.setRouted.mockImplementation(() => Promise.reject(thrown));
    const error = await markCollectionRouted(ctx(finance), ID).then(
      () => 'resolved',
      (e: unknown) => e,
    );
    expect(error).toBe(thrown);
  });

  it('passes a NotFound from the scoped lookup through unchanged', async () => {
    const missing = new NotFound();
    mocks.lockCollectionForRouting.mockRejectedValue(missing);
    await expect(markCollectionRouted(ctx(finance), ID)).rejects.toBe(missing);
  });
});

describe('unmarkCollectionRouted', () => {
  it('refuses a missing session before opening a transaction', async () => {
    await expect(unmarkCollectionRouted(ctx(null), ID)).rejects.toBeInstanceOf(Unauthenticated);
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('clears the mark and audits the stored value to null', async () => {
    mocks.lockCollectionForRouting.mockResolvedValue(target({ routedAt: NOW }));
    mocks.clearRouted.mockResolvedValue(true);

    await expect(unmarkCollectionRouted(ctx(finance), ID)).resolves.toEqual({
      collectionId: ID,
      routedAt: null,
    });
    expect((mocks.clearRouted.mock.calls[0]![2] as Date).toISOString()).toBe(NOW);
    expect(mocks.audited).toEqual([
      expect.objectContaining({
        action: 'collection.unmark_routed',
        entityId: ID,
        before: { routed_at: NOW },
        after: { routed_at: null },
      }),
    ]);
  });

  it('answers not_routed for an unrouted row without writing', async () => {
    mocks.lockCollectionForRouting.mockResolvedValue(target());
    await expect(unmarkCollectionRouted(ctx(finance), ID)).rejects.toMatchObject({
      code: 'not_routed',
    });
    expect(mocks.clearRouted).not.toHaveBeenCalled();
  });

  it('answers not_routed and audits nothing when a concurrent undo cleared it first', async () => {
    mocks.lockCollectionForRouting.mockResolvedValue(target({ routedAt: NOW }));
    mocks.clearRouted.mockResolvedValue(false);
    await expect(unmarkCollectionRouted(ctx(finance), ID)).rejects.toMatchObject({
      status: 409,
      code: 'not_routed',
    });
    expect(mocks.audited).toEqual([]);
  });

  it('maps a finance_guard refusal on undo to not_approved', async () => {
    mocks.lockCollectionForRouting.mockResolvedValue(target({ routedAt: NOW }));
    mocks.clearRouted.mockRejectedValue(pgGuard('finance_guard: immutable'));
    await expect(unmarkCollectionRouted(ctx(finance), ID)).rejects.toMatchObject({
      code: 'not_approved',
    });
  });
});
