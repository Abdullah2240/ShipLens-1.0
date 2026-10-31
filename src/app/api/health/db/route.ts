import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

// Importing pg in app code is what makes Next trace it into the standalone output.
let pool: Pool | undefined;

function getPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    await getPool().query('SELECT 1');
    return Response.json({ status: 'ok', db: 'up' }, { headers });
  } catch {
    return Response.json({ status: 'error', db: 'down' }, { status: 503, headers });
  }
}
