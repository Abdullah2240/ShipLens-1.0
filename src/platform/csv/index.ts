// CSV writer for spreadsheet downloads. Pure: no framework, no IO.
// UTF-8 BOM (so spreadsheet apps detect Urdu correctly), CRLF records, RFC 4180 quoting.
// Text cells that a spreadsheet would read as a formula are neutralised with a leading
// apostrophe; money, integer and date cells are validated and written unchanged.

export type CsvKind = 'text' | 'money' | 'int' | 'date' | 'datetime';
export type CsvValue = string | number | null;

export interface CsvColumn<T> {
  key: string;
  label: string;
  /** One kind for the column, or a kind per row (for a mixed value column). */
  kind: CsvKind | ((row: T) => CsvKind);
  value: (row: T) => CsvValue;
}

const BOM = '﻿';
const EOL = '\r\n';
const MONEY = /^\d+\.\d{2}$/;
const INT = /^-?\d+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function invalid(kind: CsvKind, value: CsvValue): never {
  throw new TypeError(`invalid ${kind} csv cell: ${JSON.stringify(value)}`);
}

function isCalendarDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const utc = new Date(Date.UTC(+y!, +m! - 1, +d!));
  return utc.getUTCFullYear() === +y! && utc.getUTCMonth() === +m! - 1 && utc.getUTCDate() === +d!;
}

function typed(value: CsvValue, kind: CsvKind): string {
  switch (kind) {
    case 'money':
      if (typeof value !== 'string' || !MONEY.test(value)) invalid(kind, value);
      return value;
    case 'int':
      if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) invalid(kind, value);
        return String(value);
      }
      if (typeof value !== 'string' || !INT.test(value)) invalid(kind, value);
      return value;
    case 'date':
      if (typeof value !== 'string' || !isCalendarDate(value)) invalid(kind, value);
      return value;
    case 'datetime':
      if (typeof value !== 'string' || !DATETIME.test(value)) invalid(kind, value);
      return value;
    case 'text':
      if (typeof value !== 'string') invalid(kind, value);
      return FORMULA_START.test(value) ? `'${value}` : value;
    default:
      throw new TypeError(`unknown csv kind: ${String(kind)}`);
  }
}

/** One cell: validated (typed kinds) or neutralised (text), then quoted when needed. */
export function csvCell(value: CsvValue, kind: CsvKind): string {
  if (value === null) return '';
  const text = typed(value, kind);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function kindOf<T>(column: CsvColumn<T>, row: T): CsvKind {
  return typeof column.kind === 'function' ? column.kind(row) : column.kind;
}

/**
 * The whole file: BOM, header row from the labels, one record per row, then an optional
 * footer row keyed by column key (cells validated by the column kind; a column with a
 * per-row kind takes text in the footer). Every record ends with CRLF.
 */
export function toCsv<T>(
  columns: CsvColumn<T>[],
  rows: T[],
  footer?: Record<string, CsvValue>,
): string {
  const lines = [columns.map((c) => csvCell(c.label, 'text')).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value(row), kindOf(c, row))).join(','));
  }
  if (footer) {
    lines.push(
      columns
        .map((c) =>
          csvCell(
            Object.hasOwn(footer, c.key) ? (footer[c.key] ?? null) : null,
            typeof c.kind === 'function' ? 'text' : c.kind,
          ),
        )
        .join(','),
    );
  }
  return BOM + lines.join(EOL) + EOL;
}
