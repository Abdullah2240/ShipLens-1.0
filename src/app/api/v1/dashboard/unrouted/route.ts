import {
  REPORTING_LIMITS,
  listUnrouted,
  parsePageQuery,
  parseReportingFilters,
} from '@/modules/reporting';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'dashboard.read' }, async (c) => {
  const params = new URL(c.req.url).searchParams;
  return {
    data: {
      data: await listUnrouted(
        c.command.pool,
        c.actor!,
        {
          ...parseReportingFilters(params),
          ...parsePageQuery(params, { pageSize: REPORTING_LIMITS.unroutedPageSize }),
        },
        c.command.clock,
      ),
    },
  };
});
