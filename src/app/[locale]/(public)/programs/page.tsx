import type { Metadata } from 'next';
import { cache } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PublicContentPage, resolvePublicContent } from '@/components/public/PublicContentPage';
import { publicMetadata } from '@/components/public/seo';
import { type ContentLocale, getPublishedContent } from '@/modules/public-site';
import { getPool } from '@/platform/db';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string }> };

// Shared by generateMetadata and the page, so one request reads the content once.
const loadContent = cache(async (locale: string) => {
  const pageLocale: ContentLocale = locale === 'ur' ? 'ur' : 'en';
  const [published, t] = await Promise.all([
    getPublishedContent(getPool(), 'programs', pageLocale),
    getTranslations({ locale, namespace: 'public.pages.programs' }),
  ]);
  return resolvePublicContent(
    published,
    { title: t('title'), lead: t('lead'), body: t('body') },
    pageLocale,
  );
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const [{ title }, t, common] = await Promise.all([
    loadContent(locale),
    getTranslations({ locale, namespace: 'public.pages.programs' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return publicMetadata({
    locale,
    path: '/programs',
    title,
    description: t('lead'),
    appName: common('appName'),
  });
}

export default async function ProgramsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [content, tNav] = await Promise.all([loadContent(locale), getTranslations('shell.nav')]);

  return <PublicContentPage eyebrow={tNav('programs')} {...content} />;
}
