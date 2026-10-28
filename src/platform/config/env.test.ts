import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvError, parseEnv } from './env';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('parseEnv', () => {
  it('throws naming only the variable when DATABASE_URL is missing', () => {
    try {
      parseEnv({});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      expect((err as EnvError).message).toContain('DATABASE_URL');
    }
  });

  it('never echoes values in errors', () => {
    expect(() => parseEnv({ ...base, SEED_ON_BOOT: 'true', SEED_DEMO_PASSWORD: 'tiny-secret' })).toThrow(
      /SEED_DEMO_PASSWORD/,
    );
    try {
      parseEnv({ ...base, SEED_ON_BOOT: 'true', SEED_DEMO_PASSWORD: 'tiny-secret' });
    } catch (err) {
      expect((err as Error).message).not.toContain('tiny-secret');
      expect((err as Error).message).not.toContain('postgres://');
    }
  });

  it('falls back to localhost outside production', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'development' }).APP_ORIGIN).toBe('http://localhost:3000');
  });

  it('prefers APP_ORIGIN, then RENDER_EXTERNAL_URL, and strips trailing slashes', () => {
    expect(parseEnv({ ...base, APP_ORIGIN: 'https://a.example.com/', RENDER_EXTERNAL_URL: 'https://b.example.com' }).APP_ORIGIN).toBe(
      'https://a.example.com',
    );
    expect(parseEnv({ ...base, RENDER_EXTERNAL_URL: 'https://b.example.com/' }).APP_ORIGIN).toBe('https://b.example.com');
  });

  it('requires APP_ORIGIN in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/APP_ORIGIN/);
    expect(parseEnv({ ...base, NODE_ENV: 'production', APP_ORIGIN: 'https://x.example.com' }).APP_ORIGIN).toBe(
      'https://x.example.com',
    );
  });

  it('rejects a malformed APP_ORIGIN', () => {
    expect(() => parseEnv({ ...base, APP_ORIGIN: 'not a url' })).toThrow(/APP_ORIGIN/);
  });

  it('requires SEED_DEMO_PASSWORD (min 12) only when SEED_ON_BOOT is true', () => {
    expect(parseEnv({ ...base, SEED_ON_BOOT: 'false' }).SEED_ON_BOOT).toBe(false);
    expect(() => parseEnv({ ...base, SEED_ON_BOOT: 'true' })).toThrow(/SEED_DEMO_PASSWORD/);
    expect(() => parseEnv({ ...base, SEED_ON_BOOT: 'true', SEED_DEMO_PASSWORD: 'elevenchars' })).toThrow(/SEED_DEMO_PASSWORD/);
    const ok = parseEnv({ ...base, SEED_ON_BOOT: 'true', SEED_DEMO_PASSWORD: 'twelve-chars' });
    expect(ok.SEED_ON_BOOT).toBe(true);
  });

  it('validates LOG_LEVEL with default info', () => {
    expect(parseEnv(base).LOG_LEVEL).toBe('info');
    expect(parseEnv({ ...base, LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe('debug');
    expect(() => parseEnv({ ...base, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});

describe('import-time safety', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('importing env and db with a bare production environment does not throw', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const k of ['DATABASE_URL', 'APP_ORIGIN', 'RENDER_EXTERNAL_URL', 'SEED_ON_BOOT', 'SEED_DEMO_PASSWORD']) {
      vi.stubEnv(k, '');
    }
    vi.resetModules();
    const env = await import('./env');
    const db = await import('@/platform/db');
    expect(() => env.getEnv()).toThrow(/DATABASE_URL/);
    expect(() => db.getPool()).toThrow(/DATABASE_URL/);
  });
});
