import { describe, expect, it } from 'vitest';
import { REPORTING_LIMITS } from './figures';
import {
  monthBounds,
  monthsBetween,
  parsePageQuery,
  parseReportingFilters,
  toSearchParams,
} from './filters';

const BRANCH = '0b0c1d2e-3f40-4152-8637-48495a6b7c8d';

describe('parseReportingFilters', () => {
  it('keeps valid months and a uuid branch', () => {
    expect(parseReportingFilters({ from: '2026-08', to: '2026-10', branch: BRANCH })).toEqual({
      from: '2026-08',
      to: '2026-10',
      branch: BRANCH,
    });
  });

  it('accepts URLSearchParams', () => {
    expect(parseReportingFilters(new URLSearchParams(`from=2026-08&branch=${BRANCH}`))).toEqual({
      from: '2026-08',
      branch: BRANCH,
    });
  });

  it('lowercases the branch uuid', () => {
    expect(parseReportingFilters({ branch: BRANCH.toUpperCase() })).toEqual({ branch: BRANCH });
  });

  it('drops invalid months, arrays, empty strings and non-uuid branches', () => {
    for (const bad of [
      '2026-13',
      '2026-8',
      '2026-00',
      'abc',
      '',
      ' 2026-08',
      '2026-08-01',
      '26-08',
    ]) {
      expect(parseReportingFilters({ from: bad, to: bad })).toEqual({});
    }
    expect(parseReportingFilters({ from: ['2026-08', '2026-09'] })).toEqual({});
    expect(parseReportingFilters(new URLSearchParams('from=2026-08&from=2026-09'))).toEqual({});
    expect(parseReportingFilters({ branch: 'not-a-uuid' })).toEqual({});
    expect(parseReportingFilters({ branch: `${BRANCH}x` })).toEqual({});
    expect(parseReportingFilters({ branch: [BRANCH] })).toEqual({});
    expect(parseReportingFilters({ branch: undefined })).toEqual({});
  });

  it('ignores unknown keys', () => {
    expect(parseReportingFilters({ figure: 'approved', page: '2', from: '2026-08' })).toEqual({
      from: '2026-08',
    });
  });

  it('swaps from and to when reversed', () => {
    expect(parseReportingFilters({ from: '2026-10', to: '2026-08' })).toEqual({
      from: '2026-08',
      to: '2026-10',
    });
  });

  it('keeps a single-month range', () => {
    expect(parseReportingFilters({ from: '2026-09', to: '2026-09' })).toEqual({
      from: '2026-09',
      to: '2026-09',
    });
  });

  it('never throws on random input', () => {
    const alphabet = '0123456789-abcdefABCDEF_ %&=?/\\\u0000‮\ud83d';
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 200; i += 1) {
      const length = next() % 40;
      let value = '';
      for (let j = 0; j < length; j += 1) value += alphabet[next() % alphabet.length];
      expect(() =>
        parseReportingFilters({ from: value, to: value, branch: value, [value]: value }),
      ).not.toThrow();
      expect(() => parseReportingFilters(new URLSearchParams(value))).not.toThrow();
      const parsed = parseReportingFilters({ from: value, to: value, branch: value });
      expect(() => monthBounds(parsed)).not.toThrow();
    }
  });

  it('never throws on hostile non-string values', () => {
    const hostile = { from: 1, to: null, branch: {} } as unknown as Record<string, string>;
    expect(parseReportingFilters(hostile)).toEqual({});
  });
});

describe('toSearchParams', () => {
  it('serialises in canonical order and omits absent keys', () => {
    expect(toSearchParams({})).toBe('');
    expect(toSearchParams({ branch: BRANCH, to: '2026-09', from: '2026-08' })).toBe(
      `?from=2026-08&to=2026-09&branch=${BRANCH}`,
    );
    expect(toSearchParams({ to: '2026-09' })).toBe('?to=2026-09');
  });

  it('round-trips through parseReportingFilters', () => {
    for (const filters of [
      {},
      { from: '2026-08' },
      { to: '2026-12' },
      { from: '2026-01', to: '2026-12', branch: BRANCH },
      { branch: BRANCH },
    ]) {
      const text = toSearchParams(filters);
      expect(parseReportingFilters(new URLSearchParams(text))).toEqual(filters);
    }
  });
});

describe('monthBounds', () => {
  it('gives the first and last day of the months', () => {
    expect(monthBounds({ from: '2026-02', to: '2026-02' })).toEqual({
      fromDate: '2026-02-01',
      toDate: '2026-02-28',
    });
    expect(monthBounds({ from: '2028-02', to: '2028-02' })).toEqual({
      fromDate: '2028-02-01',
      toDate: '2028-02-29',
    });
    expect(monthBounds({ from: '2026-12', to: '2026-12' })).toEqual({
      fromDate: '2026-12-01',
      toDate: '2026-12-31',
    });
    expect(monthBounds({ from: '2026-08', to: '2026-09' })).toEqual({
      fromDate: '2026-08-01',
      toDate: '2026-09-30',
    });
  });

  it('leaves absent bounds null', () => {
    expect(monthBounds({})).toEqual({ fromDate: null, toDate: null });
    expect(monthBounds({ from: '2026-08' })).toEqual({ fromDate: '2026-08-01', toDate: null });
    expect(monthBounds({ to: '2026-04' })).toEqual({ fromDate: null, toDate: '2026-04-30' });
  });
});

describe('monthsBetween', () => {
  it('lists every month inclusive across a year boundary', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('handles a single month and a reversed range', () => {
    expect(monthsBetween('2026-09', '2026-09')).toEqual(['2026-09']);
    expect(monthsBetween('2026-10', '2026-09')).toEqual([]);
  });

  it('covers a full year', () => {
    expect(monthsBetween('2026-01', '2026-12')).toHaveLength(12);
  });

  it('throws on a malformed month (programming error)', () => {
    expect(() => monthsBetween('2026-13', '2027-01')).toThrow();
  });
});

describe('parsePageQuery', () => {
  it('uses defaults for missing or invalid values', () => {
    expect(parsePageQuery({})).toEqual({ page: 1, pageSize: REPORTING_LIMITS.unroutedPageSize });
    expect(parsePageQuery({}, { pageSize: 20 })).toEqual({ page: 1, pageSize: 20 });
    expect(parsePageQuery({ page: 'abc', pageSize: '1.5' })).toEqual({
      page: 1,
      pageSize: REPORTING_LIMITS.unroutedPageSize,
    });
    expect(parsePageQuery({ page: ['2', '3'] })).toEqual({
      page: 1,
      pageSize: REPORTING_LIMITS.unroutedPageSize,
    });
  });

  it('clamps page and pageSize', () => {
    expect(parsePageQuery({ page: '0', pageSize: '0' })).toEqual({ page: 1, pageSize: 1 });
    expect(parsePageQuery({ page: '-3', pageSize: '-1' })).toEqual({
      page: 1,
      pageSize: REPORTING_LIMITS.unroutedPageSize,
    });
    expect(parsePageQuery(new URLSearchParams('page=2&pageSize=5000'))).toEqual({
      page: 2,
      pageSize: REPORTING_LIMITS.maxPageSize,
    });
    expect(parsePageQuery({ page: '99999999999999999999999' }).page).toBeLessThanOrEqual(1_000_000);
  });

  it('keeps valid values', () => {
    expect(parsePageQuery({ page: '3', pageSize: '25' })).toEqual({ page: 3, pageSize: 25 });
  });
});
