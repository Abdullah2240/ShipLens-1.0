import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BranchesByCity } from '@/components/public/BranchesByCity';
import { PublicHero } from '@/components/public/PublicHero';
import { type ContentLocale, listPublicBranches } from '@/modules/public-site';
import { getPool } from '@/platform/db';

// Reads Active branches on every request; the build has no database.
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const [t, common] = await Promise.all([
    getTranslations({ locale, namespace: 'public.branches' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return { title: `${t('title')} | ${common('appName')}`, description: t('lead') };
}

export default async function BranchesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const pageLocale: ContentLocale = locale === 'ur' ? 'ur' : 'en';
  const [t, tNav, branches] = await Promise.all([
    getTranslations('public.branches'),
    getTranslations('shell.nav'),
    listPublicBranches(getPool()),
  ]);

  return (
    <>
      <PublicHero eyebrow={tNav('branches')} title={t('title')} lead={t('lead')} motif="network" />
      <div className="mx-auto w-full max-w-6xl px-4 py-12 md:px-6 md:py-16">
        <BranchesByCity branches={branches} locale={pageLocale} />
      </div>
    </>
  );
}
