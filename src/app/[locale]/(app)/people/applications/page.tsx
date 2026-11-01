import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Pager } from '@/components/ui/Pager';
import { listApplications, parseApplicationListQuery } from '@/modules/applications';
import {
  ApplicationStatusTabs,
  applicationTabFrom,
  applicationsHref,
} from '@/modules/applications/components/ApplicationStatusTabs';
import { ApplicationsTable } from '@/modules/applications/components/ApplicationsTable';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'applications' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('admin.list.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { actor } = await requireActor();

  // Pending is the default view; `all` lifts the status filter.
  const tab = applicationTabFrom(sp.status);
  const { page, pageSize } = parseApplicationListQuery(sp);
  const query = tab === 'all' ? { page, pageSize } : { status: tab, page, pageSize };

  const [t, result] = await Promise.all([
    getTranslations('applications.admin.list'),
    orNotFound(listApplications(getPool(), actor, query)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-text">{t('title')}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-muted">{t('intro')}</p>
      </header>
      <ApplicationStatusTabs active={tab} />
      <ApplicationsTable applications={result.items} showBranch={actor.role === 'super_admin'} />
      <Pager
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        hrefFor={(next) => applicationsHref(tab, next, result.pageSize)}
      />
    </div>
  );
}
