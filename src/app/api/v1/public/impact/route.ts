import { getPublicImpact } from '@/modules/reporting/service-impact';
import { route } from '@/platform/http/interim-route';

// Reads the database on every request (through the short impact cache); never at build time.
export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'public' }, async (c) => ({
  data: { data: await getPublicImpact(c.command.pool, c.command.clock) },
}));
