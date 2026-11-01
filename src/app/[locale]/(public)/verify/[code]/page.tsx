import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { VerificationCertificate } from '@/components/verification';
import {
  SEAL_PATTERN,
  formatCode,
  lookupVerification,
  normaliseCode,
  verifyRateLimiter,
} from '@/modules/verification';
import { getPool } from '@/platform/db';
import { clientIpFrom } from '@/platform/rate-limit';
import { VerifyForm } from '../verify-form';

// Looks the code up on every request; the build has no database.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; code: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type VerifyLocale = 'en' | 'ur';

// The title never carries the code, and no result page is ever indexed.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const [t, common] = await Promise.all([
    getTranslations({ locale, namespace: 'verify.page' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return {
    title: `${t('title')} | ${common('appName')}`,
    description: t('metaDescription'),
    robots: { index: false, follow: false },
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Same page again, rebuilt only from a valid code and seal; otherwise the form page. */
function retryHref(locale: VerifyLocale, rawCode: string, seal: string | undefined): string {
  const code = normaliseCode(rawCode);
  if (!code) return `/${locale}/verify`;
  const query = seal !== undefined && SEAL_PATTERN.test(seal) ? `?s=${seal}` : '';
  return `/${locale}/verify/${formatCode(code)}${query}`;
}

export default async function VerifyResultPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ locale: raw, code: segment }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(raw);
  const locale: VerifyLocale = raw === 'ur' ? 'ur' : 'en';
  const rawCode = decoded(segment);
  const seal = first(query.s);

  // Same per-address budget as the public API; checked before any database work.
  const limit = verifyRateLimiter.check(clientIpFrom(await headers()));
  if (!limit.allowed) {
    return (
      <ResultFrame locale={locale}>
        <RateLimited
          seconds={limit.retryAfterSeconds}
          retryHref={retryHref(locale, rawCode, seal)}
        />
      </ResultFrame>
    );
  }

  const result = await lookupVerification(getPool(), rawCode, { seal });
  return (
    <ResultFrame locale={locale}>
      {result ? (
        <VerificationCertificate result={result} locale={locale} headingLevel={1} />
      ) : (
        <NotRecognised locale={locale} />
      )}
    </ResultFrame>
  );
}

function ResultFrame({ locale, children }: { locale: VerifyLocale; children: ReactNode }) {
  const t = useTranslations('verify.page');
  return (
    <div className="relative overflow-hidden bg-linear-to-b from-accent-soft/60 via-surface to-surface">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 end-[-6rem] size-80 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6 md:py-14">
        <a
          href={`/${locale}/verify`}
          className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-primary underline-offset-4 hover:text-primary-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span aria-hidden="true" className="rtl:-scale-x-100">
            &larr;
          </span>
          {t('checkAnother')}
        </a>
        {children}
      </div>
    </div>
  );
}

function StateCard({
  icon,
  tone,
  children,
}: {
  icon: string;
  tone: 'warning' | 'neutral';
  children: ReactNode;
}) {
  const badge =
    tone === 'warning'
      ? 'bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-fg/20'
      : 'bg-tone-neutral-bg text-tone-neutral-fg ring-border';
  return (
    <section className="flex flex-col gap-5 rounded-card border border-border bg-surface-raised p-6 shadow-card sm:p-8">
      <span className={`grid size-14 place-items-center rounded-2xl ring-1 ${badge}`}>
        <svg
          viewBox="0 0 24 24"
          className="size-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={icon} />
        </svg>
      </span>
      {children}
    </section>
  );
}

const SEARCH_QUESTION =
  'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M9.2 9.3a1.9 1.9 0 013.6.7c0 1.3-1.8 1.6-1.8 2.6M11 14.6v.1';
const CLOCK = 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5V12l3 2';

function NotRecognised({ locale }: { locale: VerifyLocale }) {
  const t = useTranslations('verify.page');
  return (
    <StateCard icon={SEARCH_QUESTION} tone="neutral">
      <div className="flex flex-col gap-2">
        <h1 className="font-display-ur text-2xl font-bold tracking-tight text-text md:text-3xl">
          {t('notFoundTitle')}
        </h1>
        <p className="text-text-muted">{t('notFound')}</p>
      </div>
      <div className="border-t border-border pt-6">
        <VerifyForm locale={locale} />
      </div>
    </StateCard>
  );
}

function RateLimited({ seconds, retryHref }: { seconds: number; retryHref: string }) {
  const t = useTranslations('verify.page');
  const common = useTranslations('common.actions');
  return (
    <StateCard icon={CLOCK} tone="warning">
      <div className="flex flex-col gap-2">
        <h1 className="font-display-ur text-2xl font-bold tracking-tight text-text md:text-3xl">
          {t('rateLimitedTitle')}
        </h1>
        <p className="text-text-muted">{t('rateLimited', { seconds: String(seconds) })}</p>
      </div>
      <a
        href={retryHref}
        data-retry
        className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-6 text-base font-semibold text-text transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-fit"
      >
        {common('retry')}
      </a>
    </StateCard>
  );
}
