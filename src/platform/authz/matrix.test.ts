import { describe, expect, it } from 'vitest';
import { Forbidden } from '../errors';
import { authorize } from './index';
import type { Actor } from './index';
import { PERMISSIONS } from './permissions';
import type { Action, ScopeGrant } from './permissions';
import { BRANCH_SCOPED_ROLES, ROLES } from './roles';
import type { Role } from './roles';

const BRANCH_ID = 'branch-under-test';
const actions = Object.keys(PERMISSIONS) as Action[];

function actorFor(role: Role): Actor {
  const branchScoped = (BRANCH_SCOPED_ROLES as readonly string[]).includes(role);
  return { userId: `user-${role}`, role, branchId: branchScoped ? BRANCH_ID : null };
}

function grantFor(action: Action, role: Role): ScopeGrant | undefined {
  return (PERMISSIONS[action] as Partial<Record<Role, ScopeGrant>>)[role];
}

describe('role x action matrix (generated from PERMISSIONS)', () => {
  it('generates a case for every action and role', () => {
    expect(actions.length).toBeGreaterThan(0);
    const granted = actions.reduce(
      (n, action) => n + ROLES.filter((role) => grantFor(action, role) !== undefined).length,
      0,
    );
    const denied = actions.length * ROLES.length - granted;
    expect(granted).toBeGreaterThan(0);
    expect(denied).toBeGreaterThan(0);
  });

  for (const action of actions) {
    describe(action, () => {
      for (const role of ROLES) {
        const grant = grantFor(action, role);
        if (grant === undefined) {
          it(`${role} x ${action}: denied with 403`, () => {
            let thrown: unknown;
            try {
              authorize(actorFor(role), action);
            } catch (err) {
              thrown = err;
            }
            expect(thrown).toBeInstanceOf(Forbidden);
            expect((thrown as Forbidden).status).toBe(403);
          });
        } else if (grant === 'all') {
          it(`${role} x ${action}: granted, scope all`, () => {
            expect(authorize(actorFor(role), action).kind).toBe('all');
          });
        } else {
          it(`${role} x ${action}: granted, scope own branch`, () => {
            expect(authorize(actorFor(role), action)).toMatchObject({
              kind: 'branch',
              branchId: BRANCH_ID,
            });
          });
          it(`${role} x ${action}: denied when the actor has no branch`, () => {
            expect(() => authorize({ ...actorFor(role), branchId: null }, action)).toThrow(
              Forbidden,
            );
          });
        }
      }
    });
  }
});
