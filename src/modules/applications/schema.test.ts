import { describe, expect, it } from 'vitest';
import { applicationInputSchema, APPLICATION_ERROR_CODES } from './schema';

const branchId = '11111111-1111-4111-8111-111111111111';
const valid = { fullName: 'Ali Khan', email: 'Ali@Example.com', branchId };

function issue(field: string, value: unknown) {
  const result = applicationInputSchema.safeParse({ ...valid, [field]: value });
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected invalid input');
  return result.error.issues.find((item) => item.path[0] === field)?.message;
}

describe('application input', () => {
  it('normalizes name and email and rejects invalid lengths and addresses', () => {
    expect(
      applicationInputSchema.parse({
        ...valid,
        fullName: '  Ali Khan  ',
        email: '  Ali@Example.COM ',
      }),
    ).toMatchObject({ fullName: 'Ali Khan', email: 'ali@example.com' });
    expect(issue('fullName', '')).toBe('required');
    expect(issue('fullName', 'A')).toBe('too_short');
    expect(issue('fullName', 'A'.repeat(101))).toBe('too_long');
    expect(issue('email', undefined)).toBe('required');
    expect(issue('email', 'nope')).toBe('invalid_email');
    expect(issue('email', 'a'.repeat(255) + '@example.com')).toBe('too_long');
  });

  it.each(['03001234567', '+923001234567', '923001234567', '00923001234567', '(0300) 123-4567'])(
    'normalizes Pakistan phone %s',
    (phone) => {
      expect(applicationInputSchema.parse({ ...valid, phone }).phone).toBe('+923001234567');
    },
  );

  it.each(['0300123', '+15551234567', '03001234567890', 'abc'])('rejects phone %s', (phone) => {
    expect(issue('phone', phone)).toBe('invalid_phone');
  });

  it('normalizes optional fields and rejects invalid branch and extra keys', () => {
    expect(applicationInputSchema.parse({ ...valid, phone: '', message: '   ' })).toMatchObject({
      phone: null,
      message: null,
    });
    expect(issue('message', 'x'.repeat(1001))).toBe('too_long');
    expect(issue('branchId', 'unknown')).toBe('invalid_branch');
    expect(issue('website', 'x'.repeat(201))).toBe('too_long');
    const extra = applicationInputSchema.safeParse({ ...valid, extra: true });
    expect(extra.success).toBe(false);
    if (!extra.success) expect(extra.error.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('uses only stable messages for field issues', () => {
    const result = applicationInputSchema.safeParse({
      fullName: '',
      email: 'bad',
      phone: 'bad',
      message: 'x'.repeat(1001),
      branchId: 'bad',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      for (const item of result.error.issues)
        expect(APPLICATION_ERROR_CODES).toContain(item.message);
  });
});
