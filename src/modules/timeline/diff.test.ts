import { describe, expect, it } from 'vitest';
import { OWNER_AUDIT_ACTIONS, actionMessageKey } from './actions';
import { diffSnapshots } from './diff';

describe('diffSnapshots', () => {
  it('treats a missing before snapshot as every field being added', () => {
    expect(diffSnapshots(null, { a: 1 })).toEqual([{ field: 'a', before: null, after: 1 }]);
  });

  it('lists only the fields whose values differ', () => {
    expect(diffSnapshots({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([
      { field: 'b', before: 2, after: 3 },
    ]);
  });

  it('treats a missing after snapshot as every field being cleared', () => {
    expect(diffSnapshots({ a: 1 }, null)).toEqual([{ field: 'a', before: 1, after: null }]);
  });

  it('returns nothing when both snapshots are missing', () => {
    expect(diffSnapshots(null, null)).toEqual([]);
  });

  it('orders fields by the sorted union of keys', () => {
    const changes = diffSnapshots({ status: 'draft', amount: '1.00' }, { zeta: 1, status: 'x' });
    expect(changes.map((c) => c.field)).toEqual(['amount', 'status', 'zeta']);
  });

  it('compares nested objects and arrays by value', () => {
    expect(diffSnapshots({ o: { x: [1, 2] } }, { o: { x: [1, 2] } })).toEqual([]);
    expect(diffSnapshots({ o: { x: [1, 2] } }, { o: { x: [2, 1] } })).toEqual([
      { field: 'o', before: { x: [1, 2] }, after: { x: [2, 1] } },
    ]);
    expect(diffSnapshots({ o: { a: 1, b: 2 } }, { o: { b: 2, a: 1 } })).toEqual([]);
  });

  it('treats a key that is absent on one side as null', () => {
    expect(diffSnapshots({ a: null }, {})).toEqual([]);
    expect(diffSnapshots({ a: 'x' }, { b: 'y' })).toEqual([
      { field: 'a', before: 'x', after: null },
      { field: 'b', before: null, after: 'y' },
    ]);
  });

  it('does not treat values of different types as equal', () => {
    expect(diffSnapshots({ v: 1 }, { v: '1' })).toEqual([{ field: 'v', before: 1, after: '1' }]);
    expect(diffSnapshots({ v: [] }, { v: {} })).toHaveLength(1);
  });
});

describe('audit action keys', () => {
  it('replaces dots with underscores', () => {
    expect(actionMessageKey('collection.amend_exempt')).toBe('collection_amend_exempt');
    expect(actionMessageKey('report.submit')).toBe('report_submit');
  });

  it('lists every owner action once', () => {
    expect(new Set(OWNER_AUDIT_ACTIONS).size).toBe(OWNER_AUDIT_ACTIONS.length);
    for (const code of [
      'branch.create',
      'branch.update',
      'branch.transition',
      'branch.assign_lead',
      'report.create_draft',
      'report.submit',
      'report.resubmit',
      'report.return',
      'report.approve',
      'collection.create',
      'collection.amend',
      'collection.amend_exempt',
      'collection.void',
      'collection.void_exempt',
      'seed.created',
      'collection.mark_routed',
      'collection.unmark_routed',
      'report.share',
      'export.create',
    ]) {
      expect(OWNER_AUDIT_ACTIONS).toContain(code);
    }
  });
});
