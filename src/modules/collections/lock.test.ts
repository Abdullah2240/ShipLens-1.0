import { describe, expect, it } from 'vitest';
import { BRANCH_STATUSES, REPORT_STATUSES } from '@/platform/config/constants';
import { addDays, pktDate } from '@/platform/time';
import { collectionEditability, isLocked, lockState, type CollectionEditability } from './lock';

describe('lockState', () => {
  it('counts down from 7 on the collection day to 0 on day 7', () => {
    expect(lockState('2026-11-02', '2026-11-02')).toEqual({
      lastEditableOn: '2026-11-09',
      locked: false,
      daysLeft: 7,
    });
    expect(lockState('2026-11-02', '2026-11-08')).toEqual({
      lastEditableOn: '2026-11-09',
      locked: false,
      daysLeft: 1,
    });
    expect(lockState('2026-11-02', '2026-11-09')).toEqual({
      lastEditableOn: '2026-11-09',
      locked: false,
      daysLeft: 0,
    });
  });

  it('locks from day 8', () => {
    expect(lockState('2026-11-02', '2026-11-10')).toEqual({
      lastEditableOn: '2026-11-09',
      locked: true,
      daysLeft: 0,
    });
    expect(lockState('2026-11-02', '2026-12-25').locked).toBe(true);
  });

  it('crosses month and year ends', () => {
    expect(lockState('2026-10-28', '2026-10-28').lastEditableOn).toBe('2026-11-04');
    expect(lockState('2026-12-28', '2026-12-30').lastEditableOn).toBe('2027-01-04');
    expect(lockState('2026-12-28', '2027-01-04').locked).toBe(false);
    expect(lockState('2026-12-28', '2027-01-05').locked).toBe(true);
  });

  it('honours a lockDays override', () => {
    expect(lockState('2026-11-02', '2026-11-05', 3)).toEqual({
      lastEditableOn: '2026-11-05',
      locked: false,
      daysLeft: 0,
    });
    expect(lockState('2026-11-02', '2026-11-06', 3).locked).toBe(true);
    expect(isLocked('2026-11-02', '2026-11-06', 3)).toBe(true);
  });

  it('isLocked agrees with lockState for days 0..10', () => {
    for (let day = 0; day <= 10; day += 1) {
      const today = addDays('2026-11-02', day);
      expect(isLocked('2026-11-02', today)).toBe(lockState('2026-11-02', today).locked);
      expect(isLocked('2026-11-02', today)).toBe(day >= 8);
    }
  });

  // The service computes today as pktDate(clock.now()): PKT is UTC+5, so the lock starts
  // at 19:00:00Z on day 7.
  it('turns at PKT midnight through the clock', () => {
    const before = pktDate(new Date('2026-11-09T18:59:59Z'));
    const after = pktDate(new Date('2026-11-09T19:00:00Z'));
    expect(before).toBe('2026-11-09');
    expect(after).toBe('2026-11-10');
    expect(isLocked('2026-11-02', before)).toBe(false);
    expect(isLocked('2026-11-02', after)).toBe(true);
  });
});

describe('collectionEditability', () => {
  const inside = '2026-11-04';
  const past = '2026-11-20';

  function expected(
    status: 'active' | 'voided',
    reportStatus: (typeof REPORT_STATUSES)[number],
    branchStatus: (typeof BRANCH_STATUSES)[number],
    locked: boolean,
  ): CollectionEditability {
    if (status === 'voided') return 'voided';
    if (branchStatus === 'closed') return 'branch_closed';
    if (reportStatus === 'submitted') return 'report_submitted';
    if (reportStatus === 'approved') return 'report_approved';
    if (!locked) return 'editable';
    return reportStatus === 'returned' ? 'editable_exempt' : 'locked';
  }

  it('covers every combination', () => {
    for (const status of ['active', 'voided'] as const)
      for (const reportStatus of REPORT_STATUSES)
        for (const branchStatus of BRANCH_STATUSES)
          for (const today of [inside, past]) {
            const actual = collectionEditability({
              status,
              reportStatus,
              branchStatus,
              collectedOn: '2026-11-02',
              today,
            });
            expect(actual, `${status}/${reportStatus}/${branchStatus}/${today}`).toBe(
              expected(status, reportStatus, branchStatus, today === past),
            );
          }
  });

  it('names the key cases', () => {
    const base = {
      status: 'active' as const,
      reportStatus: 'draft' as const,
      branchStatus: 'active' as const,
      collectedOn: '2026-11-02',
      today: inside,
    };
    expect(collectionEditability({ ...base, status: 'voided', branchStatus: 'closed' })).toBe(
      'voided',
    );
    expect(collectionEditability({ ...base, branchStatus: 'closed' })).toBe('branch_closed');
    expect(collectionEditability({ ...base, reportStatus: 'submitted' })).toBe('report_submitted');
    expect(collectionEditability({ ...base, reportStatus: 'approved' })).toBe('report_approved');
    expect(collectionEditability(base)).toBe('editable');
    expect(collectionEditability({ ...base, today: past })).toBe('locked');
    expect(collectionEditability({ ...base, reportStatus: 'returned' })).toBe('editable');
    expect(collectionEditability({ ...base, reportStatus: 'returned', today: past })).toBe(
      'editable_exempt',
    );
    expect(collectionEditability({ ...base, branchStatus: 'paused' })).toBe('editable');
  });
});
