import { listEntries } from '@/modules/content';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'content.read' }, async (c) => ({
  data: { data: await listEntries(c.command.pool, c.actor!) },
}));
