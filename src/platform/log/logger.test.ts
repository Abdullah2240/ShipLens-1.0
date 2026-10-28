import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, redact } from './logger';

describe('redact', () => {
  it('redacts sensitive keys at any depth and keeps the rest', () => {
    const out = redact({
      password: 'x',
      token: 'y',
      cookie: 'z',
      authorization: 'Bearer q',
      nested: { passwordHash: 'h', email: 'a@b.c' },
    });
    expect(out).toEqual({
      password: '[redacted]',
      token: '[redacted]',
      cookie: '[redacted]',
      authorization: '[redacted]',
      nested: { passwordHash: '[redacted]', email: 'a@b.c' },
    });
  });

  it('matches keys case-insensitively and by substring', () => {
    const out = redact({ SessionToken: 'a', Set_Cookie: 'b', apiSecret: 'c', userId: 'd' });
    expect(out).toEqual({
      SessionToken: '[redacted]',
      Set_Cookie: '[redacted]',
      apiSecret: '[redacted]',
      userId: 'd',
    });
  });

  it('handles arrays', () => {
    expect(redact([{ token: 't', id: 1 }, 'plain'])).toEqual([
      { token: '[redacted]', id: 1 },
      'plain',
    ]);
  });

  it('does not throw on circular references', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = redact(a) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[circular]');
  });

  it('does not mutate its input', () => {
    const input = { password: 'x' };
    redact(input);
    expect(input.password).toBe('x');
  });

  it('serialises errors and bigints so they survive JSON', () => {
    const out = redact({ err: new Error('boom'), amount: 5n }) as {
      err: { message: string };
      amount: string;
    };
    expect(out.err.message).toBe('boom');
    expect(out.amount).toBe('5');
  });
});

describe('logger', () => {
  let out: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    out.mockRestore();
    err.mockRestore();
    vi.unstubAllEnvs();
  });

  it('is silent under NODE_ENV=test unless LOG_LEVEL is set', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', undefined);
    logger.error('hidden');
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it('writes one redacted JSON line with level, time and msg', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'info');
    logger.info('login ok', { email: 'a@b.c', password: 'hunter2' });
    expect(out).toHaveBeenCalledTimes(1);
    const line = String(out.mock.calls[0]?.[0]);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: 'info',
      msg: 'login ok',
      email: 'a@b.c',
      password: '[redacted]',
    });
    expect(typeof parsed.time).toBe('string');
    expect(line).not.toContain('hunter2');
  });

  it('sends warn and error to stderr', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'info');
    logger.warn('careful');
    logger.error('broken');
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(err.mock.calls[1]?.[0])).level).toBe('error');
  });

  it('filters by LOG_LEVEL', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'warn');
    logger.info('skipped');
    logger.warn('kept');
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('does not let fields overwrite level, time or msg', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'info');
    logger.info('real', { level: 'fake', msg: 'fake', time: 'fake' });
    const parsed = JSON.parse(String(out.mock.calls[0]?.[0]));
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('real');
    expect(parsed.time).not.toBe('fake');
  });

  it('defaults to info outside test', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', undefined);
    logger.info('shown');
    expect(out).toHaveBeenCalledTimes(1);
  });
});
