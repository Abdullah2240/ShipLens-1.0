import { describe, expect, it } from 'vitest';
import { declineInputSchema, parseApplicationListQuery } from './review-schema';

describe('application review input', () => {
  it('defaults invalid list query values without throwing', () => {
    expect(parseApplicationListQuery({})).toEqual({ page: 1, pageSize: 25 });
    expect(parseApplicationListQuery({ status: 'other', page: '-2', pageSize: 'bad' })).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it('clamps page size and retains a known status', () => {
    expect(parseApplicationListQuery({ status: 'pending', page: '2', pageSize: '999' })).toEqual({
      status: 'pending',
      page: 2,
      pageSize: 100,
    });
    expect(parseApplicationListQuery({ pageSize: '0' }).pageSize).toBe(1);
  });

  it('trims decline notes and rejects unknown keys', () => {
    expect(declineInputSchema.parse({ note: '  reason  ' })).toEqual({ note: 'reason' });
    expect(declineInputSchema.safeParse({ extra: true }).success).toBe(false);
    const result = declineInputSchema.safeParse({ note: 'x'.repeat(501) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('too_long');
  });
});
