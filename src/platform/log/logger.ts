// Structured JSON-line logger with key-based redaction. No framework imports and no
// import of the env module: the level is read per call so tests and scripts can change it.

const SENSITIVE_KEY = /pass|token|secret|cookie|authorization|hash/i;
const REDACTED = '[redacted]';
const CIRCULAR = '[circular]';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function walk(value: unknown, ancestors: object[]): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.includes(value)) return CIRCULAR;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();

  const next = [...ancestors, value];
  if (Array.isArray(value)) return value.map((item) => walk(item, next));

  const source: Record<string, unknown> =
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : (value as Record<string, unknown>);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : walk(item, next);
  }
  return result;
}

/** Deep copy with values of sensitive keys replaced. Never mutates the input. */
export function redact(value: unknown): unknown {
  return walk(value, []);
}

function threshold(): number {
  const configured = process.env.LOG_LEVEL;
  if (configured === undefined || configured === '') {
    return process.env.NODE_ENV === 'test' ? Infinity : ORDER.info;
  }
  return configured in ORDER ? ORDER[configured as Level] : ORDER.info;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  const safe = fields ? (redact(fields) as Record<string, unknown>) : {};
  const line = JSON.stringify({ ...safe, level, time: new Date().toISOString(), msg });
  const stream = ORDER[level] >= ORDER.warn ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
