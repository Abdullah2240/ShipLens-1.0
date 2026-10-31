import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listBranches } from '@/modules/branches';
import { branchCapabilities } from '@/modules/branches/capabilities';
import { BranchCreateForm } from '@/modules/branches/components/BranchCreateForm';
import { BranchesTable } from '@/modules/branches/components/BranchesTable';
import { InfoNote } from '@/modules/branches/components/form-kit';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'branches' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('register.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function BranchesPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await requirePageActor();
  const caps = branchCapabilities(actor.role);
  const [t, branches] = await Promise.all([
    getTranslations('branches'),
    orNotFound(listBranches(getPool(), actor)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-text">{t('register.title')}</h1>
          <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-semibold text-text-muted tabular">
            {t('register.count', { count: branches.length })}
          </span>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-text-muted">
          {t('register.subtitle')}
        </p>
      </header>

      {caps.canCreate ? (
        <details className="group rounded-card border border-border bg-surface-raised shadow-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-card px-5 py-3.5 text-sm font-semibold text-text marker:hidden hover:bg-surface-sunken/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid size-6 place-items-center rounded-md bg-primary text-primary-contrast"
              >
                <svg
                  viewBox="0 0 20 20"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <path d="M10 4.5v11M4.5 10h11" />
                </svg>
              </span>
              {t('register.create')}
            </span>
            <svg
              viewBox="0 0 20 20"
              className="size-4 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 8l5 5 5-5" />
            </svg>
          </summary>
          <div className="flex flex-col gap-5 border-t border-border p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-text">{t('create.title')}</h2>
              <p className="text-sm text-text-muted">{t('create.intro')}</p>
            </div>
            <BranchCreateForm />
          </div>
        </details>
      ) : (
        <InfoNote>{t('register.readOnlyNotice')}</InfoNote>
      )}

      <BranchesTable branches={branches} />
    </div>
  );
}
