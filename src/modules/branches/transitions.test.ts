import { describe, expect, it } from 'vitest';
import { BRANCH_STATUSES } from '@/platform/config/constants';
import {
  BRANCH_ACCEPTS_COLLECTIONS,
  BRANCH_READ_ONLY,
  BRANCH_TRANSITIONS,
  canTransitionBranch,
  formatBranchCode,
} from './transitions';

const ALLOWED = new Set([
  'forming>active',
  'forming>closed',
  'active>paused',
  'active>closed',
  'paused>active',
  'paused>closed',
]);

describe('branch transitions', () => {
  it('allows exactly the six documented moves over the full 4x4 grid', () => {
    let checked = 0;
    for (const from of BRANCH_STATUSES) {
      for (const to of BRANCH_STATUSES) {
        checked += 1;
        expect(canTransitionBranch(from, to), `${from}>${to}`).toBe(ALLOWED.has(`${from}>${to}`));
      }
    }
    expect(checked).toBe(16);
  });

  it('keeps closed terminal and refuses same-status moves', () => {
    expect(BRANCH_TRANSITIONS.closed).toEqual([]);
    for (const status of BRANCH_STATUSES) expect(canTransitionBranch(status, status)).toBe(false);
  });

  it('names the statuses that accept collections and the read-only ones', () => {
    expect([...BRANCH_ACCEPTS_COLLECTIONS]).toEqual(['forming', 'active']);
    expect([...BRANCH_READ_ONLY]).toEqual(['closed']);
  });

  it('rejects unknown statuses', () => {
    expect(canTransitionBranch('active', 'archived' as never)).toBe(false);
    expect(canTransitionBranch('archived' as never, 'active')).toBe(false);
  });
});

describe('formatBranchCode', () => {
  it('pads to three digits and never truncates', () => {
    expect(formatBranchCode(1)).toBe('BR001');
    expect(formatBranchCode(42)).toBe('BR042');
    expect(formatBranchCode(999)).toBe('BR999');
    expect(formatBranchCode(1000)).toBe('BR1000');
    expect(formatBranchCode(1234)).toBe('BR1234');
  });

  it('accepts string and bigint sequence values', () => {
    expect(formatBranchCode('7')).toBe('BR007');
    expect(formatBranchCode(12n)).toBe('BR012');
    expect(formatBranchCode('123456')).toBe('BR123456');
  });

  it('refuses values that are not non-negative integers', () => {
    expect(() => formatBranchCode(-1)).toThrow(RangeError);
    expect(() => formatBranchCode(1.5)).toThrow(RangeError);
    expect(() => formatBranchCode('12a')).toThrow(RangeError);
  });
});
