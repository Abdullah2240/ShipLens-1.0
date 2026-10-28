import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  fromMinor,
  moneyInputSchema,
  parseMoneyInput,
  subMoney,
  sumMoney,
  toMinor,
} from './index';

describe('money arithmetic', () => {
  it('adds decimals exactly', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(sumMoney(['0.10', '0.10', '0.10'])).toBe('0.30');
    expect(sumMoney([])).toBe('0.00');
  });

  it('keeps every digit above 2^53', () => {
    expect(addMoney('9007199254740993.10', '0.01')).toBe('9007199254740993.11');
  });

  it('subtracts without printing negative zero', () => {
    expect(subMoney('1.00', '2.50')).toBe('-1.50');
    expect(subMoney('0.05', '0.05')).toBe('0.00');
  });

  it('converts to and from minor units', () => {
    expect(toMinor('12.5')).toBe(1250n);
    expect(toMinor('12')).toBe(1200n);
    expect(toMinor('-0.05')).toBe(-5n);
    expect(fromMinor(1250n)).toBe('12.50');
    expect(fromMinor(-5n)).toBe('-0.05');
    expect(fromMinor(0n)).toBe('0.00');
  });

  it('compares numerically, not lexically', () => {
    expect(compareMoney('2.00', '10.00')).toBeLessThan(0);
    expect(compareMoney('10.00', '2.00')).toBeGreaterThan(0);
    expect(compareMoney('1.10', '1.1')).toBe(0);
  });

  it('rejects malformed arithmetic operands', () => {
    expect(() => toMinor('1.234')).toThrow();
    expect(() => toMinor('abc')).toThrow();
    expect(() => toMinor('')).toThrow();
  });
});

describe('parseMoneyInput', () => {
  it('canonicalises valid input to two decimals', () => {
    expect(parseMoneyInput('1')).toBe('1.00');
    expect(parseMoneyInput('1.5')).toBe('1.50');
    expect(parseMoneyInput('1.50')).toBe('1.50');
    expect(parseMoneyInput('0.01')).toBe('0.01');
    expect(parseMoneyInput('999999999999.99')).toBe('999999999999.99');
  });

  it.each([
    '0',
    '0.00',
    '-1',
    '1.234',
    '1e3',
    '1,000',
    ' 1',
    '1 ',
    '',
    '.5',
    '5.',
    'abc',
    '1000000000000',
    '+1',
  ])('rejects %j with code invalid_money', (input) => {
    let caught: unknown;
    try {
      parseMoneyInput(input);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe('invalid_money');
  });

  it('exposes a zod schema that reports the code, not prose', () => {
    expect(moneyInputSchema.parse('2.5')).toBe('2.50');
    const result = moneyInputSchema.safeParse('0');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('invalid_money');
    }
  });
});

describe('float guard', () => {
  it('throws TypeError for JS numbers', () => {
    const asAny = (v: unknown) => v as string;
    expect(() => toMinor(asAny(1.5))).toThrow(TypeError);
    expect(() => addMoney(asAny(1), '1.00')).toThrow(TypeError);
    expect(() => subMoney('1.00', asAny(1))).toThrow(TypeError);
    expect(() => compareMoney(asAny(1), asAny(2))).toThrow(TypeError);
    expect(() => parseMoneyInput(asAny(5))).toThrow(TypeError);
    expect(() => sumMoney([asAny(1)])).toThrow(TypeError);
    expect(() => fromMinor(5 as unknown as bigint)).toThrow(TypeError);
  });

  it('source contains no floating point tokens', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'index.ts'), 'utf8');
    for (const token of ['Number', 'parseFloat', 'toFixed', 'Math']) {
      expect(source.includes(token), `found ${token}`).toBe(false);
    }
  });
});
