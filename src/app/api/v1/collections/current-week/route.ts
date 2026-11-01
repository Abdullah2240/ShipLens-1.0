import { getCurrentWeek } from '@/modules/collections';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'collection.create' }, async (c) => ({
  data: { data: await getCurrentWeek(c.command.pool, c.actor!, c.command.clock) },
}));
