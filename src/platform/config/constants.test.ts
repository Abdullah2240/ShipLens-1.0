import { describe, expect, it } from 'vitest';
import {
  APPLICATION_STATUSES,
  BRANCH_STATUSES,
  COLLECTION_STATUSES,
  CONTENT_STATUSES,
  ID_FORMATS,
  KPI_NAMES,
  LOCK_ANCHOR,
  LOCK_DAYS,
  LOGIN_THROTTLE,
  MEMBER_STATUSES,
  MONEY,
  PG_POOL_MAX,
  REPORT_STATUSES,
  SESSION,
  TIMEZONE,
  WEEK_START,
} from './constants';

describe('business constants', () => {
  it('fixes the time and lock settings', () => {
    expect(LOCK_DAYS).toBe(7);
    expect(LOCK_ANCHOR).toBe('collected_on');
    expect(TIMEZONE).toBe('Asia/Karachi');
    expect(WEEK_START).toBe('monday');
  });

  it('lists the status vocabularies exactly', () => {
    expect([...REPORT_STATUSES]).toEqual(['draft', 'submitted', 'returned', 'approved']);
    expect([...BRANCH_STATUSES]).toEqual(['forming', 'active', 'paused', 'closed']);
    expect([...COLLECTION_STATUSES]).toEqual(['active', 'voided']);
    expect([...APPLICATION_STATUSES]).toEqual(['pending', 'accepted', 'declined']);
    expect([...CONTENT_STATUSES]).toEqual(['draft', 'published']);
    expect([...MEMBER_STATUSES]).toEqual(['active', 'inactive']);
  });

  it('names the seven dashboard KPIs', () => {
    expect([...KPI_NAMES]).toEqual([
      'collected',
      'approved',
      'pending_approval',
      'in_progress',
      'not_yet_routed',
      'active_branches',
      'reports_awaiting_review',
    ]);
  });

  it('declares ID formats, session, throttle, pool and money settings', () => {
    expect(ID_FORMATS.branchCode).toEqual({ prefix: 'BR', digits: 3 });
    expect(ID_FORMATS.memberId).toEqual({ prefix: 'M', digits: 5 });
    expect(SESSION).toEqual({ idleMinutes: 720, absoluteDays: 7, touchIntervalSeconds: 60 });
    expect(LOGIN_THROTTLE).toEqual({
      windowMinutes: 15,
      maxFailuresPerEmail: 5,
      maxFailuresPerIp: 20,
    });
    expect(PG_POOL_MAX).toBe(5);
    expect(MONEY).toEqual({ scale: 2, maxIntegerDigits: 12 });
  });
});
