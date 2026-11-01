import {
  figureFromSlug,
  isMoneyFigure,
  parseReportingFilters,
  flattenLabels,
  isExportKind,
  type ExportLabels,
  exportCsv,
} from '@/modules/reporting';
import { Forbidden, NotFound } from '@/platform/errors';
import { route } from '@/platform/http/route';
import enExports from '../../../../../../messages/en/exports.json';
import enTrace from '../../../../../../messages/en/trace.json';
import urExports from '../../../../../../messages/ur/exports.json';
import urTrace from '../../../../../../messages/ur/trace.json';

export const dynamic = 'force-dynamic';

function labelsOf(exportsMessages: { csv: unknown }, trace: { figures: unknown }): ExportLabels {
  const figures = flattenLabels(trace.figures);
  const names = Object.fromEntries(
    Object.entries(figures)
      .filter(([key]) => key.endsWith('.label'))
      .map(([key, value]) => [`figures.${key.slice(0, -'.label'.length)}`, value]),
  );
  return { ...flattenLabels(exportsMessages.csv), ...names };
}

const LABELS: Record<'en' | 'ur', ExportLabels> = {
  en: labelsOf(enExports, enTrace),
  ur: labelsOf(urExports, urTrace),
};

// A CSV download is an audited read: a cross-site navigation must not be able to start one.
const ALLOWED_FETCH_SITES = ['same-origin', 'none'];

export const GET = route(
  { auth: 'session', action: 'export.create', mutating: false },
  async (c) => {
    const site = c.req.headers.get('sec-fetch-site');
    if (site !== null && !ALLOWED_FETCH_SITES.includes(site.trim().toLowerCase())) {
      throw new Forbidden();
    }
    const kind = c.params.kind ?? '';
    if (!isExportKind(kind)) throw new NotFound();

    const params = new URL(c.req.url).searchParams;
    const slug = params.get('figure');
    const figure = slug === null ? 'approved' : figureFromSlug(slug);
    if (!isMoneyFigure(figure)) throw new NotFound();
    const reportId = params.get('reportId') ?? undefined;
    const locale = params.get('locale') === 'ur' ? 'ur' : 'en';

    const file = await exportCsv(
      c.command,
      kind,
      { ...parseReportingFilters(params), figure, reportId },
      LABELS[locale],
    );
    return new Response(file.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
      },
    });
  },
);
