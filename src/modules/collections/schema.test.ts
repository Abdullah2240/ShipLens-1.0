import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  collectionInputSchema,
  collectionPatchSchema,
  parseCollectionQuery,
  voidInputSchema,
} from './schema';

const message = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;
const path = (result: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues[0]?.path.join('.');

const valid = { amount: '1250', collectedOn: '2026-11-03', purpose: 'Ration packs' };

describe('collectionInputSchema', () => {
  it('canonicalises amounts to two decimals', () => {
    expect(collectionInputSchema.parse(valid).amount).toBe('1250.00');
    expect(collectionInputSchema.parse({ ...valid, amount: '1250.5' }).amount).toBe('1250.50');
    expect(collectionInputSchema.parse({ ...valid, amount: '1250.50' }).amount).toBe('1250.50');
    expect(collectionInputSchema.parse({ ...valid, amount: '999999999999.99' }).amount).toBe(
      '999999999999.99',
    );
  });

  it('rejects invalid amounts with invalid_money', () => {
    for (const amount of ['0', '-5', '1.234', '1e3', 1250, '', '1000000000000', null]) {
      const result = collectionInputSchema.safeParse({ ...valid, amount });
      expect(result.success, String(amount)).toBe(false);
      expect(message(result)).toBe('invalid_money');
      expect(path(result)).toBe('amount');
    }
  });

  it('needs a real YYYY-MM-DD date', () => {
    for (const collectedOn of ['2026-02-30', '02/11/2026', '2026-1-3', '', 20261103]) {
      const result = collectionInputSchema.safeParse({ ...valid, collectedOn });
      expect(message(result), String(collectedOn)).toBe('invalid_date');
      expect(path(result)).toBe('collectedOn');
    }
    expect(collectionInputSchema.safeParse({ ...valid, collectedOn: '2028-02-29' }).success).toBe(
      true,
    );
  });

  it('trims and bounds purpose and note', () => {
    expect(collectionInputSchema.parse({ ...valid, purpose: '  Zakat  ' }).purpose).toBe('Zakat');
    expect(message(collectionInputSchema.safeParse({ ...valid, purpose: ' a ' }))).toBe(
      'too_short',
    );
    expect(message(collectionInputSchema.safeParse({ ...valid, purpose: 'p'.repeat(121) }))).toBe(
      'too_long',
    );
    expect(collectionInputSchema.safeParse({ ...valid, purpose: 'p'.repeat(120) }).success).toBe(
      true,
    );
    expect(message(collectionInputSchema.safeParse({ ...valid, purpose: undefined }))).toBe(
      'required',
    );
    expect(collectionInputSchema.parse({ ...valid, note: ' Cash ' }).note).toBe('Cash');
    expect(collectionInputSchema.parse({ ...valid, note: '  ' }).note).toBeUndefined();
    expect(message(collectionInputSchema.safeParse({ ...valid, note: 'n'.repeat(501) }))).toBe(
      'too_long',
    );
    expect(collectionInputSchema.safeParse({ ...valid, note: 'n'.repeat(500) }).success).toBe(true);
  });

  it('rejects unknown keys such as branchId and reportId', () => {
    expect(collectionInputSchema.safeParse({ ...valid, branchId: randomUUID() }).success).toBe(
      false,
    );
    expect(collectionInputSchema.safeParse({ ...valid, reportId: randomUUID() }).success).toBe(
      false,
    );
    expect(collectionInputSchema.safeParse({ ...valid, status: 'voided' }).success).toBe(false);
  });
});

describe('collectionPatchSchema', () => {
  it('needs at least one key', () => {
    expect(message(collectionPatchSchema.safeParse({}))).toBe('empty_patch');
  });

  it('accepts subsets, canonical money and a nullable note', () => {
    expect(collectionPatchSchema.parse({ amount: '10' })).toEqual({ amount: '10.00' });
    expect(collectionPatchSchema.parse({ note: null })).toEqual({ note: null });
    expect(collectionPatchSchema.parse({ note: ' ' })).toEqual({ note: null });
    expect(collectionPatchSchema.parse({ purpose: ' Zakat ', collectedOn: '2026-11-04' })).toEqual({
      purpose: 'Zakat',
      collectedOn: '2026-11-04',
    });
  });

  it('applies the input rules and stays strict', () => {
    expect(message(collectionPatchSchema.safeParse({ amount: '1.234' }))).toBe('invalid_money');
    expect(message(collectionPatchSchema.safeParse({ collectedOn: '2026-02-30' }))).toBe(
      'invalid_date',
    );
    expect(collectionPatchSchema.safeParse({ branchId: randomUUID() }).success).toBe(false);
    expect(collectionPatchSchema.safeParse({ status: 'voided' }).success).toBe(false);
  });
});

describe('voidInputSchema', () => {
  it('trims the reason and bounds it to 3..500', () => {
    expect(voidInputSchema.parse({ reason: '  Duplicate  ' })).toEqual({ reason: 'Duplicate' });
    expect(message(voidInputSchema.safeParse({ reason: ' ab ' }))).toBe('too_short');
    expect(message(voidInputSchema.safeParse({ reason: 'r'.repeat(501) }))).toBe('too_long');
    expect(message(voidInputSchema.safeParse({}))).toBe('required');
    expect(voidInputSchema.safeParse({ reason: 'Dup', extra: 1 }).success).toBe(false);
  });
});

describe('parseCollectionQuery', () => {
  it('defaults the limit to 100', () => {
    expect(parseCollectionQuery({})).toEqual({ limit: 100 });
  });

  it('keeps valid filters', () => {
    const branchId = randomUUID();
    const reportId = randomUUID();
    expect(
      parseCollectionQuery({
        branchId,
        reportId,
        weekStart: '2026-11-02',
        status: 'voided',
        limit: '25',
      }),
    ).toEqual({ branchId, reportId, weekStart: '2026-11-02', status: 'voided', limit: 25 });
    expect(parseCollectionQuery({ branchId: [branchId, 'x'] }).branchId).toBe(branchId);
  });

  it('drops invalid values and clamps the limit', () => {
    expect(
      parseCollectionQuery({
        branchId: 'bad-id',
        reportId: '123',
        weekStart: '2026-11-03',
        status: 'deleted',
        limit: 'many',
      }),
    ).toEqual({ limit: 100 });
    expect(parseCollectionQuery({ weekStart: '2026-02-30' })).toEqual({ limit: 100 });
    expect(parseCollectionQuery({ limit: '0' }).limit).toBe(1);
    expect(parseCollectionQuery({ limit: '9999' }).limit).toBe(500);
    expect(parseCollectionQuery({ limit: '-3' }).limit).toBe(100);
    expect(parseCollectionQuery({ limit: '1.5' }).limit).toBe(100);
  });

  it('never throws', () => {
    expect(() => parseCollectionQuery({ weekStart: 'x', limit: '' })).not.toThrow();
    expect(() => parseCollectionQuery({ status: undefined })).not.toThrow();
  });
});
