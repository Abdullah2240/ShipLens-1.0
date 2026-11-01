import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_PATTERN, formatCode, normaliseCode } from './code';

describe('CODE_ALPHABET', () => {
  it('has 32 unique Crockford base32 characters without I, L, O or U', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const c of ['I', 'L', 'O', 'U']) expect(CODE_ALPHABET).not.toContain(c);
  });

  it('agrees with CODE_PATTERN character by character', () => {
    for (const c of CODE_ALPHABET) expect(CODE_PATTERN.test(c.repeat(10))).toBe(true);
    for (const c of ['I', 'L', 'O', 'U', 'a', '-', ' ']) {
      expect(CODE_PATTERN.test(c.repeat(10))).toBe(false);
    }
  });
});

describe('normaliseCode', () => {
  it.each([
    ['abcde-fghjk', 'ABCDEFGHJK'],
    [' AbCdE FgHjK ', 'ABCDEFGHJK'],
    ['O0I1L-ABCDE', '00111ABCDE'],
    ['ABCDEFGHJK', 'ABCDEFGHJK'],
    ['o0il1 - zyxwv', '00111ZYXWV'],
    ['A-B-C-D-E-F-G-H-J-K', 'ABCDEFGHJK'],
  ])('accepts %j as %s', (raw, expected) => {
    expect(normaliseCode(raw)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['only separators', ' - - '],
    ['9 characters', 'ABCDE-FGHJ'],
    ['11 characters', 'ABCDE-FGHJKM'],
    ['U in the code', 'ABCDE-FGHUK'],
    ['lowercase u', 'abcdeufghj'],
    ['other punctuation', 'ABCDE_FGHJK'],
    ['a dot', 'ABCDE.FGHJK'],
    ['a tab inside', 'ABCDE\tFGHJK'],
    ['Arabic-script digits', '۱۲۳۴۵۶۷۸۹۰'],
    ['Urdu letters', 'ابپتٹثجچحخ'],
    ['dotless i that uppercases to I', 'ıBCDEFGHJK'],
    ['long s that uppercases to S', 'ſBCDEFGHJK'],
    ['fullwidth letters', 'ＡＢＣＤＥＦＧＨＪＫ'],
    ['33 characters', `ABCDEFGHJK${' '.repeat(23)}`],
    ['SQL-looking input', "' OR 1=1 --"],
  ])('rejects %s', (_label, raw) => {
    expect(normaliseCode(raw)).toBeNull();
  });

  it('accepts exactly 32 characters of input and rejects 33', () => {
    const padded32 = `ABCDE${'-'.repeat(22)}FGHJK`;
    expect(padded32).toHaveLength(32);
    expect(normaliseCode(padded32)).toBe('ABCDEFGHJK');
    expect(normaliseCode(`-${padded32}`)).toBeNull();
  });

  it('never throws on non-string input', () => {
    for (const raw of [undefined, null, 42, {}, ['ABCDEFGHJK']]) {
      expect(normaliseCode(raw as unknown as string)).toBeNull();
    }
  });

  it('returns values that always match CODE_PATTERN', () => {
    const out = normaliseCode('zz zz z-11 1o0');
    expect(out).toBe('ZZZZZ11100');
    expect(CODE_PATTERN.test(out!)).toBe(true);
  });
});

describe('formatCode', () => {
  it('groups a code as five, hyphen, five', () => {
    expect(formatCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
    expect(formatCode('0123456789')).toBe('01234-56789');
  });

  it('round-trips through normaliseCode', () => {
    expect(normaliseCode(formatCode('Z9Y8X7W6V5'))).toBe('Z9Y8X7W6V5');
  });

  it.each(['abcdefghjk', 'ABCDE-FGHJK', 'ABCDEFGHJ', 'ABCDEFGHJKM', 'ABCDEFGHJU', ''])(
    'throws on %j, which is not a stored code',
    (bad) => {
      expect(() => formatCode(bad)).toThrow(/verification code/);
    },
  );
});
