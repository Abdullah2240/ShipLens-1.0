import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { formatCode, normaliseCode } from '@/modules/verification';
import { VerifyForm } from './verify-form';

// Reads ?code= on every request: the no-JavaScript form submits here.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type VerifyLocale = 'en' | 'ur';

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const [t, common] = await Promise.all([
    getTranslations({ locale, namespace: 'verify.page' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return { title: `${t('title')} | ${common('appName')}`, description: t('metaDescription') };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ locale: raw }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(raw);
  const locale: VerifyLocale = raw === 'ur' ? 'ur' : 'en';

  const typed = first(query.code);
  if (typed !== undefined) {
    const code = normaliseCode(typed);
    if (code) redirect(`/${locale}/verify/${formatCode(code)}`);
  }

  return <VerifyEntry locale={locale} typed={typed} />;
}

const STEPS = [
  { key: 'Approved', icon: 'M9 12l2 2 4-4M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3z' },
  {
    key: 'Issued',
    icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2',
  },
  {
    key: 'Chained',
    icon: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  },
  { key: 'Check', icon: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M8.5 11l1.8 1.8L14 9' },
] as const;

function VerifyEntry({ locale, typed }: { locale: VerifyLocale; typed: string | undefined }) {
  const t = useTranslations('verify.page');

  return (
    <>
      <section className="relative overflow-hidden border-b border-border bg-linear-to-b from-accent-soft/70 to-surface">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 end-[-6rem] size-80 rounded-full bg-primary/10 blur-3xl"
        />
        <SealMotif />
        <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] md:items-center md:gap-14 md:px-6 md:py-20">
          <div className="flex flex-col gap-5">
            <p className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-surface-raised px-3 py-1 text-sm font-semibold text-accent">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
              {t('eyebrow')}
            </p>
            <h1 className="font-display-ur text-3xl font-bold tracking-tight text-text md:text-5xl md:leading-[1.15]">
              {t('title')}
            </h1>
            <p className="max-w-xl text-lg text-text-muted">{t('intro')}</p>
            <p className="flex max-w-xl items-start gap-3 text-sm text-text-muted">
              <svg
                viewBox="0 0 24 24"
                className="mt-0.5 size-5 shrink-0 text-primary"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 3h8a2 2 0 012 2v14a2 2 0 01-2 2H8a2 2 0 01-2-2V5a2 2 0 012-2zM11 18h2" />
              </svg>
              <span>{t('scanHint')}</span>
            </p>
          </div>
          <div className="rounded-card border border-border bg-surface-raised p-5 shadow-card sm:p-7">
            <VerifyForm locale={locale} defaultValue={typed ?? ''} invalid={typed !== undefined} />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6 md:py-20">
        <h2
          id="verify-steps-title"
          className="font-display-ur text-2xl font-bold tracking-tight text-text md:text-3xl"
        >
          {t('stepsTitle')}
        </h2>
        <ol
          aria-labelledby="verify-steps-title"
          className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {STEPS.map((step, index) => (
            <li
              key={step.key}
              className="relative flex flex-col gap-3 rounded-card border border-border bg-surface-raised p-6 shadow-card"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={step.icon} />
                  </svg>
                </span>
                <span
                  aria-hidden="true"
                  className="font-mono text-sm font-semibold text-text-muted tabular-nums"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-text">{t(`step${step.key}Title`)}</h3>
              <p className="text-text-muted">{t(`step${step.key}Body`)}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 flex items-start gap-3 rounded-xl bg-surface-sunken px-4 py-3 text-sm text-text-muted">
          <svg
            viewBox="0 0 24 24"
            className="mt-0.5 size-5 shrink-0 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M7 11V8a5 5 0 0110 0v3M5.5 11h13v9.5h-13zM12 14.5v2.5" />
          </svg>
          <span>{t('privacy')}</span>
        </p>
      </section>
    </>
  );
}

// Three rings and a tick: the seal printed with every approved report's code.
function SealMotif() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 200"
      fill="none"
      className="pointer-events-none absolute -bottom-24 start-[-5rem] hidden size-72 text-accent/15 md:block"
    >
      <circle cx="100" cy="100" r="96" stroke="currentColor" strokeWidth="2" />
      <circle
        cx="100"
        cy="100"
        r="78"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="4 6"
      />
      <circle cx="100" cy="100" r="58" stroke="currentColor" strokeWidth="2" />
      <path
        d="M78 101l15 15 30-32"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
