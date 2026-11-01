import { getApplication } from '@/modules/applications';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'application.read' }, async (c) => ({
  data: { data: await getApplication(c.command.pool, c.actor!, c.params.id ?? '') },
}));
