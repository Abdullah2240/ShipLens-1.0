import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPLICATION_PAGE_SIZE,
  MAX_APPLICATION_PAGE_SIZE,
  declineInputSchema,
  parseApplicationListQuery,
} from './review-schema';

type Params = Parameters<typeof parseApplicationListQuery>[0];

describe('parseApplicationListQuery edge input', () => {
  it('takes the first value of a repeated query parameter', () => {
    expect(
      parseApplicationListQuery({
        status: ['accepted', 'pending'],
        page: ['3', '9'],
        pageSize: ['10'],
      }),
    ).toEqual({ status: 'accepted', page: 3, pageSize: 10 });
  });

  it('accepts safe integers passed as numbers and trims numeric strings', () => {
    const asNumbers = { page: 4, pageSize: 50 } as unknown as Params;
    expect(parseApplicationListQuery(asNumbers)).toEqual({ page: 4, pageSize: 50 });
    expect(parseApplicationListQuery({ page: ' 7 ', pageSize: ' 20 ' })).toEqual({
      page: 7,
      pageSize: 20,
    });
  });

  it('falls back to defaults for fractions, unsafe numbers and over-long digit strings', () => {
    const odd = { page: 2.5, pageSize: Number.MAX_SAFE_INTEGER + 2 } as unknown as Params;
    expect(parseApplicationListQuery(odd)).toEqual({
      page: 1,
      pageSize: DEFAULT_APPLICATION_PAGE_SIZE,
    });
    expect(parseApplicationListQuery({ page: '1234567890', pageSize: '1e3' })).toEqual({
      page: 1,
      pageSize: DEFAULT_APPLICATION_PAGE_SIZE,
    });
  });

  it('clamps pages into 1..100000 and page sizes into 1..max', () => {
    expect(parseApplicationListQuery({ page: '999999999', pageSize: '-5' })).toEqual({
      page: 100_000,
      pageSize: 1,
    });
    expect(
      parseApplicationListQuery({ pageSize: String(MAX_APPLICATION_PAGE_SIZE + 1) }).pageSize,
    ).toBe(MAX_APPLICATION_PAGE_SIZE);
  });

  it('never throws on a missing or non-object parameter bag', () => {
    const expected = { page: 1, pageSize: DEFAULT_APPLICATION_PAGE_SIZE };
    expect(parseApplicationListQuery(undefined as unknown as Params)).toEqual(expected);
    expect(parseApplicationListQuery(null as unknown as Params)).toEqual(expected);
    expect(parseApplicationListQuery('status=pending' as unknown as Params)).toEqual(expected);
  });
});

describe('declineInputSchema edge input', () => {
  it('treats a blank note as no note', () => {
    expect(declineInputSchema.parse({ note: '   ' })).toEqual({ note: undefined });
    expect(declineInputSchema.parse({})).toEqual({});
  });

  it('accepts exactly 500 characters after trimming', () => {
    const note = 'x'.repeat(500);
    expect(declineInputSchema.parse({ note: `  ${note}  ` })).toEqual({ note });
  });

  it('rejects a non-string note with invalid_type', () => {
    const result = declineInputSchema.safeParse({ note: 7 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('invalid_type');
  });
});
