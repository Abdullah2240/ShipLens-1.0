import { describe, expect, it } from 'vitest';
import { parseReportQuery, returnInputSchema, submitInputSchema } from './schema';

const UUID = '11111111-1111-4111-8111-111111111111';

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((i) => i.message);
}

describe('submitInputSchema', () => {
  it('accepts an empty object and an explicit nil confirmation', () => {
    expect(submitInputSchema.parse({})).toEqual({});
    expect(submitInputSchema.parse({ confirmNil: true })).toEqual({ confirmNil: true });
    expect(submitInputSchema.parse({ confirmNil: false })).toEqual({ confirmNil: false });
  });

  it('rejects unknown keys and non-boolean confirmNil', () => {
    expect(submitInputSchema.safeParse({ confirmNil: true, total: '1.00' }).success).toBe(false);
    expect(submitInputSchema.safeParse({ confirmNil: 'true' }).success).toBe(false);
    expect(submitInputSchema.safeParse({ confirmNil: 1 }).success).toBe(false);
    expect(submitInputSchema.safeParse(null).success).toBe(false);
  });
});

describe('returnInputSchema', () => {
  it('trims the reason and keeps 3..500 characters', () => {
    expect(returnInputSchema.parse({ reason: '  Missing receipt  ' })).toEqual({
      reason: 'Missing receipt',
    });
    expect(returnInputSchema.parse({ reason: 'abc' }).reason).toBe('abc');
    expect(returnInputSchema.parse({ reason: 'x'.repeat(500) }).reason).toHaveLength(500);
  });

  it('answers with too_short and too_long codes', () => {
    expect(messages(returnInputSchema.safeParse({ reason: '  ab  ' }))).toEqual(['too_short']);
    expect(messages(returnInputSchema.safeParse({ reason: '' }))).toEqual(['too_short']);
    expect(messages(returnInputSchema.safeParse({ reason: 'x'.repeat(501) }))).toEqual([
      'too_long',
    ]);
  });

  it('requires a string reason and rejects unknown keys', () => {
    expect(messages(returnInputSchema.safeParse({}))).toEqual(['required']);
    expect(returnInputSchema.safeParse({ reason: 42 }).success).toBe(false);
    expect(returnInputSchema.safeParse({ reason: 'Fine reason', status: 'x' }).success).toBe(false);
  });
});

describe('parseReportQuery', () => {
  it('defaults the limit to 60 with no filters', () => {
    expect(parseReportQuery({})).toEqual({ limit: 60 });
  });

  it('keeps valid filters', () => {
    expect(
      parseReportQuery({
        status: 'submitted',
        branchId: UUID,
        weekStart: '2026-11-02',
        limit: '10',
      }),
    ).toEqual({ status: 'submitted', branchId: UUID, weekStart: '2026-11-02', limit: 10 });
  });

  it('drops invalid values instead of throwing', () => {
    expect(
      parseReportQuery({
        status: 'archived',
        branchId: 'nope',
        weekStart: '2026-11-03',
        limit: 'x',
      }),
    ).toEqual({ limit: 60 });
    expect(parseReportQuery({ weekStart: '2026-02-30' })).toEqual({ limit: 60 });
    expect(parseReportQuery({ weekStart: 'yesterday' })).toEqual({ limit: 60 });
  });

  it('clamps the limit to 1..500', () => {
    expect(parseReportQuery({ limit: '0' }).limit).toBe(1);
    expect(parseReportQuery({ limit: '-5' }).limit).toBe(1);
    expect(parseReportQuery({ limit: '9999' }).limit).toBe(500);
    expect(parseReportQuery({ limit: '500' }).limit).toBe(500);
  });

  it('takes the first of repeated parameters and survives odd input', () => {
    expect(parseReportQuery({ status: ['draft', 'approved'] })).toEqual({
      status: 'draft',
      limit: 60,
    });
    expect(parseReportQuery(undefined as never)).toEqual({ limit: 60 });
    expect(parseReportQuery({ limit: ['7', '8'] }).limit).toBe(7);
  });
});
