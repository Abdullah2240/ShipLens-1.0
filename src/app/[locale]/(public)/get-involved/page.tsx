import type { Metadata } from 'next';
import { cache } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PublicContentPage, resolvePublicContent } from '@/components/public/PublicContentPage';
import { publicMetadata } from '@/components/public/seo';
import { type ContentLocale, getPublishedContent } from '@/modules/public-site';
import { Link } from '@/i18n/navigation';
import { getPool } from '@/platform/db';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string }> };

// Shared by generateMetadata and the page, so one request reads the content once.
const loadContent = cache(async (locale: string) => {
  const pageLocale: ContentLocale = locale === 'ur' ? 'ur' : 'en';
  const [published, t] = await Promise.all([
    getPublishedContent(getPool(), 'get-involved', pageLocale),
    getTranslations({ locale, namespace: 'public.pages.getInvolved' }),
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
    getTranslations({ locale, namespace: 'public.pages.getInvolved' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return publicMetadata({
    locale,
    path: '/get-involved',
    title,
    description: t('lead'),
    appName: common('appName'),
  });
}

export default async function GetInvolvedPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [content, tNav, t] = await Promise.all([
    loadContent(locale),
    getTranslations('shell.nav'),
    getTranslations('public.pages.getInvolved'),
  ]);

  return (
    <PublicContentPage eyebrow={tNav('getInvolved')} {...content}>
      <section
        aria-labelledby="get-involved-cta"
        className="relative overflow-hidden rounded-card border border-border bg-surface-raised p-6 shadow-card md:p-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 end-[-4rem] size-48 rounded-full bg-accent-soft blur-2xl"
        />
        <div className="relative flex flex-col gap-3">
          <h2
            id="get-involved-cta"
            className="font-display-ur text-2xl font-bold tracking-tight text-text md:text-3xl"
          >
            {t('ctaTitle')}
          </h2>
          <p className="max-w-xl text-text-muted">{t('ctaBody')}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {/* This link precedes the application form route, which ships separately. */}
            <Link
              prefetch={false}
              href="/get-involved/apply"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-contrast shadow-card transition-colors hover:bg-primary-hover"
            >
              {t('applyCta')}
              <span aria-hidden="true" className="rtl:-scale-x-100">
                &rarr;
              </span>
            </Link>
            <Link
              prefetch={false}
              href="/branches"
              className="inline-flex h-12 items-center rounded-xl border border-border-strong bg-surface-raised px-6 text-base font-semibold text-text transition-colors hover:bg-surface-sunken"
            >
              {t('branchesCta')}
            </Link>
          </div>
        </div>
      </section>
    </PublicContentPage>
  );
}
