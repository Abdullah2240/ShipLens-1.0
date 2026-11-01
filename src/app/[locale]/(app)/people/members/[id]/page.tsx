import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMember, listTeams, memberCapabilities } from '@/modules/members';
import { MemberEditForm } from '@/modules/members/components/MemberEditForm';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the member on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'members' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('detail.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function MemberPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await requireActor();
  const [member, teams] = await Promise.all([
    orNotFound(getMember(getPool(), actor, id)),
    orNotFound(listTeams(getPool(), actor)),
  ]);

  return (
    <MemberEditForm
      member={member}
      teams={teams
        .filter((team) => team.branchId === member.branchId)
        .map(({ id: teamId, name }) => ({ id: teamId, name }))}
      canEdit={memberCapabilities(actor.role).canEdit}
    />
  );
}
