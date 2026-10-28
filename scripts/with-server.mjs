import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';

// Usage: node scripts/with-server.mjs --port <n> -- <command> [args...]
// Serves the standalone build, runs one command against it, stops the server by PID.

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = sep === -1 ? argv : argv.slice(0, sep);
const command = sep === -1 ? [] : argv.slice(sep + 1);
const portIdx = opts.indexOf('--port');
const port = portIdx === -1 ? NaN : Number(opts[portIdx + 1]);

if (!Number.isInteger(port) || command.length === 0) {
  console.error('usage: node scripts/with-server.mjs --port <n> -- <command> [args...]');
  process.exit(2);
}

if (!existsSync('.next/standalone/server.js')) {
  console.error('.next/standalone/server.js not found: run npm run build');
  process.exit(2);
}

// Standalone output omits static assets and public/.
if (existsSync('.next/static')) {
  cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
}
if (existsSync('public')) {
  cpSync('public', '.next/standalone/public', { recursive: true });
}

const server = spawn(process.execPath, ['.next/standalone/server.js'], {
  env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' },
  stdio: 'inherit',
});

const exited = new Promise((resolve) => server.once('exit', resolve));
let serverDead = false;
server.once('exit', () => {
  serverDead = true;
});

async function stopServer() {
  if (serverDead) return;
  server.kill();
  await exited;
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopServer().finally(() => process.exit(130));
  });
}

async function waitReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverDead) throw new Error('server exited before becoming ready');
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not become ready within 30 s');
}

let code = 1;
try {
  await waitReady();
  const child = spawn(command[0], command.slice(1), {
    env: { ...process.env, BASE_URL: `http://127.0.0.1:${port}` },
    stdio: 'inherit',
  });
  code = await new Promise((resolve) => {
    child.once('error', (err) => {
      console.error(err.message);
      resolve(127);
    });
    child.once('exit', (c, signal) => resolve(c ?? (signal ? 1 : 0)));
  });
} catch (err) {
  console.error(err.message);
  code = 1;
} finally {
  await stopServer();
}
process.exit(code);
