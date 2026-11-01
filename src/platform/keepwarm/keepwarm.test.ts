import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepWarmConfigFrom, nextDelayMs, startKeepWarm, type KeepWarmDeps } from './index';

const KEY = Symbol.for('shiplens.keepwarm');
const ENV = { RENDER_EXTERNAL_URL: 'https://shiplens.onrender.com' };
const MINUTE = 60_000;

function okResponse(status = 200): Response {
  return new Response(null, { status });
}

function makeLog() {
  return { info: vi.fn(), warn: vi.fn() };
}

function deps(overrides: Partial<KeepWarmDeps> = {}): Partial<KeepWarmDeps> {
  return {
    env: ENV,
    fetch: vi.fn(async () => okResponse()) as unknown as typeof fetch,
    random: () => 0.5,
    log: makeLog(),
    ...overrides,
  };
}

function clearSingleton() {
  const store = globalThis as unknown as Record<symbol, { stop(): void } | undefined>;
  store[KEY]?.stop();
  delete store[KEY];
}

describe('keepWarmConfigFrom', () => {
  it('builds the health URL from the external origin', () => {
    const config = keepWarmConfigFrom(ENV);
    expect(config).toEqual({
      url: 'https://shiplens.onrender.com/api/health',
      baseIntervalMs: 600_000,
      jitterMs: 90_000,
      firstDelayMs: 60_000,
      firstJitterMs: 30_000,
      timeoutMs: 10_000,
    });
  });

  it('ignores a trailing slash, a path and a query in the env value', () => {
    expect(keepWarmConfigFrom({ RENDER_EXTERNAL_URL: 'https://shiplens.onrender.com/' })?.url).toBe(
      'https://shiplens.onrender.com/api/health',
    );
    expect(
      keepWarmConfigFrom({ RENDER_EXTERNAL_URL: 'https://shiplens.onrender.com/some/path?x=1#h' })
        ?.url,
    ).toBe('https://shiplens.onrender.com/api/health');
  });

  it.each([
    ['http URL', 'http://shiplens.onrender.com'],
    ['invalid URL', 'not a url'],
    ['empty string', ''],
    ['other scheme', 'ftp://shiplens.onrender.com'],
  ])('returns null for an %s', (_label, value) => {
    expect(keepWarmConfigFrom({ RENDER_EXTERNAL_URL: value })).toBeNull();
  });

  it('returns null when RENDER_EXTERNAL_URL is missing', () => {
    expect(keepWarmConfigFrom({})).toBeNull();
    expect(keepWarmConfigFrom({ KEEP_WARM: '1' })).toBeNull();
  });

  it('is disabled by KEEP_WARM=0 and enabled by KEEP_WARM=1 or unset', () => {
    expect(keepWarmConfigFrom({ ...ENV, KEEP_WARM: '0' })).toBeNull();
    expect(keepWarmConfigFrom({ ...ENV, KEEP_WARM: '1' })).not.toBeNull();
    expect(keepWarmConfigFrom({ ...ENV })).not.toBeNull();
  });
});

describe('nextDelayMs', () => {
  it('spreads the delay symmetrically around the base', () => {
    expect(nextDelayMs(600_000, 90_000, () => 0)).toBe(510_000);
    expect(nextDelayMs(600_000, 90_000, () => 0.5)).toBe(600_000);
    const top = nextDelayMs(600_000, 90_000, () => 0.999999);
    expect(top).toBeGreaterThan(689_000);
    expect(top).toBeLessThanOrEqual(690_000);
  });

  it('always stays within the jitter window and under 15 minutes', () => {
    for (let i = 0; i < 1000; i += 1) {
      const delay = nextDelayMs(600_000, 90_000, Math.random);
      expect(delay).toBeGreaterThanOrEqual(510_000);
      expect(delay).toBeLessThanOrEqual(690_000);
      expect(delay).toBeLessThan(900_000);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});

describe('startKeepWarm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearSingleton();
  });

  afterEach(() => {
    clearSingleton();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pings nothing before the first delay and once by the end of the first window', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    startKeepWarm(deps({ fetch: fetchMock as unknown as typeof fetch, random: Math.random }));

    await vi.advanceTimersByTimeAsync(60_000 - 1);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000 + 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a GET with a timeout signal and no-cache headers to the health URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => okResponse());
    startKeepWarm(deps({ fetch: fetchMock as unknown as typeof fetch }));
    await vi.advanceTimersByTimeAsync(90_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://shiplens.onrender.com/api/health');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({
      'user-agent': 'shiplens-keepwarm',
      'cache-control': 'no-cache',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('pings once per interval afterwards', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const log = makeLog();
    startKeepWarm(deps({ fetch: fetchMock as unknown as typeof fetch, log }));

    await vi.advanceTimersByTimeAsync(75_000); // random 0.5: first ping at 75 s
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600_000 - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    expect(log.info).toHaveBeenCalledWith(
      'keepwarm.ping',
      expect.objectContaining({ status: 200, ms: expect.any(Number) }),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('pings between 11 and 15 times in two hours with random jitter', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    startKeepWarm(deps({ fetch: fetchMock as unknown as typeof fetch, random: Math.random }));
    await vi.advanceTimersByTimeAsync(120 * MINUTE);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(11);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(15);
  });

  it.each([
    [
      'a network error',
      () => Promise.reject(new TypeError('fetch failed')),
      { error: 'TypeError' },
    ],
    ['a 503 response', () => Promise.resolve(okResponse(503)), { status: 503 }],
    [
      'a timeout abort',
      () => Promise.reject(new DOMException('The operation was aborted', 'AbortError')),
      { error: 'AbortError' },
    ],
    [
      'a synchronous throw',
      () => {
        throw new Error('boom');
      },
      { error: 'Error' },
    ],
  ])('logs keepwarm.ping_failed on %s and keeps pinging', async (_label, impl, fields) => {
    const fetchMock = vi.fn(impl);
    const log = makeLog();
    startKeepWarm(deps({ fetch: fetchMock as unknown as typeof fetch, log }));

    await vi.advanceTimersByTimeAsync(75_000);
    expect(log.warn).toHaveBeenCalledWith('keepwarm.ping_failed', expect.objectContaining(fields));
    const loggedFields = log.warn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(loggedFields).every((k) => ['status', 'error', 'ms'].includes(k))).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('survives a logger that throws without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const throwing = () => {
        throw new Error('logger down');
      };
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(async () => okResponse())
        .mockImplementation(async () => {
          throw new Error('network');
        });
      startKeepWarm(
        deps({
          fetch: fetchMock as unknown as typeof fetch,
          log: { info: throwing, warn: throwing },
        }),
      );

      await vi.advanceTimersByTimeAsync(75_000 + 600_000 * 2);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('unrefs every timer it schedules', async () => {
    const unrefs: ReturnType<typeof vi.fn>[] = [];
    const setTimeoutSpy = vi.fn((fn: () => void, ms: number) => {
      const handle = globalThis.setTimeout(fn, ms);
      const unref = vi.fn();
      unrefs.push(unref);
      return { unref, handle };
    });
    const handle = startKeepWarm(
      deps({ setTimeout: setTimeoutSpy, clearTimeout: () => undefined }),
    );
    expect(handle).not.toBeNull();

    await vi.advanceTimersByTimeAsync(75_000 + 600_000);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
    expect(unrefs).toHaveLength(3);
    for (const unref of unrefs) expect(unref).toHaveBeenCalledTimes(1);
  });

  it('really unrefs the default Node.js timers', () => {
    vi.useRealTimers();
    const realSetTimeout = globalThis.setTimeout;
    let captured: NodeJS.Timeout | undefined;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
      captured = realSetTimeout(fn, ms);
      return captured;
    }) as typeof setTimeout);

    const handle = startKeepWarm({ env: ENV, log: makeLog() });
    expect(captured).toBeDefined();
    expect(captured?.hasRef()).toBe(false);
    handle?.stop();
  });

  it('is a per-process singleton', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const setTimeoutSpy = vi.fn((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
    const first = startKeepWarm(
      deps({ fetch: fetchMock as unknown as typeof fetch, setTimeout: setTimeoutSpy }),
    );
    const second = startKeepWarm(
      deps({ fetch: fetchMock as unknown as typeof fetch, setTimeout: setTimeoutSpy }),
    );

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels the next ping and frees the singleton', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const first = startKeepWarm(deps({ fetch: fetchMock as unknown as typeof fetch }));
    await vi.advanceTimersByTimeAsync(75_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    first?.stop();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = startKeepWarm(deps({ fetch: fetchMock as unknown as typeof fetch }));
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    await vi.advanceTimersByTimeAsync(75_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stop() during a ping prevents the follow-up schedule', async () => {
    let resolveFetch: (r: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const handle = startKeepWarm(deps({ fetch: fetchMock as unknown as typeof fetch }));
    await vi.advanceTimersByTimeAsync(75_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    handle?.stop();
    resolveFetch(okResponse());
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes its config on the handle', () => {
    const handle = startKeepWarm(deps());
    expect(handle?.config.url).toBe('https://shiplens.onrender.com/api/health');
  });

  it.each([
    ['KEEP_WARM=0', { ...ENV, KEEP_WARM: '0' }],
    ['no RENDER_EXTERNAL_URL', {}],
    ['an http URL', { RENDER_EXTERNAL_URL: 'http://localhost:3000' }],
  ])('returns null and schedules nothing with %s', (_label, env) => {
    const setTimeoutSpy = vi.fn();
    const handle = startKeepWarm(deps({ env, setTimeout: setTimeoutSpy }));
    expect(handle).toBeNull();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect((globalThis as unknown as Record<symbol, unknown>)[KEY]).toBeUndefined();
  });
});
