import {
  REPORTING_LIMITS,
  listRecentlyRouted,
  parsePageQuery,
  parseReportingFilters,
} from '@/modules/reporting';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'dashboard.read' }, async (c) => {
  const params = new URL(c.req.url).searchParams;
  return {
    data: {
      data: await listRecentlyRouted(c.command.pool, c.actor!, {
        branch: parseReportingFilters(params).branch,
        ...parsePageQuery(params, { pageSize: REPORTING_LIMITS.unroutedPageSize }),
      }),
    },
  };
});
