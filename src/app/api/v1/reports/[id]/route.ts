import { getReport } from '@/modules/reports';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'report.read' }, async (c) => ({
  data: { data: await getReport(c.command.pool, c.actor!, c.params.id ?? '') },
}));
