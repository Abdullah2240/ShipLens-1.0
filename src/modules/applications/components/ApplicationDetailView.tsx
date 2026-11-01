import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bdi, Ltr, StatusBadge } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { ApplicationDetail } from '@/modules/applications/review-types';
import { MemberCode, memberHref } from '@/modules/members/components/MembersTable';
import { Instant } from './ApplicationsTable';
import { APPLICATIONS_PATH } from './ApplicationStatusTabs';

export interface ApplicationDetailViewProps {
  application: ApplicationDetail;
  /** Decision controls, shown at the top of the decision card. */
  decision?: ReactNode;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-card border border-border bg-surface-raised shadow-card">
      <h2 className="border-b border-border px-5 py-3.5 text-sm font-semibold text-text">
        {title}
      </h2>
      <div className="flex flex-col gap-5 p-5">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold text-text-muted">{label}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  );
}

/** Read-only view of one application. Applicant text is only ever rendered as text nodes. */
export function ApplicationDetailView({ application: app, decision }: ApplicationDetailViewProps) {
  const t = useTranslations('applications.admin.detail');
  const locale = useLocale() as Locale;
  const decided = app.status !== 'pending';
  const notProvided = <span className="text-text-muted">{t('notProvided')}</span>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={APPLICATIONS_PATH}
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
          {t('back')}
        </Link>

        <header className="flex flex-col gap-3 border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t('title')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight break-words text-text">
              <Bdi>{app.fullName}</Bdi>
            </h1>
            <StatusBadge status={app.status} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
            <Bdi>{app.branchName}</Bdi>
            <span aria-hidden="true">·</span>
            <span>
              {t('received')} <Instant value={app.createdAt} locale={locale} />
            </span>
          </p>
        </header>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-6">
          <Card title={t('applicant')}>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Fact label={t('email')}>
                <Ltr className="break-all">{app.email}</Ltr>
              </Fact>
              <Fact label={t('phone')}>
                {app.phone ? <Ltr className="tabular">{app.phone}</Ltr> : notProvided}
              </Fact>
              <Fact label={t('branch')}>
                <Bdi>{app.branchName}</Bdi>
              </Fact>
              <Fact label={t('received')}>
                <Instant value={app.createdAt} locale={locale} />
              </Fact>
            </dl>
          </Card>

          <Card title={t('message')}>
            {app.message ? (
              <p
                dir="auto"
                className="text-sm leading-relaxed whitespace-pre-wrap break-words text-text"
              >
                {app.message}
              </p>
            ) : (
              <p className="text-sm text-text-muted italic">{t('noMessage')}</p>
            )}
          </Card>
        </div>

        <Card title={t('decision')}>
          {decision}
          {!decided && !decision ? (
            <p className="text-sm text-text-muted">{t('awaiting')}</p>
          ) : null}
          {decided ? (
            <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Fact label={t('decidedBy')}>
                {app.decidedByName != null ? <Bdi>{app.decidedByName}</Bdi> : notProvided}
              </Fact>
              <Fact label={t('decidedOn')}>
                {app.decidedAt ? <Instant value={app.decidedAt} locale={locale} /> : notProvided}
              </Fact>
              {app.status === 'accepted' && app.memberCode ? (
                <Fact label={t('member')}>
                  <span className="flex flex-wrap items-center gap-3">
                    <MemberCode code={app.memberCode} />
                    {app.memberId ? (
                      <Link
                        href={memberHref(app.memberId)}
                        className="text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {t('viewMember')}
                      </Link>
                    ) : null}
                  </span>
                </Fact>
              ) : null}
              {app.decisionNote ? (
                <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1 xl:col-span-2">
                  <dt className="text-xs font-semibold text-text-muted">{t('note')}</dt>
                  <dd
                    dir="auto"
                    className="rounded-lg bg-surface-sunken px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words text-text"
                  >
                    {app.decisionNote}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
