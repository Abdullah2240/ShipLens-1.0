import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Role } from '@/platform/authz/roles';
import { appNav, navForRole } from './nav';

const APP_DIR = path.resolve(import.meta.dirname, '../../app/[locale]/(app)');
const PEOPLE_AND_CONTENT = ['applications', 'members', 'teams', 'content'] as const;

const ids = (role: Role | null) => navForRole(appNav, role).map((item) => item.id);

describe('people and content navigation', () => {
  it.each([
    ['super_admin', ['account', 'applications', 'members', 'teams', 'content']],
    ['hr_lead', ['account', 'applications', 'members', 'teams']],
    ['branch_lead', ['account', 'members', 'teams']],
    ['content_editor', ['account', 'content']],
    ['finance_reviewer', ['account']],
  ] as const)('shows %s exactly the entries its permissions allow', (role, expected) => {
    expect(ids(role)).toEqual(expected);
  });

  it('shows nothing when signed out', () => {
    expect(ids(null)).toEqual([]);
  });

  it.each(PEOPLE_AND_CONTENT)('the %s entry is live and points to an existing page', (id) => {
    const item = appNav.find((entry) => entry.id === id);
    expect(item?.live).toBe(true);
    expect(existsSync(path.join(APP_DIR, item!.href, 'page.tsx'))).toBe(true);
  });

  it('keeps the content editor and preview pages under [entryLocale]', () => {
    const keyDir = path.join(APP_DIR, 'content', '[key]');
    expect(existsSync(path.join(keyDir, '[entryLocale]', 'page.tsx'))).toBe(true);
    expect(existsSync(path.join(keyDir, '[entryLocale]', 'preview', 'page.tsx'))).toBe(true);
    // An inner [locale] segment would collide with the outer next-intl segment.
    expect(existsSync(path.join(keyDir, '[locale]'))).toBe(false);
  });
});
