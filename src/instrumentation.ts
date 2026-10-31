// Next.js server instrumentation hook. register() runs once per server instance (never
// during `next build`). Node.js-only work is imported dynamically behind the NEXT_RUNTIME
// check, so the edge bundle never pulls it in. register() must never throw: a failure
// here would stop the server from handling requests.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { startKeepWarm } = await import('./platform/keepwarm');
    startKeepWarm({ env: process.env });
  } catch (err) {
    try {
      const { logger } = await import('./platform/log/logger');
      logger.warn('keepwarm.start_failed', { error: err instanceof Error ? err.name : typeof err });
    } catch {
      // nothing else to do: keep-warm is optional and the server must start anyway
    }
  }
}
