import { describe, expect, it } from 'vitest';
import { csvCell, toCsv, type CsvColumn, type CsvKind } from './index';

const BOM = '﻿';

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF records. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.startsWith(BOM) ? 1 : 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Deterministic PRNG so the round trip is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('csvCell: quoting', () => {
  it('leaves plain text alone', () => {
    expect(csvCell('Ration packs', 'text')).toBe('Ration packs');
  });

  it('quotes a comma', () => {
    expect(csvCell('a,b', 'text')).toBe('"a,b"');
  });

  it('doubles embedded quotes', () => {
    expect(csvCell('say "hi"', 'text')).toBe('"say ""hi"""');
  });

  it('quotes line breaks', () => {
    expect(csvCell('line1\nline2', 'text')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2', 'text')).toBe('"line1\r\nline2"');
  });

  it('quotes leading and trailing spaces', () => {
    expect(csvCell(' padded', 'text')).toBe('" padded"');
    expect(csvCell('padded ', 'text')).toBe('"padded "');
  });

  it('writes null as an empty cell for every kind', () => {
    for (const kind of ['text', 'money', 'int', 'date', 'datetime'] as CsvKind[]) {
      expect(csvCell(null, kind)).toBe('');
    }
  });

  it('keeps Urdu text unchanged', () => {
    expect(csvCell('راشن', 'text')).toBe('راشن');
  });
});

describe('csvCell: formula injection', () => {
  it('neutralises a formula and then quotes it', () => {
    expect(csvCell('=HYPERLINK("http://x")', 'text')).toBe(`"'=HYPERLINK(""http://x"")"`);
  });

  it.each([
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tx', "'\tx"],
    ['=cmd|', "'=cmd|"],
  ])('prefixes %j with an apostrophe', (input, expected) => {
    expect(csvCell(input, 'text')).toBe(expected);
  });

  it('prefixes a leading carriage return and quotes the result', () => {
    expect(csvCell('\rx', 'text')).toBe(`"'\rx"`);
  });

  it('leaves a dangerous character that is not first alone', () => {
    expect(csvCell('a=b', 'text')).toBe('a=b');
    expect(csvCell('Total -5', 'text')).toBe('Total -5');
  });
});

describe('csvCell: typed cells', () => {
  it('writes valid money unchanged, without an apostrophe', () => {
    expect(csvCell('1234.50', 'money')).toBe('1234.50');
    expect(csvCell('0.00', 'money')).toBe('0.00');
  });

  it('throws on malformed or wrong-typed money', () => {
    expect(() => csvCell('12.5', 'money')).toThrow();
    expect(() => csvCell('-12.50', 'money')).toThrow();
    expect(() => csvCell('=1+1', 'money')).toThrow();
    expect(() => csvCell(12.5, 'money')).toThrow();
  });

  it('writes integers unchanged, including negatives', () => {
    expect(csvCell(-3, 'int')).toBe('-3');
    expect(csvCell(42, 'int')).toBe('42');
    expect(csvCell('17', 'int')).toBe('17');
  });

  it('throws on a non-integer int cell', () => {
    expect(() => csvCell(1.5, 'int')).toThrow();
    expect(() => csvCell('1e3', 'int')).toThrow();
    expect(() => csvCell(Number.NaN, 'int')).toThrow();
  });

  it('validates dates and instants', () => {
    expect(csvCell('2026-09-01', 'date')).toBe('2026-09-01');
    expect(csvCell('2026-09-10T06:00:00.000Z', 'datetime')).toBe('2026-09-10T06:00:00.000Z');
    expect(() => csvCell('2026-9-1', 'date')).toThrow();
    expect(() => csvCell('2026-02-30', 'date')).toThrow();
    expect(() => csvCell('2026-09-10', 'datetime')).toThrow();
    expect(() => csvCell(20260901, 'date')).toThrow();
  });

  it('throws on a number in a text cell', () => {
    expect(() => csvCell(5, 'text')).toThrow();
  });
});

type Row = { name: string; amount: string; count: number; on: string };
const COLUMNS: CsvColumn<Row>[] = [
  { key: 'name', label: 'Name', kind: 'text', value: (r) => r.name },
  { key: 'amount', label: 'Amount', kind: 'money', value: (r) => r.amount },
  { key: 'count', label: 'Count', kind: 'int', value: (r) => r.count },
  { key: 'on', label: 'On', kind: 'date', value: (r) => r.on },
];

describe('toCsv', () => {
  it('starts with a BOM, uses CRLF and ends with CRLF', () => {
    const csv = toCsv(COLUMNS, [{ name: 'A', amount: '1.00', count: 1, on: '2026-09-01' }]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(`${BOM}Name,Amount,Count,On\r\nA,1.00,1,2026-09-01\r\n`);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  it('writes the header row from the labels, quoted when needed', () => {
    const csv = toCsv([{ key: 'k', label: 'Amount, PKR', kind: 'money', value: () => null }], []);
    expect(csv).toBe(`${BOM}"Amount, PKR"\r\n`);
  });

  it('appends a footer row keyed by column', () => {
    const csv = toCsv(
      COLUMNS,
      [
        { name: 'A', amount: '1.00', count: 1, on: '2026-09-01' },
        { name: 'B', amount: '2.50', count: 2, on: '2026-09-02' },
      ],
      { name: 'Total', amount: '3.50', count: 3 },
    );
    expect(csv.split('\r\n')).toEqual([
      `${BOM}Name,Amount,Count,On`,
      'A,1.00,1,2026-09-01',
      'B,2.50,2,2026-09-02',
      'Total,3.50,3,',
      '',
    ]);
  });

  it('validates footer cells by their column kind', () => {
    expect(() => toCsv(COLUMNS, [], { amount: '3.5' })).toThrow();
  });

  it('supports a per-row kind', () => {
    type Mixed = { v: string; money: boolean };
    const csv = toCsv<Mixed>(
      [{ key: 'v', label: 'V', kind: (r) => (r.money ? 'money' : 'int'), value: (r) => r.v }],
      [
        { v: '10.00', money: true },
        { v: '7', money: false },
      ],
    );
    expect(csv).toBe(`${BOM}V\r\n10.00\r\n7\r\n`);
  });

  it('round-trips 100 random rows with commas, quotes, newlines and Urdu', () => {
    const random = mulberry32(20261101);
    const pieces = [
      'a',
      'Z',
      ' ',
      ',',
      '"',
      '\n',
      '\r\n',
      'راشن',
      'وصولی',
      '=',
      '+',
      '-',
      '@',
      '\t',
      'x y',
      '1',
      "'",
    ];
    const pick = () => pieces[Math.floor(random() * pieces.length)]!;
    const text = () => Array.from({ length: 1 + Math.floor(random() * 8) }, pick).join('');
    const digits = (n: number) =>
      Array.from({ length: n }, () => String(Math.floor(random() * 10))).join('');
    const rows: Row[] = Array.from({ length: 100 }, () => ({
      name: text(),
      amount: `${String(Math.floor(random() * 100000))}.${digits(2)}`,
      count: Math.floor(random() * 2000) - 1000,
      on: `2026-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-1${Math.floor(random() * 9)}`,
    }));
    const parsed = parseCsv(toCsv(COLUMNS, rows));
    expect(parsed[0]).toEqual(['Name', 'Amount', 'Count', 'On']);
    expect(parsed).toHaveLength(101);
    rows.forEach((row, i) => {
      const [name, amount, count, on] = parsed[i + 1]!;
      const dangerous = /^[=+\-@\t\r]/.test(row.name);
      expect(dangerous ? name!.slice(1) : name).toBe(row.name);
      if (dangerous) expect(name!.startsWith("'")).toBe(true);
      expect(amount).toBe(row.amount);
      expect(count).toBe(String(row.count));
      expect(on).toBe(row.on);
    });
  });
});
