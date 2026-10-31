import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Pager } from '@/components/ui/Pager';
import { listMembers, listTeams, parseMemberQuery } from '@/modules/members';
import { MembersFilters, membersHref } from '@/modules/members/components/MembersFilters';
import { MembersTable } from '@/modules/members/components/MembersTable';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'members' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('list.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { actor } = await requirePageActor();
  const query = parseMemberQuery(sp);
  const [t, result, teams] = await Promise.all([
    getTranslations('members'),
    orNotFound(listMembers(getPool(), actor, query)),
    orNotFound(listTeams(getPool(), actor)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-text">{t('list.title')}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-muted">{t('list.intro')}</p>
      </header>
      <MembersFilters values={query} teams={teams} total={result.total} />
      <MembersTable members={result.items} showBranch={actor.role === 'super_admin'} />
      <Pager
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        hrefFor={(page) => membersHref(query, page)}
      />
    </div>
  );
}
