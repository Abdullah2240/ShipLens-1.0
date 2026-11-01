import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Role } from '@/platform/authz/roles';
import { appNav, navForRole, publicNav } from './nav';

const APP_DIR = path.resolve(import.meta.dirname, '../../app/[locale]/(app)');
const PUBLIC_DIR = path.resolve(import.meta.dirname, '../../app/[locale]/(public)');
const HEAD_OFFICE_ITEMS = ['dashboard', 'audit'] as const;

const ids = (role: Role | null) => navForRole(appNav, role).map((item) => item.id);

describe('head office navigation', () => {
  it.each([
    ['dashboard', 'dashboard.read'],
    ['audit', 'audit.read_finance'],
  ] as const)(
    'the %s entry is live, guarded by %s and points to an existing page',
    (id, action) => {
      const item = appNav.find((entry) => entry.id === id);
      expect(item?.live).toBe(true);
      expect(item?.requiredAction).toBe(action);
      expect(existsSync(path.join(APP_DIR, item!.href, 'page.tsx'))).toBe(true);
    },
  );

  it.each(['super_admin', 'finance_reviewer'] as const)(
    'shows %s the dashboard and the audit log',
    (role) => {
      expect(ids(role)).toEqual(expect.arrayContaining([...HEAD_OFFICE_ITEMS]));
    },
  );

  it.each(['branch_lead', 'hr_lead', 'content_editor'] as const)(
    'shows %s neither the dashboard nor the audit log',
    (role) => {
      const visible = ids(role);
      for (const id of HEAD_OFFICE_ITEMS) expect(visible).not.toContain(id);
    },
  );

  it('shows nothing when signed out', () => {
    expect(ids(null)).toEqual([]);
  });
});

describe('public impact navigation', () => {
  it('adds the impact item right after events', () => {
    const at = publicNav.findIndex((item) => item.id === 'events');
    expect(publicNav[at + 1]).toEqual({
      id: 'impact',
      href: '/impact',
      labelKey: 'nav.impact',
      live: true,
    });
  });

  it('points to an existing public page', () => {
    expect(existsSync(path.join(PUBLIC_DIR, 'impact', 'page.tsx'))).toBe(true);
  });
});
