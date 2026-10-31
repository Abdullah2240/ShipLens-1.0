import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { listReviewQueue } from '@/modules/reports';
import { ReviewQueueList } from '@/modules/reports/components/ReportsTable';
import { REPORTS_PATH } from '@/modules/reports/components/report-format';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';
import { pktDate, systemClock } from '@/platform/time';

// Reads the session and the queue on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'reports' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('review.title')} | ${common('appName')}`, robots: { index: false } };
}

/** Finance Reviewer only: every other role gets the localized not-found page. */
export default async function ReviewQueuePage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await requirePageActor();
  const [t, queue] = await Promise.all([
    getTranslations('reports'),
    orNotFound(listReviewQueue(getPool(), actor)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">{t('review.title')}</h1>
          <p className="text-sm leading-relaxed text-text-muted">{t('review.subtitle')}</p>
        </div>
        <Link
          href={REPORTS_PATH}
          className="inline-flex h-10 items-center rounded-lg border border-border-strong/60 bg-surface-raised px-4 text-sm font-semibold text-text shadow-xs transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('review.allReports')}
        </Link>
      </header>
      <ReviewQueueList reports={queue} today={pktDate(systemClock.now())} />
    </div>
  );
}
