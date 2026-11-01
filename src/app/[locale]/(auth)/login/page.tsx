import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect as redirectTo } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { safeNextPath } from '@/modules/auth/next-path';
import { LoginForm } from '@/modules/auth/ui/LoginForm';
import { getCurrentActor } from '@/platform/http/server';

// Reads the session cookie on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<{ next?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('submit')} | ${common('appName')}`, robots: { index: false } };
}

// Concentric lens rings and a wave: the brand mark, drawn large and faint.
function LensMotif() {
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      aria-hidden="true"
      className="pointer-events-none absolute -end-14 -top-16 size-56 text-primary opacity-[0.13]"
    >
      <circle cx="100" cy="100" r="34" stroke="currentColor" strokeWidth="12" />
      <circle cx="100" cy="100" r="62" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="100" cy="100" r="86" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M14 150c22 16 44 16 66 0s44-16 66 0 32 11 48 2"
        className="stroke-accent"
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(Array.isArray(rawNext) ? rawNext[0] : rawNext);

  if (await getCurrentActor()) {
    // Already signed in. A next path already carries its locale, so it is not localised again.
    if (next) redirectTo(next);
    return redirect({ href: '/account', locale });
  }

  const [t, common] = await Promise.all([getTranslations('auth'), getTranslations('common')]);

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 -top-10 h-48 rounded-full bg-accent-soft opacity-70 blur-3xl"
      />
      <section
        aria-labelledby="login-title"
        className="relative overflow-hidden rounded-card border border-border bg-surface-raised shadow-card"
      >
        <header className="relative overflow-hidden border-b border-border bg-surface-sunken/70 px-6 pb-7 pt-8 sm:px-9">
          <LensMotif />
          <p className="relative inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs font-semibold text-accent ltr:uppercase ltr:tracking-wider">
            <svg
              viewBox="0 0 20 20"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="4" y="9" width="12" height="8" rx="2" />
              <path d="M7 9V6.5a3 3 0 016 0V9" />
            </svg>
            {t('eyebrow')}
          </p>
          <h1
            id="login-title"
            className="relative mt-4 text-3xl font-semibold tracking-tight text-text"
          >
            {t('title')}
          </h1>
          <p className="relative mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
            {t('subtitle')}
          </p>
        </header>

        <div className="px-6 py-7 sm:px-9">
          <LoginForm next={next} />
        </div>

        <footer className="flex items-start gap-3 border-t border-border bg-surface-sunken/40 px-6 py-4 text-sm leading-relaxed text-text-muted sm:px-9">
          <svg
            viewBox="0 0 20 20"
            className="mt-0.5 size-4 shrink-0 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="7.25" />
            <path d="M10 9v4.5M10 6.5v.01" />
          </svg>
          <p>{t('help')}</p>
        </footer>
      </section>

      <p className="relative mt-6 text-center text-sm text-text-muted">{common('tagline')}</p>
    </div>
  );
}
