import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8').replace(/\r\n/g, '\n');

const dockerfile = read('Dockerfile');
const lines = dockerfile.split('\n').map((l) => l.trim());
const fromLines = lines.filter((l) => /^FROM\s/i.test(l));

function stage(name) {
  const start = lines.findIndex((l) => new RegExp(`^FROM\\s.+\\sAS\\s+${name}$`, 'i').test(l));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^FROM\s/i.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

describe('Dockerfile', () => {
  it('ends with the non-root runner stage', () => {
    expect(fromLines.at(-1)).toMatch(/\sAS\s+runner$/i);
  });

  it('has a prod-deps stage installing production dependencies only', () => {
    expect(fromLines.some((l) => /\sAS\s+prod-deps$/i.test(l))).toBe(true);
    expect(stage('prod-deps').some((l) => /^RUN\s+npm ci --omit=dev/.test(l))).toBe(true);
  });

  it('never bakes runtime configuration into the image', () => {
    const configLines = lines.filter((l) => /^(ENV|ARG)\s/i.test(l));
    for (const l of configLines) {
      expect(l).not.toMatch(/DATABASE_URL|APP_ORIGIN|SEED_/);
    }
  });

  it('copies files by explicit path only', () => {
    expect(lines.some((l) => /^COPY\s+\.\s+\.$/i.test(l))).toBe(false);
  });

  it('builds with db/ available', () => {
    expect(stage('build')).toContain('COPY db ./db');
  });

  describe('runner', () => {
    const runner = stage('runner');
    const body = runner.join('\n');

    it('creates uid 10001 and runs as it', () => {
      expect(body).toMatch(/-u 10001/);
      expect(runner).toContain('USER app');
    });

    it('copies production node_modules, migrations, seed and migrate scripts', () => {
      expect(body).toMatch(
        /COPY --from=prod-deps --chown=app:app \/app\/node_modules \.\/node_modules/,
      );
      expect(body).toMatch(/COPY --from=build --chown=app:app \/app\/db \.\/db/);
      expect(body).toMatch(/\/app\/scripts\/migrate\.mjs \.\/scripts\/migrate\.mjs/);
      expect(body).toMatch(/\/app\/scripts\/lib\/password\.mjs \.\/scripts\/lib\/password\.mjs/);
    });

    it('copies prod node_modules before the standalone output', () => {
      const deps = runner.findIndex((l) => l.includes('--from=prod-deps'));
      const standalone = runner.findIndex((l) => l.includes('.next/standalone'));
      expect(deps).toBeGreaterThan(-1);
      expect(standalone).toBeGreaterThan(deps);
    });

    it('has a healthcheck on /api/health using PORT', () => {
      const hc = runner.find((l) => l.startsWith('HEALTHCHECK'));
      expect(hc).toBeDefined();
      expect(hc).toContain('/api/health');
      expect(hc).toContain('process.env.PORT');
    });

    it('migrates (and seeds) before starting the server', () => {
      const cmd = runner.find((l) => l.startsWith('CMD'));
      expect(cmd).toBeDefined();
      expect(cmd).toContain('node scripts/migrate.mjs');
      expect(cmd).toContain('exec node server.js');
      expect(cmd?.indexOf('migrate.mjs')).toBeLessThan(cmd?.indexOf('server.js') ?? -1);
    });
  });
});

describe('compose.yaml', () => {
  const compose = read('compose.yaml');

  it('keeps the shared db service definition', () => {
    for (const line of [
      '  db:',
      '    image: postgres:16',
      "      - '5434:5432'",
      '      - pgdata:/var/lib/postgresql/data',
      "      test: ['CMD-SHELL', 'pg_isready -U shiplens -d shiplens']",
      '      interval: 3s',
      '      timeout: 3s',
      '      retries: 20',
    ]) {
      expect(compose.split('\n')).toContain(line);
    }
  });

  it('adds the app service under the full profile', () => {
    const start = compose.indexOf('\n  app:');
    expect(start).toBeGreaterThan(-1);
    const app = compose.slice(start);
    expect(app).toContain("profiles: ['full']");
    expect(app).toMatch(/db:\n\s+condition: service_healthy/);
    expect(app).toContain("SEED_ON_BOOT: 'true'");
  });
});

describe('.dockerignore', () => {
  const entries = read('.dockerignore')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  it('keeps .env.example', () => {
    expect(entries).toContain('!.env.example');
  });

  it('does not ignore build inputs', () => {
    for (const dir of ['db', 'scripts', 'messages', 'src', 'public', 'tests']) {
      expect(entries).not.toContain(dir);
      expect(entries).not.toContain(`${dir}/`);
      expect(entries).not.toContain(`/${dir}`);
    }
  });
});
