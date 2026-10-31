import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatMonth } from '@/components/figures';
import { Bdi, IdText, MoneyText } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import { getBranch } from '@/modules/branches';
import {
  COUNT_FIGURES,
  MONEY_FIGURES,
  getDashboardSummary,
  getMonthlyTrend,
  parseReportingFilters,
  toSearchParams,
  type FigureId,
} from '@/modules/reporting';
import { filterChipTexts } from '@/modules/reporting/components/dashboard/dashboard-view-model';
import { PrintButton } from '@/modules/reporting/components/print/PrintButton';
import {
  PrintDate,
  PrintMeta,
  PrintSection,
  PrintSheet,
  PrintTable,
  PrintToolbar,
} from '@/modules/reporting/components/print/PrintSheet';
import { getFigureByBranch } from '@/modules/reporting/service-trace';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';
import { formatInt } from '@/platform/i18n/format';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'exports.print' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('summaryTitle')} | ${common('appName')}`, robots: { index: false } };
}

const FIGURE_ORDER: FigureId[] = [...MONEY_FIGURES, ...COUNT_FIGURES];

export default async function PrintSummaryPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale: rawLocale } = await params;
  setRequestLocale(rawLocale);
  const locale = rawLocale as Locale;
  const { actor, user } = await requirePageActor();
  const filters = parseReportingFilters(await searchParams);
  const pool = getPool();

  // The same services and filters as the dashboard, so printed totals equal the screen.
  const [summary, trend, byBranch] = await orNotFound(
    Promise.all([
      getDashboardSummary(pool, actor, filters),
      getMonthlyTrend(pool, actor, filters),
      getFigureByBranch(pool, actor, 'approved', filters),
    ]),
  );
  const f = summary.filters;
  const branchName = f.branch
    ? await getBranch(pool, actor, f.branch).then(
        (branch) => branch.name,
        () => null,
      )
    : null;

  const [t, csv, tf, tt] = await Promise.all([
    getTranslations('exports.print'),
    getTranslations('exports.csv'),
    getTranslations('dashboard.filters'),
    getTranslations('trace'),
  ]);
  const label = (id: FigureId) => tt(`figures.${id}.label`);
  const money = summary.figures;

  const chips = filterChipTexts(f, {
    t: (key, values) => tf(key, values),
    allTime: tt('filter.allTime'),
    formatMonth: (month) => formatMonth(month, locale),
    branchName,
  });
  const monthsText = chips.find((c) => c.kind === 'months')?.text ?? tt('filter.allTime');
  const branchChip = chips.find((c) => c.kind === 'branch');

  const figureRows = FIGURE_ORDER.map((id) => {
    const figure = summary.figures[id];
    return {
      key: id,
      cells: [
        label(id),
        figure.measure === 'amount' ? (
          <MoneyText key="value" amount={figure.value} />
        ) : (
          <bdi key="value" className="tabular">
            {formatInt(figure.value, locale)}
          </bdi>
        ),
        <bdi key="records" className="tabular">
          {formatInt(figure.recordCount, locale)}
        </bdi>,
      ],
    };
  });
  const branchRows = byBranch.rows.map((row) => ({
    key: row.branchId,
    cells: [
      <bdi key="code" dir="ltr" className="font-mono text-[0.92em] [unicode-bidi:isolate]">
        {row.branchCode}
      </bdi>,
      <Bdi key="name">{row.branchName}</Bdi>,
      <bdi key="reports" className="tabular">
        {formatInt(row.reportCount, locale)}
      </bdi>,
      <bdi key="collections" className="tabular">
        {formatInt(row.recordCount, locale)}
      </bdi>,
      <MoneyText key="value" amount={row.value} />,
    ],
  }));
  const monthRows = trend.months.map((m) => ({
    key: m.month,
    cells: [
      <bdi key="month">{formatMonth(m.month, locale)}</bdi>,
      <MoneyText key="approved" amount={m.approved} />,
      <MoneyText key="pending" amount={m.pendingApproval} />,
      <MoneyText key="progress" amount={m.inProgress} />,
      <MoneyText key="collected" amount={m.collected} />,
    ],
  }));
  const rowCount = figureRows.length + branchRows.length + monthRows.length;
  const branchReports = byBranch.rows.reduce((n, row) => n + row.reportCount, 0);
  const branchCollections = byBranch.rows.reduce((n, row) => n + row.recordCount, 0);

  const identities = [
    {
      key: 'collected',
      holds: summary.identities.collected,
      whole: 'collected' as const,
      parts: ['approved', 'pending_approval', 'in_progress'] as const,
    },
    {
      key: 'approved',
      holds: summary.identities.approved,
      whole: 'approved' as const,
      parts: ['routed', 'not_yet_routed'] as const,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PrintToolbar backHref={`/dashboard${toSearchParams(f)}`}>
        <PrintButton kind="print_summary" rowCount={rowCount} />
      </PrintToolbar>

      <PrintSheet
        title={t('summaryTitle')}
        meta={
          <PrintMeta
            label={t('filters')}
            items={[
              { key: 'months', label: tf('months'), value: <bdi>{monthsText}</bdi> },
              {
                key: 'branch',
                label: tf('branch'),
                value: !branchChip ? (
                  t('allBranches')
                ) : branchChip.isId ? (
                  <IdText id={branchChip.text} mono />
                ) : (
                  <Bdi>{branchChip.text}</Bdi>
                ),
              },
              { key: 'asOf', label: t('asOf'), value: <PrintDate value={summary.asOf} withTime /> },
              { key: 'for', label: t('generatedFor'), value: <Bdi>{user.name}</Bdi> },
            ]}
          />
        }
      >
        <PrintSection title={t('figures')}>
          <PrintTable
            caption={t('figures')}
            columns={[
              { key: 'figure', header: csv('figure') },
              { key: 'value', header: csv('value'), numeric: true },
              { key: 'records', header: csv('records'), numeric: true },
            ]}
            rows={figureRows}
          />
          <div data-print-row className="flex flex-col gap-2 pt-1">
            <p className="text-xs font-semibold text-text-muted">{tt('explain.identities')}</p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {identities.map((identity) => (
                <li
                  key={identity.key}
                  data-identity={identity.key}
                  data-holds={identity.holds}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
                >
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-medium">{label(identity.whole)}</span>
                    <MoneyText amount={money[identity.whole].value} />
                    <span aria-hidden="true">=</span>
                    {identity.parts.map((part, i) => (
                      <span key={part} className="inline-flex items-baseline gap-x-1.5">
                        {i > 0 ? <span aria-hidden="true">+</span> : null}
                        <span>{label(part)}</span>
                        <MoneyText amount={money[part].value} />
                      </span>
                    ))}
                  </span>
                  <span className="text-xs font-semibold">
                    {identity.holds ? tt('explain.holds') : tt('explain.broken')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </PrintSection>

        <PrintSection title={t('byBranch')} note={t('byBranchNote')}>
          <PrintTable
            caption={t('byBranch')}
            columns={[
              { key: 'code', header: csv('branchCode') },
              { key: 'name', header: csv('branchName') },
              { key: 'reports', header: t('columns.reports'), numeric: true },
              { key: 'collections', header: csv('collections'), numeric: true },
              { key: 'value', header: csv('amount'), numeric: true },
            ]}
            rows={branchRows}
            empty={t('noRows')}
            footer={[
              csv('total'),
              '',
              <bdi key="reports" className="tabular">
                {formatInt(branchReports, locale)}
              </bdi>,
              <bdi key="count" className="tabular">
                {formatInt(branchCollections, locale)}
              </bdi>,
              <MoneyText key="total" amount={byBranch.total} />,
            ]}
          />
        </PrintSection>

        <PrintSection title={t('monthly')}>
          <PrintTable
            caption={t('monthly')}
            columns={[
              { key: 'month', header: t('columns.month') },
              { key: 'approved', header: label('approved'), numeric: true },
              { key: 'pending', header: label('pending_approval'), numeric: true },
              { key: 'progress', header: label('in_progress'), numeric: true },
              { key: 'collected', header: label('collected'), numeric: true },
            ]}
            rows={monthRows}
            empty={t('noRows')}
            footer={[
              csv('total'),
              <MoneyText key="approved" amount={trend.totals.approved} />,
              <MoneyText key="pending" amount={trend.totals.pendingApproval} />,
              <MoneyText key="progress" amount={trend.totals.inProgress} />,
              <MoneyText key="collected" amount={trend.totals.collected} />,
            ]}
          />
        </PrintSection>

        <PrintSection title={t('unrouted')}>
          <div
            data-print-row
            data-unrouted
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1"
          >
            <p className="text-sm text-text-muted">
              {t('unroutedNote', { count: money.not_yet_routed.recordCount })}
            </p>
            <p className="text-xl font-semibold">
              <MoneyText amount={money.not_yet_routed.value} />
            </p>
          </div>
        </PrintSection>
      </PrintSheet>
    </div>
  );
}
