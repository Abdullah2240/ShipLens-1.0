import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startKeepWarm = vi.fn();
const warn = vi.fn();

vi.mock('./platform/keepwarm', () => ({ startKeepWarm }));
vi.mock('./platform/log/logger', () => ({ logger: { warn } }));

const { register } = await import('./instrumentation');

describe('instrumentation register()', () => {
  const originalRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    startKeepWarm.mockReset();
    warn.mockReset();
  });

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
  });

  it('starts keep-warm with the process env in the Node.js runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    await register();
    expect(startKeepWarm).toHaveBeenCalledTimes(1);
    expect(startKeepWarm).toHaveBeenCalledWith({ env: process.env });
  });

  it('does nothing in the edge runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    await register();
    expect(startKeepWarm).not.toHaveBeenCalled();
  });

  it('does nothing when the runtime is unset', async () => {
    delete process.env.NEXT_RUNTIME;
    await register();
    expect(startKeepWarm).not.toHaveBeenCalled();
  });

  it('never throws when keep-warm fails to start, and logs only the error name', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    startKeepWarm.mockImplementation(() => {
      throw new RangeError('bad config');
    });
    await expect(register()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('keepwarm.start_failed', { error: 'RangeError' });
  });

  it('never throws even when logging the failure also fails', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    startKeepWarm.mockImplementation(() => {
      throw new Error('boom');
    });
    warn.mockImplementation(() => {
      throw new Error('logger down');
    });
    await expect(register()).resolves.toBeUndefined();
  });
});
