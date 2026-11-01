// Keep-warm self-ping for the free Render web service, which sleeps after 15 minutes
// without inbound traffic. Each server process pings its own public /api/health about
// every 10 minutes. No framework imports and no getEnv(): it reads only its own two
// variables from the env object it is given, and nothing in here may throw out of a timer.
import { logger } from '../log/logger';

export interface KeepWarmConfig {
  url: string;
  baseIntervalMs: number;
  jitterMs: number;
  firstDelayMs: number;
  firstJitterMs: number;
  timeoutMs: number;
}

type LogFields = Record<string, unknown>;

export interface KeepWarmDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  setTimeout: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimeout: (t: unknown) => void;
  /** Uniform in [0, 1). */
  random: () => number;
  log: { info(msg: string, f?: LogFields): void; warn(msg: string, f?: LogFields): void };
}

export interface KeepWarmHandle {
  stop(): void;
  readonly config: KeepWarmConfig;
}

const SINGLETON = Symbol.for('shiplens.keepwarm');
const HEALTH_PATH = '/api/health';

const DEFAULTS = {
  baseIntervalMs: 600_000,
  jitterMs: 90_000,
  firstDelayMs: 60_000,
  firstJitterMs: 30_000,
  timeoutMs: 10_000,
} as const;

/** Null unless RENDER_EXTERNAL_URL is an https: URL and KEEP_WARM is not '0'. */
export function keepWarmConfigFrom(env: Record<string, string | undefined>): KeepWarmConfig | null {
  if (env.KEEP_WARM?.trim() === '0') return null;
  const raw = env.RENDER_EXTERNAL_URL?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  return { url: new URL(HEALTH_PATH, parsed.origin).toString(), ...DEFAULTS };
}

/** base plus or minus jitter, uniformly, rounded to whole milliseconds. */
export function nextDelayMs(base: number, jitter: number, random: () => number): number {
  return Math.round(base + (random() * 2 - 1) * jitter);
}

function defaultDeps(): KeepWarmDeps {
  return {
    env: process.env,
    fetch: (input, init) => globalThis.fetch(input, init),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (t) => globalThis.clearTimeout(t as ReturnType<typeof setTimeout>),
    random: Math.random,
    log: logger,
  };
}

function errorName(err: unknown): string {
  if (err instanceof Error || err instanceof DOMException) return err.name;
  return typeof err;
}

type Store = Record<symbol, KeepWarmHandle | undefined>;

/**
 * Starts the pinger once per process and returns its handle; a second call returns the
 * running handle. Returns null, scheduling nothing, when keep-warm is not configured.
 */
export function startKeepWarm(overrides: Partial<KeepWarmDeps> = {}): KeepWarmHandle | null {
  const store = globalThis as unknown as Store;
  const existing = store[SINGLETON];
  if (existing) return existing;

  const deps: KeepWarmDeps = { ...defaultDeps(), ...overrides };
  const config = keepWarmConfigFrom(deps.env);
  if (!config) return null;

  let stopped = false;
  let inFlight = false;
  let timer: unknown = null;

  const safeLog = (level: 'info' | 'warn', msg: string, fields: LogFields) => {
    try {
      deps.log[level](msg, fields);
    } catch {
      // a broken logger must never stop the schedule
    }
  };

  const schedule = (pickDelay: () => number) => {
    if (stopped) return;
    try {
      const t = deps.setTimeout(() => void tick(), pickDelay());
      timer = t;
      t?.unref?.();
    } catch (err) {
      safeLog('warn', 'keepwarm.schedule_failed', { error: errorName(err) });
    }
  };

  const scheduleNext = () =>
    schedule(() => nextDelayMs(config.baseIntervalMs, config.jitterMs, deps.random));

  const ping = async () => {
    const started = Date.now();
    let response: Response;
    try {
      response = await deps.fetch(config.url, {
        method: 'GET',
        headers: { 'user-agent': 'shiplens-keepwarm', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      safeLog('warn', 'keepwarm.ping_failed', { error: errorName(err), ms: Date.now() - started });
      return;
    }
    const ms = Date.now() - started;
    try {
      await response.body?.cancel();
    } catch {
      // releasing the socket is best effort
    }
    if (response.ok) safeLog('info', 'keepwarm.ping', { status: response.status, ms });
    else safeLog('warn', 'keepwarm.ping_failed', { status: response.status, ms });
  };

  // Never rejects: every step is caught, so `void tick()` cannot leak a rejection.
  const tick = async () => {
    timer = null;
    if (stopped) return;
    if (inFlight) {
      // single flight: skip this round and try again next interval
      scheduleNext();
      return;
    }
    inFlight = true;
    try {
      await ping();
    } catch (err) {
      safeLog('warn', 'keepwarm.ping_failed', { error: errorName(err) });
    } finally {
      inFlight = false;
      scheduleNext();
    }
  };

  const handle: KeepWarmHandle = {
    config,
    stop() {
      stopped = true;
      if (timer !== null) {
        try {
          deps.clearTimeout(timer);
        } catch {
          // stopped is already set, so a surviving timer fires into a no-op
        }
        timer = null;
      }
      if (store[SINGLETON] === handle) delete store[SINGLETON];
    },
  };

  store[SINGLETON] = handle;
  schedule(() => config.firstDelayMs + Math.floor(deps.random() * config.firstJitterMs));
  return handle;
}
