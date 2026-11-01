import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ReportVerificationSection } from '@/components/verification/ReportVerificationSection';
import { getReport, type ReportDetail } from '@/modules/reports';
import { reportCapabilities, type ReportCapabilities } from '@/modules/reports/capabilities';
import { Panel } from '@/modules/reports/components/Panel';
import { ReportActions } from '@/modules/reports/components/ReportActions';
import { ReportCollectionsTable } from '@/modules/reports/components/ReportCollectionsTable';
import { ReportHistory } from '@/modules/reports/components/ReportHistory';
import { ReportSummary, ReportTotals } from '@/modules/reports/components/ReportSummary';
import { ShareReportButton } from '@/modules/reporting/components/share/ShareReportButton';
import { getReportTimeline } from '@/modules/timeline';
import { AuditTimeline } from '@/modules/timeline/components/AuditTimeline';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session, the report and its timeline on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'reports' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('detail.eyebrow')} | ${common('appName')}`, robots: { index: false } };
}

/** The message key of the next-step note under the totals, if any. */
function noteKey(report: ReportDetail, caps: ReportCapabilities) {
  if (report.branchStatus === 'closed') return 'branchClosedNotice' as const;
  if (report.status === 'approved') return null;
  if (!caps.canSubmit && !caps.canReview) return 'readOnlyNotice' as const;
  if (caps.canSubmit && report.status === 'submitted') return 'waitingReview' as const;
  if (caps.canReview && (report.status === 'draft' || report.status === 'returned')) {
    return 'waitingSubmission' as const;
  }
  return null;
}

export default async function ReportPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await requireActor();
  const caps = reportCapabilities(actor.role);
  const pool = getPool();
  const [t, report, timeline] = await Promise.all([
    getTranslations('reports.detail'),
    orNotFound(getReport(pool, actor, id)),
    caps.canSeeTimeline
      ? orNotFound(getReportTimeline(pool, actor, id))
      : Promise.resolve(undefined),
  ]);

  const frozen = report.status === 'submitted' || report.status === 'approved';
  const displayedTotal = frozen ? (report.frozenAmount ?? report.liveAmount) : report.liveAmount;
  const note = noteKey(report, caps);
  // On phones the actions panel is a fixed bottom bar; a Branch Lead always gets it (the share
  // button shows even when no action is allowed), so leave room for it.
  const showsActionBar = report.allowedActions.length > 0 || actor.role === 'branch_lead';

  return (
    <div className={`flex flex-col gap-6 ${showsActionBar ? 'pb-32 lg:pb-0' : ''}`}>
      <ReportSummary report={report} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Totals first on phones; a sticky side column on wide screens. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1">
          <ReportTotals report={report} note={note ? t(note) : undefined} />
          <ReportActions
            reportId={report.id}
            status={report.status}
            allowedActions={report.allowedActions}
            liveCount={report.liveCount}
            liveAmount={report.liveAmount}
            branchName={report.branchName}
            frozenAmount={report.frozenAmount}
            extra={
              actor.role === 'branch_lead' ? <ShareReportButton reportId={report.id} /> : undefined
            }
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
          <ReportCollectionsTable
            collections={report.collections}
            total={displayedTotal}
            totalIsFrozen={frozen}
          />
          <ReportHistory events={report.events} />
          {report.status === 'approved' ? (
            <ReportVerificationSection reportId={report.id} actor={actor} locale={locale} />
          ) : null}
          {timeline ? (
            <Panel title={t('timeline')} description={t('timelineBody')}>
              <AuditTimeline entries={timeline} headingLevel={3} />
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
