import { describe, expect, it } from 'vitest';
import { memberPatchSchema, parseMemberQuery, teamInputSchema } from './schema';

describe('member schemas', () => {
  it('defaults and normalizes list input', () => {
    expect(parseMemberQuery({})).toEqual({ page: 1, pageSize: 25 });
    expect(
      parseMemberQuery({
        page: '-2',
        pageSize: '999',
        q: '  Ali  ',
        status: 'bad',
        role: 'bad',
        teamId: 'bad',
      }),
    ).toEqual({ page: 1, pageSize: 100, q: 'Ali' });
    expect(parseMemberQuery({ page: ['2', '3'], pageSize: '0' })).toEqual({ page: 2, pageSize: 1 });
  });

  it('accepts only meaningful member edits', () => {
    expect(memberPatchSchema.safeParse({}).success).toBe(false);
    expect(memberPatchSchema.safeParse({ fullName: 'No' }).success).toBe(false);
    expect(memberPatchSchema.safeParse({ status: 'unknown' }).success).toBe(false);
    expect(memberPatchSchema.parse({ teamId: null })).toEqual({ teamId: null });
    expect(memberPatchSchema.safeParse({}).error?.issues[0]?.message).toBe('empty_patch');
  });

  it('trims and bounds team names', () => {
    expect(teamInputSchema.parse({ name: '  Outreach  ' })).toEqual({ name: 'Outreach' });
    expect(teamInputSchema.safeParse({ name: 'a' }).success).toBe(false);
    expect(teamInputSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
  });
});
