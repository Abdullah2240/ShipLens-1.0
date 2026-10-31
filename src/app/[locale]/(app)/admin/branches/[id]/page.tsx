import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StatusBadge } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { getBranch, listLeadCandidates } from '@/modules/branches';
import { branchCapabilities, isBranchReadOnly } from '@/modules/branches/capabilities';
import { BranchDetailsForm } from '@/modules/branches/components/BranchDetailsForm';
import { BranchLeadsPanel } from '@/modules/branches/components/BranchLeadsPanel';
import { BranchStatusControl } from '@/modules/branches/components/BranchStatusControl';
import { BRANCHES_PATH, BranchCode } from '@/modules/branches/components/BranchesTable';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';

// Reads the session and the branch on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'branches' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('detail.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function BranchPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await requirePageActor();
  const caps = branchCapabilities(actor.role);
  const [t, branch, candidates] = await Promise.all([
    getTranslations('branches'),
    orNotFound(getBranch(getPool(), actor, id)),
    // Candidates need user.read, which only roles that assign leads hold.
    caps.canAssignLeads ? orNotFound(listLeadCandidates(getPool(), actor)) : undefined,
  ]);
  const closed = isBranchReadOnly(branch.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={BRANCHES_PATH}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-text-muted transition-colors hover:text-text focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <svg
            viewBox="0 0 20 20"
            className="size-4 rtl:-scale-x-100"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5l-5 5 5 5" />
          </svg>
          {t('detail.back')}
        </Link>

        <header className="flex flex-col gap-3 border-b border-border pb-6">
          <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">
            {t('detail.title')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-text">{branch.name}</h1>
            <BranchCode code={branch.code} />
            <StatusBadge status={branch.status} />
          </div>
          <p className="text-sm text-text-muted">
            {[branch.city, t('detail.openReports', { count: branch.openReportCount })]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </header>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <BranchDetailsForm branch={branch} canEdit={caps.canEdit} />
        <div className="flex min-w-0 flex-col gap-6">
          <BranchStatusControl
            branchId={branch.id}
            status={branch.status}
            allowedTransitions={branch.allowedTransitions}
            canTransition={caps.canTransition}
            name={branch.name}
          />
          <BranchLeadsPanel
            branchId={branch.id}
            leads={branch.leads}
            candidates={candidates}
            canAssign={caps.canAssignLeads}
            closed={closed}
          />
        </div>
      </div>
    </div>
  );
}
