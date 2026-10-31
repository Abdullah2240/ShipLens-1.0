import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  fixedClock,
  pktDate,
  pktMonth,
  pktWeekStart,
  systemClock,
} from './index';

describe('pktDate', () => {
  it('stays on Sunday until 23:59:59 PKT', () => {
    expect(pktDate(new Date('2026-10-25T18:59:59Z'))).toBe('2026-10-25');
  });

  it('rolls to Monday at 00:00 PKT', () => {
    expect(pktDate(new Date('2026-10-25T19:00:00Z'))).toBe('2026-10-26');
  });

  it('rolls over the year boundary in PKT', () => {
    expect(pktDate(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01');
  });
});

describe('pktWeekStart', () => {
  it('maps Sunday to the Monday six days earlier', () => {
    expect(pktWeekStart('2026-10-25')).toBe('2026-10-19');
  });

  it('keeps Monday and maps midweek to Monday', () => {
    expect(pktWeekStart('2026-10-26')).toBe('2026-10-26');
    expect(pktWeekStart('2026-10-28')).toBe('2026-10-26');
  });

  it('crosses year and month boundaries', () => {
    expect(pktWeekStart('2027-01-01')).toBe('2026-12-28');
    expect(pktWeekStart('2026-11-01')).toBe('2026-10-26');
  });
});

describe('addDays', () => {
  it('moves forward and backward across months and years', () => {
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
  });
});

describe('daysBetween', () => {
  it('is later minus earlier', () => {
    expect(daysBetween('2026-10-20', '2026-10-27')).toBe(7);
    expect(daysBetween('2026-10-27', '2026-10-20')).toBe(-7);
    expect(daysBetween('2026-10-27', '2026-10-27')).toBe(0);
  });
});

describe('pktMonth', () => {
  it('returns YYYY-MM', () => {
    expect(pktMonth('2026-10-31')).toBe('2026-10');
  });
});

describe('validation', () => {
  it.each(['2026-13-01', '2026-02-30', '26-10-01', '2026-1-01', '', 'not a date'])(
    'rejects %j',
    (value) => {
      expect(() => pktWeekStart(value)).toThrow();
      expect(() => addDays(value, 1)).toThrow();
      expect(() => daysBetween(value, '2026-10-01')).toThrow();
      expect(() => pktMonth(value)).toThrow();
    },
  );

  it('rejects invalid instants', () => {
    expect(() => pktDate(new Date('nope'))).toThrow();
  });
});

describe('clocks', () => {
  it('fixedClock returns the instant and can be moved', () => {
    const clock = fixedClock('2026-10-28T10:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-10-28T10:00:00.000Z');
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe('2026-10-28T10:01:00.000Z');
    clock.set('2026-11-01T00:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-11-01T00:00:00.000Z');
    clock.set(new Date('2026-12-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('fixedClock hands out copies so callers cannot mutate it', () => {
    const clock = fixedClock('2026-10-28T10:00:00Z');
    clock.now().setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-10-28T10:00:00.000Z');
  });

  it('fixedClock rejects an invalid instant', () => {
    expect(() => fixedClock('nope')).toThrow();
  });

  it('systemClock returns a Date', () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });

  it('only systemClock reads the wall clock', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(source.match(/new Date\(\)/g)?.length).toBe(1);
    expect(source).not.toContain('Date.now');
  });
});
