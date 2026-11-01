import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { publicMetadata } from '@/components/public/seo';
import { Link } from '@/i18n/navigation';

const STEPS = ['read', 'contact', 'welcome'] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'applications.thanks' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return publicMetadata({
    locale,
    path: '/get-involved/apply/thanks',
    title: t('title'),
    appName: common('appName'),
    index: false,
  });
}

export default async function ApplicationThanksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('applications.thanks');

  return (
    <section className="relative overflow-hidden bg-linear-to-b from-accent-soft/60 to-surface">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-28 mx-auto size-96 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-5 px-4 py-14 text-center md:px-6 md:py-20">
        <span className="grid size-16 place-items-center rounded-full bg-tone-success-bg text-tone-success-fg shadow-card ring-8 ring-surface-raised">
          <svg
            viewBox="0 0 24 24"
            className="size-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <p className="text-sm font-semibold text-accent">{t('eyebrow')}</p>
        <h1 className="font-display-ur text-3xl font-bold tracking-tight text-text md:text-5xl md:leading-[1.15]">
          {t('title')}
        </h1>
        <p className="max-w-xl text-lg text-text-muted">{t('body')}</p>

        <div className="mt-4 w-full rounded-card border border-border bg-surface-raised p-6 text-start shadow-card sm:p-8">
          <h2 className="text-base font-semibold text-text">{t('nextTitle')}</h2>
          <ol className="mt-5 flex flex-col gap-4">
            {STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent"
                >
                  {index + 1}
                </span>
                <span className="pt-1 text-text">{t(`steps.${step}`)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-base font-semibold text-primary-contrast shadow-card transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('home')}
          </Link>
          <Link
            href="/get-involved/apply"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-6 text-base font-semibold text-text transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('another')}
          </Link>
        </div>
      </div>
    </section>
  );
}
