import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listBranchOptions, listTeams, memberCapabilities } from '@/modules/members';
import { TeamsPanel } from '@/modules/members/components/TeamsPanel';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'members' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('teams.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function TeamsPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await requireActor();
  const [t, teams, branches] = await Promise.all([
    getTranslations('members'),
    orNotFound(listTeams(getPool(), actor)),
    actor.role === 'super_admin'
      ? orNotFound(listBranchOptions(getPool(), actor))
      : Promise.resolve(undefined),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-text">{t('teams.title')}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-muted">{t('teams.intro')}</p>
      </header>
      <TeamsPanel
        teams={teams}
        canManage={memberCapabilities(actor.role).canManageTeams}
        branches={branches}
      />
    </div>
  );
}
