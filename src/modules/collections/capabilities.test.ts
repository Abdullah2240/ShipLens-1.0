import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/platform/authz/permissions';
import { ROLES } from '@/platform/authz/roles';
import { collectionCapabilities, isEditable } from './capabilities';
import type { CollectionEditability } from './lock';

describe('collectionCapabilities', () => {
  it('lets a branch lead log, amend, void and read the timeline of their own branch', () => {
    expect(collectionCapabilities('branch_lead')).toEqual({
      canLog: true,
      canAmend: true,
      canVoid: true,
      canSeeAll: false,
      canSeeTimeline: true,
    });
  });

  it.each(['super_admin', 'finance_reviewer'] as const)(
    'gives %s a read-only view of every branch',
    (role) => {
      expect(collectionCapabilities(role)).toEqual({
        canLog: false,
        canAmend: false,
        canVoid: false,
        canSeeAll: true,
        canSeeTimeline: true,
      });
    },
  );

  it.each(['hr_lead', 'content_editor'] as const)('gives %s nothing', (role) => {
    expect(Object.values(collectionCapabilities(role)).every((value) => !value)).toBe(true);
  });

  it.each(ROLES)('agrees with the permission table for %s', (role) => {
    const has = (action: keyof typeof PERMISSIONS) => Object.hasOwn(PERMISSIONS[action], role);
    const read: Partial<Record<string, string>> = PERMISSIONS['collection.read'];
    expect(collectionCapabilities(role)).toEqual({
      canLog: has('collection.create'),
      canAmend: has('collection.amend'),
      canVoid: has('collection.void'),
      canSeeAll: read[role] === 'all',
      canSeeTimeline: has('audit.read_timeline'),
    });
  });
});

describe('isEditable', () => {
  it.each<[CollectionEditability, boolean]>([
    ['editable', true],
    ['editable_exempt', true],
    ['locked', false],
    ['report_submitted', false],
    ['report_approved', false],
    ['voided', false],
    ['branch_closed', false],
  ])('%s -> %s', (editability, expected) => {
    expect(isEditable(editability)).toBe(expected);
  });
});
