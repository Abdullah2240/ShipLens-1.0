// Health check handlers, built by factories so tests can inject a pool. The route files
// only wire them up; Next.js allows a route module to export nothing but its handlers
// and route config, so the factories live here.

type HealthPool = { query: (sql: string) => Promise<unknown> };

export const DB_HEALTH_TIMEOUT_MS = 2000;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Liveness: answers without touching the database. */
export function createHealthHandler() {
  return async function GET(): Promise<Response> {
    return Response.json({ status: 'ok' }, { headers: NO_STORE });
  };
}

/**
 * Readiness: runs SELECT 1 with a time limit. getPool is called inside the handler, never
 * at import, so building the app needs no DATABASE_URL. A failure answers 503 with no
 * error text, host or connection string in the body.
 */
export function createDbHealthHandler(
  getPool: () => HealthPool,
  timeoutMs: number = DB_HEALTH_TIMEOUT_MS,
) {
  return async function GET(): Promise<Response> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('database health check timed out')), timeoutMs);
      });
      await Promise.race([Promise.resolve().then(() => getPool().query('SELECT 1')), timeout]);
      return Response.json({ status: 'ok', db: 'up' }, { headers: NO_STORE });
    } catch {
      return Response.json({ status: 'error', db: 'down' }, { status: 503, headers: NO_STORE });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
