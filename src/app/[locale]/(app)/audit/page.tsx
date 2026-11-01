import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuditChainSection } from '@/components/verification/AuditChainSection';
import { Link } from '@/i18n/navigation';
import { getAuditFacets, listAuditEvents, parseAuditQuery } from '@/modules/audit-log';
import {
  AuditEventsList,
  AuditRestrictedNotice,
} from '@/modules/audit-log/components/AuditEventsList';
import { AuditFilters } from '@/modules/audit-log/components/AuditFilters';
import { auditHref, olderHref } from '@/modules/audit-log/components/audit-entity-link';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'audit' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('viewer.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const search = await searchParams;
  const query = parseAuditQuery(search);
  const { actor } = await requireActor();
  const pool = getPool();
  // Roles without audit access get Forbidden from the service: the not-found page.
  const [[page, facets], t] = await Promise.all([
    orNotFound(Promise.all([listAuditEvents(pool, actor, query), getAuditFacets(pool, actor)])),
    getTranslations('audit.viewer'),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-text">{t('title')}</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-text-muted">{t('lead')}</p>
          </div>
          {/* Status badges for the trail itself sit here, at the inline end of the title. */}
          <div data-audit-header-badges className="flex flex-wrap items-center gap-2">
            <AuditChainSection
              locale={locale}
              fresh={search.chain === 'fresh'}
              path={auditHref(query)}
            />
          </div>
        </div>
        {page.restricted ? <AuditRestrictedNotice /> : null}
      </header>

      <AuditFilters facets={facets} query={query} />

      {query.before ? (
        <div className="-mb-2 flex">
          <Link
            href={auditHref({ ...query, before: undefined })}
            className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-3.5"
            >
              <path d="M4 10l4-4 4 4" />
            </svg>
            {t('newest')}
          </Link>
        </div>
      ) : null}

      <AuditEventsList items={page.items} nextHref={olderHref(query, page.nextBefore)} />
    </div>
  );
}
