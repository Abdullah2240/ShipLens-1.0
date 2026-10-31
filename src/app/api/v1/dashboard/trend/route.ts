import { getMonthlyTrend, parseReportingFilters } from '@/modules/reporting';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'dashboard.read' }, async (c) => ({
  data: {
    data: await getMonthlyTrend(
      c.command.pool,
      c.actor!,
      parseReportingFilters(new URL(c.req.url).searchParams),
      c.command.clock,
    ),
  },
}));
