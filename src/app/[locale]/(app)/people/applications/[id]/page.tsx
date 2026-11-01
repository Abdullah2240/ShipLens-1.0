import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getApplication } from '@/modules/applications';
import { ApplicationDecision } from '@/modules/applications/components/ApplicationDecision';
import { ApplicationDetailView } from '@/modules/applications/components/ApplicationDetailView';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the application on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'applications' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('admin.detail.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function ApplicationPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await requireActor();
  const application = await orNotFound(getApplication(getPool(), actor, id));

  return (
    <ApplicationDetailView
      application={application}
      decision={
        <ApplicationDecision
          applicationId={application.id}
          applicantName={application.fullName}
          status={application.status}
        />
      }
    />
  );
}
