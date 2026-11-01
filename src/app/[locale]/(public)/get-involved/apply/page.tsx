import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { ApplicationForm } from '@/modules/applications/components/ApplicationForm';
import { listPublicBranches } from '@/modules/public-site';
import { getPool } from '@/platform/db';

// Reads Active branches on every request; the build has no database.
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'applications.form' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('title')} | ${common('appName')}`, description: t('intro') };
}

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [{ branch }, t, branches] = await Promise.all([
    searchParams,
    getTranslations('applications.form'),
    listPublicBranches(getPool()),
  ]);

  const defaultBranchId =
    typeof branch === 'string' && UUID.test(branch) && branches.some((b) => b.id === branch)
      ? branch
      : undefined;

  return (
    <>
      <section className="relative overflow-hidden border-b border-border bg-linear-to-b from-accent-soft/70 to-surface">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 end-[-6rem] size-72 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-12 pb-10 md:px-6 md:pt-16 md:pb-12">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-surface-raised px-3 py-1 text-sm font-semibold text-accent">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            {t('eyebrow')}
          </p>
          <h1 className="font-display-ur text-3xl font-bold tracking-tight text-text md:text-5xl md:leading-[1.15]">
            {t('title')}
          </h1>
          <p className="text-lg text-text-muted">{t('intro')}</p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6 md:py-14">
        {branches.length === 0 ? (
          <EmptyState
            title={t('errors.noBranchesTitle')}
            body={t('errors.noBranches')}
            action={
              <Link
                href="/get-involved"
                className="inline-flex h-11 items-center rounded-xl border border-border-strong bg-surface-raised px-5 font-semibold text-text transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('errors.noBranchesLink')}
              </Link>
            }
          />
        ) : (
          <div className="rounded-card border border-border bg-surface-raised p-5 shadow-card sm:p-8">
            <p className="mb-8 flex items-start gap-3 rounded-xl bg-surface-sunken px-4 py-3 text-sm text-text-muted">
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
                <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3zM9 12l2 2 4-4" />
              </svg>
              <span>{t('privacy')}</span>
            </p>
            <ApplicationForm
              branches={branches.map(({ id, name, city }) => ({ id, name, city }))}
              defaultBranchId={defaultBranchId}
            />
          </div>
        )}
      </div>
    </>
  );
}
