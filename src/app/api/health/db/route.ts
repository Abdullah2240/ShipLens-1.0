// pg stays in the standalone output because platform/db imports it.
import { getPool } from '@/platform/db';
import { createDbHealthHandler } from '../handlers';

export const dynamic = 'force-dynamic';

export const GET = createDbHealthHandler(getPool);
