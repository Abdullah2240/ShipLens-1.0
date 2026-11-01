import { afterEach, describe, expect, it, vi } from 'vitest';

// The page CSP has no 'unsafe-eval'. Zod's object schemas probe for eval with
// `new Function('')` when they are built; the probe is caught, but the browser still
// reports a securitypolicyviolation. The client instrumentation must switch that off
// before any client component builds a schema.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client instrumentation', () => {
  it('turns zod JIT off, so building and parsing a schema never constructs a Function', async () => {
    const constructed = vi.fn();
    const RealFunction = globalThis.Function;
    vi.stubGlobal(
      'Function',
      new Proxy(RealFunction, {
        construct(target, args) {
          constructed(args);
          return Reflect.construct(target, args) as object;
        },
      }),
    );

    await import('./instrumentation-client');
    const { z } = await import('zod');

    expect(z.config().jitless).toBe(true);
    const schema = z.object({ name: z.string().min(1), amount: z.string() });
    expect(schema.parse({ name: 'Lahore', amount: '2500.00' })).toEqual({
      name: 'Lahore',
      amount: '2500.00',
    });
    expect(schema.safeParse({ name: '', amount: 1 }).success).toBe(false);
    expect(constructed).not.toHaveBeenCalled();
  });
});
