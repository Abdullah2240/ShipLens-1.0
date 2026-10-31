import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEMO_PASSWORD,
  composeArgs,
  externalRunArgs,
  laneEnv,
  parseArgs,
  runAll,
} from './e2e-docker.mjs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8').replace(/\r\n/g, '\n');

describe('parseArgs', () => {
  it('reads the mode', () => {
    expect(parseArgs(['all'])).toEqual({
      mode: 'all',
      keep: false,
      baseUrl: undefined,
      playwrightArgs: [],
    });
  });

  it('takes --base-url and forwards the rest to Playwright', () => {
    expect(parseArgs(['run', '--base-url', 'https://x.onrender.com', '--grep', '@smoke'])).toEqual({
      mode: 'run',
      keep: false,
      baseUrl: 'https://x.onrender.com',
      playwrightArgs: ['--grep', '@smoke'],
    });
  });

  it('accepts --base-url=<url>', () => {
    expect(parseArgs(['run', '--base-url=https://x.test']).baseUrl).toBe('https://x.test');
  });

  it('reads --keep', () => {
    expect(parseArgs(['up', '--keep'])).toMatchObject({ mode: 'up', keep: true });
  });

  it('throws a usage error for an unknown or missing mode', () => {
    expect(() => parseArgs(['deploy'])).toThrow(/usage/i);
    expect(() => parseArgs([])).toThrow(/usage/i);
  });

  it('rejects --base-url without a value or with a non-http URL', () => {
    expect(() => parseArgs(['run', '--base-url'])).toThrow(/base-url/);
    expect(() => parseArgs(['run', '--base-url', 'ftp://x'])).toThrow(/base-url/);
  });

  it('only allows --base-url in run mode', () => {
    expect(() => parseArgs(['all', '--base-url', 'https://x.test'])).toThrow(/run/);
  });
});

describe('composeArgs', () => {
  const base = ['compose', '-f', 'compose.e2e.yaml', '-p'];

  it('builds and waits for the app on up', () => {
    expect(composeArgs({ project: 'shiplens-e2e-0119', mode: 'up' })).toEqual([
      ...base,
      'shiplens-e2e-0119',
      'up',
      '-d',
      '--build',
      '--wait',
      'app',
    ]);
  });

  it('runs the playwright service with forwarded args', () => {
    expect(composeArgs({ mode: 'run', playwrightArgs: ['--grep', '@smoke'] })).toEqual([
      ...base,
      'shiplens-e2e',
      'run',
      '--rm',
      '--no-deps',
      '--build',
      'playwright',
      'npx',
      'playwright',
      'test',
      '--grep',
      '@smoke',
    ]);
  });

  it('removes containers, volumes and orphans on down', () => {
    const args = composeArgs({ mode: 'down' });
    expect(args.slice(0, 5)).toEqual([...base, 'shiplens-e2e']);
    expect(args.slice(-3)).toEqual(['down', '-v', '--remove-orphans']);
  });

  it('tails the app log', () => {
    expect(composeArgs({ mode: 'logs' }).slice(-4)).toEqual(['logs', '--tail', '200', 'app']);
  });

  it('defaults the project to shiplens-e2e', () => {
    expect(composeArgs({ mode: 'up' })[4]).toBe('shiplens-e2e');
  });

  it('refuses the dev project name so the dev volume is never touched', () => {
    expect(() => composeArgs({ project: 'shiplens', mode: 'down' })).toThrow(/shiplens/);
    expect(() => composeArgs({ project: ' Shiplens ', mode: 'down' })).toThrow(/shiplens/);
  });
});

describe('laneEnv', () => {
  it('uses the defaults', () => {
    expect(laneEnv({})).toEqual({
      E2E_PROJECT: 'shiplens-e2e',
      E2E_PORT: '3100',
      BASE_URL: 'http://localhost:3100',
      E2E_DEMO_PASSWORD: DEFAULT_DEMO_PASSWORD,
    });
    expect(DEFAULT_DEMO_PASSWORD.length).toBeGreaterThanOrEqual(12);
  });

  it('reads the lane variables', () => {
    const env = laneEnv({
      E2E_PROJECT: 'shiplens-e2e-0119',
      E2E_PORT: '60119',
      E2E_DEMO_PASSWORD: 'a-much-longer-pass',
    });
    expect(env).toEqual({
      E2E_PROJECT: 'shiplens-e2e-0119',
      E2E_PORT: '60119',
      BASE_URL: 'http://localhost:60119',
      E2E_DEMO_PASSWORD: 'a-much-longer-pass',
    });
  });

  it('rejects a short password without echoing it', () => {
    expect(() => laneEnv({ E2E_DEMO_PASSWORD: 'short-pw' })).toThrow(/E2E_DEMO_PASSWORD/);
    try {
      laneEnv({ E2E_DEMO_PASSWORD: 'short-pw' });
    } catch (err) {
      expect(String(err)).not.toContain('short-pw');
    }
  });

  it('rejects an invalid port', () => {
    expect(() => laneEnv({ E2E_PORT: 'abc' })).toThrow(/E2E_PORT/);
    expect(() => laneEnv({ E2E_PORT: '70000' })).toThrow(/E2E_PORT/);
  });

  it('refuses the dev project name', () => {
    expect(() => laneEnv({ E2E_PROJECT: 'shiplens' })).toThrow(/shiplens/);
  });
});

describe('externalRunArgs', () => {
  it('runs the playwright image against a live URL with the same mounts', () => {
    const args = externalRunArgs({
      image: 'shiplens-e2e-playwright',
      baseUrl: 'https://x.onrender.com',
      cwd: '/repo',
      playwrightArgs: ['--grep', '@smoke'],
    });
    expect(args.slice(0, 2)).toEqual(['run', '--rm']);
    expect(args).toContain('BASE_URL=https://x.onrender.com');
    expect(args).toContain('E2E_DEMO_PASSWORD');
    expect(args).toContain('CI');
    expect(args.join(' ')).not.toMatch(/E2E_DEMO_PASSWORD=/);
    expect(args).toContain(
      'type=bind,source=/repo/playwright.config.ts,target=/e2e/playwright.config.ts,readonly',
    );
    expect(args).toContain('type=bind,source=/repo/tests/e2e,target=/e2e/tests/e2e,readonly');
    expect(args).toContain('type=bind,source=/repo/test-results,target=/e2e/test-results');
    expect(args).toContain(
      'type=bind,source=/repo/playwright-report,target=/e2e/playwright-report',
    );
    expect(args.slice(-6)).toEqual([
      'shiplens-e2e-playwright',
      'npx',
      'playwright',
      'test',
      '--grep',
      '@smoke',
    ]);
  });
});

describe('runAll', () => {
  function recorder(codes) {
    const calls = [];
    return {
      calls,
      steps: {
        up: async () => (calls.push('up'), codes.up ?? 0),
        run: async () => (calls.push('run'), codes.run ?? 0),
        down: async () => (calls.push('down'), codes.down ?? 0),
        logs: async () => (calls.push('logs'), 0),
      },
    };
  }

  it('runs up, run, down and exits with the run code', async () => {
    const r = recorder({ run: 1 });
    expect(await runAll(r.steps, { keep: false })).toBe(1);
    expect(r.calls).toEqual(['up', 'run', 'logs', 'down']);
  });

  it('exits 0 when the run passes', async () => {
    const r = recorder({});
    expect(await runAll(r.steps, { keep: false })).toBe(0);
    expect(r.calls).toEqual(['up', 'run', 'down']);
  });

  it('tears down even when up fails or throws', async () => {
    const failed = recorder({ up: 3 });
    expect(await runAll(failed.steps, { keep: false })).toBe(3);
    expect(failed.calls).toEqual(['up', 'logs', 'down']);

    const calls = [];
    const throwing = {
      up: async () => {
        calls.push('up');
        throw new Error('boom');
      },
      run: async () => 0,
      down: async () => (calls.push('down'), 0),
      logs: async () => 0,
    };
    await expect(runAll(throwing, { keep: false })).rejects.toThrow('boom');
    expect(calls).toEqual(['up', 'down']);
  });

  it('leaves the stack up with keep', async () => {
    const r = recorder({});
    await runAll(r.steps, { keep: true });
    expect(r.calls).toEqual(['up', 'run']);
  });
});

describe('Playwright version pin', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const version = pkg.devDependencies['@playwright/test'];
  const dockerfile = read('tests/e2e/Dockerfile');

  it('is an exact version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.packages['node_modules/@playwright/test'].version).toBe(version);
  });

  it('matches the runner image tag and its install line', () => {
    expect(dockerfile).toContain(`ARG PLAYWRIGHT_VERSION=${version}\n`);
    expect(dockerfile).toContain('FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble');
    expect(dockerfile).toMatch(/RUN .*npm install .*@playwright\/test@\$\{PLAYWRIGHT_VERSION\}/);
  });
});

describe('compose.e2e.yaml', () => {
  const text = read('compose.e2e.yaml');
  const section = (name, next) => {
    const start = text.indexOf(`\n  ${name}:\n`);
    expect(start).toBeGreaterThan(-1);
    const end = next ? text.indexOf(`\n  ${next}:\n`, start + 1) : text.length;
    return text.slice(start, end === -1 ? text.length : end);
  };

  it('is its own project', () => {
    expect(text).toMatch(/^name: shiplens-e2e$/m);
  });

  it('has an isolated tmpfs database with no host port or volume', () => {
    const db = section('db', 'app');
    expect(db).toContain('image: postgres:16');
    expect(db).toContain('POSTGRES_DB: shiplens_e2e');
    expect(db).toMatch(/tmpfs:\n\s+- \/var\/lib\/postgresql\/data/);
    expect(db).not.toMatch(/^\s+volumes:/m);
    expect(db).not.toMatch(/^\s+ports:/m);
    expect(text).not.toMatch(/^volumes:/m);
  });

  it('serves the app on E2E_PORT inside and outside the container', () => {
    const app = section('app', 'playwright');
    expect(app).toContain("- '${E2E_PORT:-3100}:${E2E_PORT:-3100}'");
    expect(app).toContain("PORT: '${E2E_PORT:-3100}'");
    expect(app).toContain('APP_ORIGIN: http://localhost:${E2E_PORT:-3100}');
    expect(app).toContain('DATABASE_URL: postgres://shiplens:shiplens@db:5432/shiplens_e2e');
    expect(app).toContain("SEED_ON_BOOT: 'true'");
    expect(app).toMatch(/db:\n\s+condition: service_healthy/);
  });

  it('runs playwright in the app network namespace', () => {
    const pw = section('playwright');
    expect(pw).toContain('network_mode: service:app');
    expect(pw).toContain("profiles: ['runner']");
    expect(pw).toMatch(/app:\n\s+condition: service_healthy/);
    expect(pw).toContain('dockerfile: tests/e2e/Dockerfile');
    expect(pw).toContain('BASE_URL: http://localhost:${E2E_PORT:-3100}');
  });
});
