import { figureFromSlug, parseReportingFilters, getBranchReports } from '@/modules/reporting';
import { NotFound } from '@/platform/errors';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'trace.read' }, async (c) => {
  const figure = figureFromSlug(c.params.slug ?? '');
  if (!figure) throw new NotFound();
  return {
    data: {
      data: await getBranchReports(
        c.command.pool,
        c.actor!,
        figure,
        c.params.branchId ?? '',
        parseReportingFilters(new URL(c.req.url).searchParams),
      ),
    },
  };
});
