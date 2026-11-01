import { getReportTimeline } from '@/modules/timeline';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'audit.read_timeline' }, async (c) => ({
  data: { data: await getReportTimeline(c.command.pool, c.actor!, c.params.id ?? '') },
}));
