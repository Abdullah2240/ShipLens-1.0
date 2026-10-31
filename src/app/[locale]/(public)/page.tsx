import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

const PROGRAMS = [
  {
    id: 'education',
    icon: 'M3 9l9-5 9 5-9 5-9-5zM7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5',
  },
  {
    id: 'health',
    icon: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10zM12 9v5M9.5 11.5h5',
  },
  {
    id: 'relief',
    icon: 'M4 10h16l-1.5 9h-13L4 10zM8 10V8a4 4 0 018 0v2',
  },
] as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('public.home');

  return (
    <>
      <section className="relative overflow-hidden border-b border-border bg-linear-to-b from-accent-soft/70 to-surface">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 end-[-6rem] size-80 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-16 md:px-6 md:py-24">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-surface-raised px-3 py-1 text-sm font-semibold text-accent">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            {t('eyebrow')}
          </p>
          <h1 className="font-display-ur max-w-3xl text-4xl font-bold tracking-tight text-text md:text-6xl md:leading-[1.1]">
            {t('title')}
          </h1>
          <p className="max-w-2xl text-lg text-text-muted md:text-xl">{t('lead')}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link
              href="/get-involved"
              className="inline-flex h-12 items-center rounded-xl bg-primary px-6 text-base font-semibold text-primary-contrast shadow-card transition-colors hover:bg-primary-hover"
            >
              {t('ctaGetInvolved')}
            </Link>
            <Link
              href="/branches"
              className="inline-flex h-12 items-center rounded-xl border border-border-strong bg-surface-raised px-6 text-base font-semibold text-text transition-colors hover:bg-surface-sunken"
            >
              {t('ctaBranches')}
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6 md:py-20">
        <div className="max-w-2xl">
          <h2 className="font-display-ur text-2xl font-bold tracking-tight text-text md:text-3xl">
            {t('mission.title')}
          </h2>
          <p className="mt-3 text-lg text-text-muted">{t('mission.body')}</p>
        </div>
      </section>

      <section className="border-t border-border bg-surface-sunken">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6 md:py-20">
          <h2 className="font-display-ur text-2xl font-bold tracking-tight text-text md:text-3xl">
            {t('programs.title')}
          </h2>
          <p className="mt-2 max-w-xl text-text-muted">{t('programs.intro')}</p>
          <ul className="mt-8 grid gap-5 md:grid-cols-3">
            {PROGRAMS.map((program) => (
              <li
                key={program.id}
                className="flex flex-col gap-3 rounded-card border border-border bg-surface-raised p-6 shadow-card"
              >
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
                    <path d={program.icon} />
                  </svg>
                </span>
                <h3 className="text-lg font-semibold text-text">
                  {t(`programs.items.${program.id}.title`)}
                </h3>
                <p className="text-text-muted">{t(`programs.items.${program.id}.body`)}</p>
              </li>
            ))}
          </ul>
          <Link
            href="/programs"
            className="mt-8 inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:text-primary-hover hover:underline"
          >
            {t('programs.learnMore')}
            <span aria-hidden="true" className="rtl:-scale-x-100">
              &rarr;
            </span>
          </Link>
        </div>
      </section>
    </>
  );
}
