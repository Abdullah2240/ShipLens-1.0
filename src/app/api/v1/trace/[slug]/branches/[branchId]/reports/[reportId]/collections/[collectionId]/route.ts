import { figureFromSlug, parseReportingFilters, getCollectionEvidence } from '@/modules/reporting';
import { NotFound } from '@/platform/errors';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'trace.read' }, async (c) => {
  const figure = figureFromSlug(c.params.slug ?? '');
  if (!figure) throw new NotFound();
  return {
    data: {
      data: await getCollectionEvidence(
        c.command.pool,
        c.actor!,
        figure,
        c.params.branchId ?? '',
        c.params.reportId ?? '',
        c.params.collectionId ?? '',
        parseReportingFilters(new URL(c.req.url).searchParams),
      ),
    },
  };
});
