// Money is a decimal string end to end. All arithmetic runs on BigInt minor units
// (scale 2). Floating point is never used in this module.
import { z } from 'zod';

export type MoneyString = string;

// Matches numeric(14,2): scale 2, at most 12 integer digits for user input.
const SCALE = 2;
const MAX_INTEGER_DIGITS = 12;

const ARITHMETIC_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const INPUT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

function assertString(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`${what} must be a decimal string, got ${typeof value}`);
  }
}

function moneyError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'invalid_money' });
}

function pad(fraction: string | undefined): string {
  return (fraction ?? '').padEnd(SCALE, '0');
}

/** Decimal string to BigInt minor units. Accepts a leading minus (arithmetic results). */
export function toMinor(value: MoneyString): bigint {
  assertString(value, 'money');
  const match = ARITHMETIC_PATTERN.exec(value);
  if (!match) throw moneyError('invalid money string');
  const [, sign, integer, fraction] = match;
  const minor = BigInt(`${integer}${pad(fraction)}`);
  return sign === '-' ? -minor : minor;
}

/** BigInt minor units to a canonical two-decimal string. Zero never carries a sign. */
export function fromMinor(minor: bigint): MoneyString {
  if (typeof minor !== 'bigint') {
    throw new TypeError(`minor units must be a bigint, got ${typeof minor}`);
  }
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(SCALE + 1, '0');
  const integer = digits.slice(0, digits.length - SCALE);
  const fraction = digits.slice(digits.length - SCALE);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

export function addMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fromMinor(toMinor(a) + toMinor(b));
}

export function subMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fromMinor(toMinor(a) - toMinor(b));
}

export function sumMoney(values: readonly MoneyString[]): MoneyString {
  let total = 0n;
  for (const value of values) total += toMinor(value);
  return fromMinor(total);
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareMoney(a: MoneyString, b: MoneyString): -1 | 0 | 1 {
  const left = toMinor(a);
  const right = toMinor(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Gate for user-entered amounts: positive, at most two decimals, at most 12 integer
 * digits. Returns the canonical two-decimal string. Throws an Error with code
 * `invalid_money`.
 */
export function parseMoneyInput(value: string): MoneyString {
  assertString(value, 'money input');
  const match = INPUT_PATTERN.exec(value);
  if (!match) throw moneyError('invalid money input');
  const [, integer = '', fraction] = match;
  if (integer.replace(/^0+/, '').length > MAX_INTEGER_DIGITS) {
    throw moneyError('money input has too many integer digits');
  }
  const minor = BigInt(`${integer}${pad(fraction)}`);
  if (minor <= 0n) throw moneyError('money input must be positive');
  return fromMinor(minor);
}

/** Zod 4 schema over parseMoneyInput. Issue messages are codes, not prose. */
export const moneyInputSchema = z.string().transform((value, ctx) => {
  try {
    return parseMoneyInput(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid_money' });
    return z.NEVER;
  }
});
