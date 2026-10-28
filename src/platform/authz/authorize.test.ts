import { describe, expect, it } from 'vitest';
import { Forbidden } from '../errors';
import { authorize, scopeAllowsBranch, scopeWhere } from './index';
import type { Actor, Scope } from './index';
import type { Action } from './permissions';

const branchLead = (branchId: string | null): Actor => ({
  userId: 'u1',
  role: 'branch_lead',
  branchId,
});

describe('authorize', () => {
  it('returns an all scope for a role granted all', () => {
    const scope = authorize({ userId: 'u1', role: 'super_admin', branchId: null }, 'branch.create');
    expect(scope.kind).toBe('all');
  });

  it('returns a branch scope bound to the actor branch', () => {
    const scope = authorize(branchLead('b1'), 'collection.create');
    expect(scope).toMatchObject({ kind: 'branch', branchId: 'b1' });
  });

  it('denies a role missing from the table with Forbidden 403', () => {
    expect(() => authorize(branchLead('b1'), 'branch.create')).toThrow(Forbidden);
    try {
      authorize(branchLead('b1'), 'branch.create');
    } catch (err) {
      expect((err as Forbidden).status).toBe(403);
    }
  });

  it('denies a branch-scoped role that has no branch', () => {
    expect(() => authorize(branchLead(null), 'collection.create')).toThrow(Forbidden);
  });

  it('does not require a branch for an all-scope grant', () => {
    expect(() =>
      authorize({ userId: 'u', role: 'finance_reviewer', branchId: null }, 'report.approve'),
    ).not.toThrow();
  });

  it('fails closed on an unknown action', () => {
    expect(() => authorize(branchLead('b1'), 'nope.nothing' as Action)).toThrow(Forbidden);
  });

  it('fails closed on an inherited object key used as an action', () => {
    expect(() => authorize(branchLead('b1'), 'constructor' as Action)).toThrow(Forbidden);
    expect(() => authorize(branchLead('b1'), '__proto__' as Action)).toThrow(Forbidden);
  });

  it('fails closed on an unknown role', () => {
    const actor = { userId: 'u', role: 'intruder', branchId: null } as unknown as Actor;
    expect(() => authorize(actor, 'branch.read')).toThrow(Forbidden);
  });
});

describe('scopeWhere', () => {
  const all = authorize({ userId: 'u', role: 'super_admin', branchId: null }, 'branch.read');
  const branch = authorize(branchLead('b1'), 'branch.read');

  it('produces TRUE with no params for an all scope', () => {
    expect(scopeWhere(all, 'c.branch_id')).toEqual({ sql: 'TRUE', params: [] });
  });

  it('produces a parameterised equality for a branch scope', () => {
    expect(scopeWhere(branch, 'c.branch_id', 3)).toEqual({
      sql: 'c.branch_id = $3',
      params: ['b1'],
    });
  });

  it('defaults the first parameter to $1', () => {
    expect(scopeWhere(branch, 'branch_id')).toEqual({ sql: 'branch_id = $1', params: ['b1'] });
  });

  it.each(['id; DROP TABLE x', "a' OR '1'='1", '', '1abc', 'a b', 'a-b', 'a.b)--'])(
    'rejects unsafe column %j',
    (column) => {
      expect(() => scopeWhere(all, column)).toThrow();
      expect(() => scopeWhere(branch, column)).toThrow();
    },
  );

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid parameter index %s', (index) => {
    expect(() => scopeWhere(branch, 'id', index)).toThrow();
  });
});

describe('scopeAllowsBranch', () => {
  it('allows any branch for an all scope', () => {
    const all = authorize({ userId: 'u', role: 'super_admin', branchId: null }, 'branch.read');
    expect(scopeAllowsBranch(all, 'anything')).toBe(true);
  });

  it('allows only the own branch for a branch scope', () => {
    const branch = authorize(branchLead('b1'), 'branch.read');
    expect(scopeAllowsBranch(branch, 'b1')).toBe(true);
    expect(scopeAllowsBranch(branch, 'b2')).toBe(false);
  });
});

describe('Scope brand', () => {
  // A repository-style function that demands a Scope value.
  function getById(_db: unknown, scope: Scope, id: string): string {
    return `${scope.kind}:${id}`;
  }

  it('accepts a minted scope and rejects a hand-built literal at compile time', () => {
    const scope = authorize({ userId: 'u', role: 'super_admin', branchId: null }, 'branch.read');
    expect(getById(null, scope, 'x')).toBe('all:x');
    // @ts-expect-error an object literal is not a Scope; only authorize() can mint one
    expect(getById(null, { kind: 'all' }, 'x')).toBe('all:x');
    // @ts-expect-error a branch literal is not a Scope either
    expect(getById(null, { kind: 'branch', branchId: 'b1' }, 'x')).toBe('branch:x');
  });
});
