import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Bdi, MoneyText } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import { traceHref, type MoneyFigureId, getPrintableReport } from '@/modules/reporting';
import { PrintButton } from '@/modules/reporting/components/print/PrintButton';
import {
  PrintDate,
  PrintMeta,
  PrintSection,
  PrintSheet,
  PrintTable,
  PrintToolbar,
} from '@/modules/reporting/components/print/PrintSheet';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';
import { formatDate, formatInt } from '@/platform/i18n/format';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; reportId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'exports.print' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('reportTitle')} | ${common('appName')}`, robots: { index: false } };
}

// The drill-down figure a report's collections count towards, for the back link.
const STATUS_FIGURE: Record<string, MoneyFigureId> = {
  approved: 'approved',
  submitted: 'pending_approval',
  draft: 'in_progress',
  returned: 'in_progress',
};

const STATUSES = ['draft', 'submitted', 'returned', 'approved'] as const;
const EVENT_TYPES = ['submitted', 'resubmitted', 'returned', 'approved'] as const;

export default async function PrintReportPage({ params }: { params: Params }) {
  const { locale: rawLocale, reportId } = await params;
  setRequestLocale(rawLocale);
  const locale = rawLocale as Locale;
  const { actor, user } = await requirePageActor();
  const printable = await orNotFound(getPrintableReport(getPool(), actor, reportId));
  const { branch, report, events, collections } = printable;

  const [t, csv, common, reportEvents] = await Promise.all([
    getTranslations('exports.print'),
    getTranslations('exports.csv'),
    getTranslations('common'),
    getTranslations('reports.events'),
  ]);
  const statusLabel = (status: string) =>
    (STATUSES as readonly string[]).includes(status)
      ? common(`status.${status as (typeof STATUSES)[number]}`)
      : status;
  const eventLabel = (type: string) =>
    (EVENT_TYPES as readonly string[]).includes(type)
      ? reportEvents(type as (typeof EVENT_TYPES)[number])
      : type;

  const figure = STATUS_FIGURE[report.status];
  const backHref =
    figure && printable.count > 0
      ? traceHref(figure, { branchId: branch.branchId, reportId: report.reportId }, {})
      : '/dashboard';

  const collectionRows = collections.map((c, i) => ({
    key: `${c.collectedOn}-${i}`,
    cells: [
      <PrintDate key="date" value={c.collectedOn} />,
      <Bdi key="purpose">{c.purpose}</Bdi>,
      c.routedAt ? (
        <PrintDate key="routed" value={c.routedAt} withTime />
      ) : (
        <span key="routed" className="text-text-muted">
          {t('notRouted')}
        </span>
      ),
      <MoneyText key="amount" amount={c.amount} />,
    ],
  }));
  const eventRows = events.map((e) => ({
    key: e.id,
    cells: [
      <PrintDate key="time" value={e.occurredAt} withTime />,
      eventLabel(e.type),
      e.actorName ? <Bdi key="by">{e.actorName}</Bdi> : '',
      e.reason ? <Bdi key="reason">{e.reason}</Bdi> : '',
    ],
  }));
  const rowCount = collectionRows.length + eventRows.length;

  return (
    <div className="flex flex-col gap-6">
      <PrintToolbar backHref={backHref}>
        <PrintButton kind="print_report" reportId={report.reportId} rowCount={rowCount} />
      </PrintToolbar>

      <PrintSheet
        title={
          <span className="flex flex-col gap-1">
            <span>{t('reportTitle')}</span>
            <span className="text-base font-medium text-text-muted">
              <bdi dir="ltr" className="font-mono [unicode-bidi:isolate]">
                {branch.branchCode}
              </bdi>{' '}
              <Bdi>{branch.branchName}</Bdi>
              {branch.city ? (
                <>
                  {' · '}
                  <Bdi>{branch.city}</Bdi>
                </>
              ) : null}
            </span>
          </span>
        }
        meta={
          <PrintMeta
            label={t('filters')}
            items={[
              {
                key: 'week',
                label: t('week'),
                value: (
                  <bdi className="tabular">
                    {t('weekRange', {
                      start: formatDate(report.weekStart, locale),
                      end: formatDate(report.weekEnd, locale),
                    })}
                  </bdi>
                ),
              },
              {
                key: 'status',
                label: t('status'),
                value: <span data-report-status={report.status}>{statusLabel(report.status)}</span>,
              },
              {
                key: 'asOf',
                label: t('asOf'),
                value: <PrintDate value={printable.asOf} withTime />,
              },
              { key: 'for', label: t('generatedFor'), value: <Bdi>{user.name}</Bdi> },
            ]}
          />
        }
      >
        <section
          aria-label={t('frozenTotal')}
          data-print-row
          className="grid grid-cols-1 gap-4 border-y border-border py-4 sm:grid-cols-3"
        >
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-text-muted">{t('frozenTotal')}</p>
            <p className="text-xl font-semibold" data-frozen-total>
              {report.frozenAmount !== null ? (
                <MoneyText amount={report.frozenAmount} />
              ) : (
                <span className="text-base font-normal text-text-muted">{t('notSubmitted')}</span>
              )}
            </p>
            {report.frozenMatchesLive !== null ? (
              <p className="text-xs font-medium text-text-muted">
                {report.frozenMatchesLive ? t('frozenMatches') : t('frozenDiffers')}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-text-muted">{t('liveTotal')}</p>
            <p className="text-xl font-semibold" data-live-total>
              <MoneyText amount={printable.total} />
            </p>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-text-muted">{t('collections')}</p>
            <p className="text-xl font-semibold tabular">
              <bdi>{formatInt(printable.count, locale)}</bdi>
            </p>
          </div>
        </section>

        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-text-muted">{t('submitted')}</dt>
            <dd className="flex flex-wrap gap-x-2">
              {report.submittedAt ? <PrintDate value={report.submittedAt} withTime /> : '—'}
              {report.submittedByName ? <Bdi>{report.submittedByName}</Bdi> : null}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-text-muted">{t('reviewed')}</dt>
            <dd className="flex flex-wrap gap-x-2">
              {report.reviewedAt ? <PrintDate value={report.reviewedAt} withTime /> : '—'}
              {report.reviewedByName ? <Bdi>{report.reviewedByName}</Bdi> : null}
            </dd>
          </div>
          {report.returnReason ? (
            <div className="flex flex-wrap gap-x-2 sm:col-span-2">
              <dt className="text-text-muted">{t('returnReason')}</dt>
              <dd>
                <Bdi>{report.returnReason}</Bdi>
              </dd>
            </div>
          ) : null}
        </dl>

        <PrintSection title={t('collections')}>
          <PrintTable
            caption={t('collections')}
            columns={[
              { key: 'date', header: csv('collectedOn') },
              { key: 'purpose', header: csv('purpose') },
              { key: 'routed', header: csv('routedAt') },
              { key: 'amount', header: csv('amount'), numeric: true },
            ]}
            rows={collectionRows}
            empty={t('noCollections')}
            footer={[csv('total'), '', '', <MoneyText key="total" amount={printable.total} />]}
          />
        </PrintSection>

        <PrintSection title={t('events')}>
          <PrintTable
            caption={t('events')}
            columns={[
              { key: 'time', header: t('columns.time') },
              { key: 'event', header: t('columns.event') },
              { key: 'by', header: t('columns.by') },
              { key: 'reason', header: t('columns.reason') },
            ]}
            rows={eventRows}
            empty={t('noEvents')}
          />
        </PrintSection>
      </PrintSheet>
    </div>
  );
}
