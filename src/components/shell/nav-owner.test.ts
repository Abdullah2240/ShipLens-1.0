import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/platform/authz/permissions';
import { ROLES, type Role } from '@/platform/authz/roles';
import { appNav, navForRole } from './nav';

const APP_DIR = path.resolve(import.meta.dirname, '../../app/[locale]/(app)');
const OWNER_ITEMS = ['branches', 'collections', 'reports'] as const;

const ownerIds = (role: Role | null) =>
  navForRole(appNav, role)
    .map((item) => item.id)
    .filter((id) => (OWNER_ITEMS as readonly string[]).includes(id));

/** Owner items whose required action the permission table grants to the role, in appNav order. */
function permittedOwnerIds(role: Role): string[] {
  return appNav
    .filter((item) => (OWNER_ITEMS as readonly string[]).includes(item.id))
    .filter((item) => {
      const grants: Partial<Record<Role, unknown>> = PERMISSIONS[item.requiredAction!];
      return grants[role] !== undefined;
    })
    .map((item) => item.id);
}

describe('branches, collections and reports navigation', () => {
  it.each(OWNER_ITEMS)('the %s entry is live, guarded and points to an existing page', (id) => {
    const item = appNav.find((entry) => entry.id === id);
    expect(item?.live).toBe(true);
    expect(item?.requiredAction).toBeDefined();
    expect(existsSync(path.join(APP_DIR, item!.href, 'page.tsx'))).toBe(true);
  });

  it.each(ROLES)('shows %s exactly the owner entries its permissions allow', (role) => {
    expect(ownerIds(role)).toEqual(permittedOwnerIds(role));
  });

  it.each([
    ['super_admin', ['branches', 'collections', 'reports']],
    ['finance_reviewer', ['branches', 'collections', 'reports']],
    ['branch_lead', ['branches', 'collections', 'reports']],
    ['hr_lead', ['branches']],
    ['content_editor', []],
  ] as const)('gives %s the owner entries %j', (role, expected) => {
    expect(ownerIds(role)).toEqual(expected);
  });

  it('shows nothing when signed out', () => {
    expect(navForRole(appNav, null)).toEqual([]);
  });
});
