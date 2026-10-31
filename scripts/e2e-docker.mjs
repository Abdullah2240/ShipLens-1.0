// Cross-platform wrapper around the isolated E2E stack (compose.e2e.yaml).
// Plain ESM with Node built-ins only, so CI can run it before `npm ci`.
//
//   node scripts/e2e-docker.mjs up [--keep]        build and start db + app, wait healthy
//   node scripts/e2e-docker.mjs run [pw args]      run Playwright in the stack's network
//   node scripts/e2e-docker.mjs run --base-url <url> [pw args]
//                                                  run Playwright against a live URL
//   node scripts/e2e-docker.mjs down               remove the stack and its volumes
//   node scripts/e2e-docker.mjs all [--keep] [pw args]
//                                                  up, run, always down; exits with
//                                                  Playwright's exit code
//
// Environment: E2E_PROJECT (compose project, default shiplens-e2e), E2E_PORT (default
// 3100), E2E_DEMO_PASSWORD (seed password for the stack, 12+ characters; a throwaway
// default is used when unset). The password is passed through the environment only and
// is never printed.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MODES = ['up', 'run', 'down', 'all'];
export const DEFAULT_PROJECT = 'shiplens-e2e';
export const DEFAULT_PORT = '3100';
// Throwaway value for the disposable E2E database only; never used for a real deployment.
export const DEFAULT_DEMO_PASSWORD = 'e2e-throwaway-pass-0';
const COMPOSE_FILE = 'compose.e2e.yaml';
const USAGE =
  'usage: node scripts/e2e-docker.mjs <up|run|down|all> [--keep] [--base-url <url>] [playwright args...]';

/** @param {string[]} argv */
export function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (!mode || !MODES.includes(mode)) throw new Error(USAGE);

  let keep = false;
  let baseUrl;
  const playwrightArgs = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--keep') {
      keep = true;
    } else if (arg === '--base-url' || arg.startsWith('--base-url=')) {
      const value = arg === '--base-url' ? rest[(i += 1)] : arg.slice('--base-url='.length);
      if (!value || !/^https?:\/\/[^/\s]+/.test(value)) {
        throw new Error('--base-url needs an http(s) URL');
      }
      baseUrl = value.replace(/\/+$/, '');
    } else {
      playwrightArgs.push(arg);
    }
  }
  if (baseUrl !== undefined && mode !== 'run') {
    throw new Error('--base-url is only valid with the run mode');
  }
  return { mode, keep, baseUrl, playwrightArgs };
}

function checkProject(project) {
  if (project.trim().toLowerCase() === 'shiplens') {
    throw new Error('Refusing compose project "shiplens": it holds the shared dev database volume');
  }
  return project;
}

/**
 * @param {{ project?: string, mode: 'up' | 'run' | 'down' | 'logs' | 'build', playwrightArgs?: string[] }} options
 */
export function composeArgs({ project = DEFAULT_PROJECT, mode, playwrightArgs = [] }) {
  const base = ['compose', '-f', COMPOSE_FILE, '-p', checkProject(project)];
  switch (mode) {
    case 'up':
      return [...base, 'up', '-d', '--build', '--wait', 'app'];
    case 'run':
      return [
        ...base,
        'run',
        '--rm',
        '--build',
        'playwright',
        'npx',
        'playwright',
        'test',
        ...playwrightArgs,
      ];
    case 'down':
      // The runner profile makes down also remove any leftover playwright container.
      return [...base, '--profile', 'runner', 'down', '-v', '--remove-orphans'];
    case 'logs':
      return [...base, 'logs', '--tail', '200', 'app'];
    case 'build':
      return [...base, 'build', 'playwright'];
    default:
      throw new Error(`unknown compose mode: ${mode}`);
  }
}

/** @param {Record<string, string | undefined>} env */
export function laneEnv(env) {
  const project = checkProject(env.E2E_PROJECT || DEFAULT_PROJECT);
  const port = env.E2E_PORT || DEFAULT_PORT;
  const portNumber = Number(port);
  if (!/^\d+$/.test(port) || portNumber < 1 || portNumber > 65535) {
    throw new Error('E2E_PORT must be a port number between 1 and 65535');
  }
  const password = env.E2E_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
  if (password.length < 12) throw new Error('E2E_DEMO_PASSWORD must be at least 12 characters');
  return {
    E2E_PROJECT: project,
    E2E_PORT: port,
    BASE_URL: `http://localhost:${port}`,
    E2E_DEMO_PASSWORD: password,
  };
}

/**
 * `docker run` arguments for testing a live URL with the playwright image, outside the
 * compose network. Secrets are forwarded by name only (`-e NAME`), never by value.
 * @param {{ image: string, baseUrl: string, cwd: string, playwrightArgs?: string[] }} options
 */
export function externalRunArgs({ image, baseUrl, cwd, playwrightArgs = [] }) {
  const join = (p) => path.posix.join(cwd.replace(/\\/g, '/'), p);
  const mount = (source, target, readonly) =>
    `type=bind,source=${source},target=${target}${readonly ? ',readonly' : ''}`;
  return [
    'run',
    '--rm',
    '--workdir',
    '/e2e',
    '-e',
    `BASE_URL=${baseUrl}`,
    '-e',
    'E2E_DEMO_PASSWORD',
    '-e',
    'CI',
    '--mount',
    mount(join('playwright.config.ts'), '/e2e/playwright.config.ts', true),
    '--mount',
    mount(join('tests/e2e'), '/e2e/tests/e2e', true),
    '--mount',
    mount(join('test-results'), '/e2e/test-results', false),
    '--mount',
    mount(join('playwright-report'), '/e2e/playwright-report', false),
    image,
    'npx',
    'playwright',
    'test',
    ...playwrightArgs,
  ];
}

/**
 * up, run, then always down (unless keep). Returns the exit code to use.
 * @param {{ up: () => Promise<number>, run: () => Promise<number>, down: () => Promise<number>, logs: () => Promise<number> }} steps
 * @param {{ keep: boolean }} options
 */
export async function runAll(steps, { keep }) {
  try {
    const upCode = await steps.up();
    if (upCode !== 0) {
      await steps.logs();
      return upCode;
    }
    const runCode = await steps.run();
    if (runCode !== 0) await steps.logs();
    return runCode;
  } finally {
    if (!keep) await steps.down();
  }
}

function docker(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main(argv) {
  const { mode, keep, baseUrl, playwrightArgs } = parseArgs(argv);
  const lane = laneEnv(process.env);
  const env = { ...process.env, ...lane };
  const project = lane.E2E_PROJECT;
  for (const dir of ['test-results', 'playwright-report']) mkdirSync(dir, { recursive: true });

  const steps = {
    up: async () => {
      const code = await docker(composeArgs({ project, mode: 'up' }), env);
      if (code === 0) console.log(`E2E stack "${project}" is up at ${lane.BASE_URL}`);
      return code;
    },
    run: () => docker(composeArgs({ project, mode: 'run', playwrightArgs }), env),
    down: () => docker(composeArgs({ project, mode: 'down' }), env),
    logs: () => docker(composeArgs({ project, mode: 'logs' }), env),
  };

  switch (mode) {
    case 'up': {
      const code = await steps.up();
      if (code !== 0) await steps.logs();
      return code;
    }
    case 'run': {
      if (baseUrl !== undefined) {
        const build = await docker(composeArgs({ project, mode: 'build' }), env);
        if (build !== 0) return build;
        const image = `${project}-playwright`;
        return docker(externalRunArgs({ image, baseUrl, cwd: process.cwd(), playwrightArgs }), {
          ...env,
          BASE_URL: baseUrl,
        });
      }
      const code = await steps.run();
      if (code !== 0) await steps.logs();
      return code;
    }
    case 'down':
      return steps.down();
    case 'all': {
      // Ctrl+C reaches the docker child directly; ignoring it here lets teardown run.
      process.on('SIGINT', () => {});
      return runAll(steps, { keep });
    }
    default:
      throw new Error(USAGE);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
