import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Bdi, MoneyText, StatusBadge } from '@/components/ui';
import { fillSlots, slot } from '@/components/ui/Bidi';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCollection } from '@/modules/collections';
import { collectionCapabilities, isEditable } from '@/modules/collections/capabilities';
import { CollectionForm } from '@/modules/collections/components/CollectionForm';
import { BranchCode, COLLECTIONS_PATH } from '@/modules/collections/components/CollectionsTable';
import { reportHref } from '@/modules/collections/components/CurrentWeekCard';
import { LockBadge } from '@/modules/collections/components/LockBadge';
import { VoidCollectionDialog } from '@/modules/collections/components/VoidCollectionDialog';
import { getCollectionTimeline } from '@/modules/timeline';
import { AuditTimeline } from '@/modules/timeline/components/AuditTimeline';
import { LOCK_DAYS } from '@/platform/config/constants';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';
import { formatDate, formatDateTime } from '@/platform/i18n/format';
import { addDays, pktDate, systemClock } from '@/platform/time';

// Reads the session, the clock and the collection on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'collections' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('detail.title')} | ${common('appName')}`, robots: { index: false } };
}

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-6 flex-col rounded-card border border-border bg-surface-raised shadow-card"
    >
      <h2
        id={`${id}-title`}
        className="border-b border-border px-5 py-3.5 text-sm font-semibold text-text sm:px-6"
      >
        {title}
      </h2>
      <div className="p-5 sm:p-6">{children}</div>
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

export default async function CollectionPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await requirePageActor();
  const caps = collectionCapabilities(actor.role);
  const pool = getPool();
  const collection = await orNotFound(getCollection(pool, actor, systemClock, id));
  const timeline = caps.canSeeTimeline
    ? await orNotFound(getCollectionTimeline(pool, actor, collection.id))
    : null;

  const t = await getTranslations('collections');
  const loc = locale as Locale;
  const today = pktDate(systemClock.now());
  const editable = isEditable(collection.editability);
  const canAmend = editable && caps.canAmend;
  const canVoid = editable && caps.canVoid;
  const voided = collection.status === 'voided';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={COLLECTIONS_PATH}
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
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t('detail.title')}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1
              dir="ltr"
              data-testid="collection-amount"
              className={`text-3xl font-semibold tracking-tight tabular sm:text-4xl ${
                voided ? 'text-text-muted line-through' : 'text-text'
              }`}
            >
              <MoneyText amount={collection.amount} />
            </h1>
            <LockBadge
              editability={collection.editability}
              daysLeft={collection.lock.daysLeft}
              lastEditableOn={collection.lock.lastEditableOn}
            />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
            <bdi className="font-medium text-text">{collection.purpose}</bdi>
            <span aria-hidden="true">·</span>
            <Bdi className="tabular">
              <time dateTime={collection.collectedOn}>
                {formatDate(collection.collectedOn, loc)}
              </time>
            </Bdi>
            <span aria-hidden="true">·</span>
            <Bdi>{collection.branchName}</Bdi>
          </p>
          {voided && collection.voidReason ? (
            <p
              data-testid="void-reason"
              className="w-fit rounded-lg border border-danger/30 bg-tone-danger-bg px-3 py-2 text-sm font-medium text-tone-danger-fg"
            >
              {fillSlots(t('void.reasonLabel', { reason: slot() }), [
                <Bdi key="reason">{collection.voidReason}</Bdi>,
              ])}
            </p>
          ) : null}
        </header>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="flex flex-col gap-6">
          <Card id="facts" title={t('detail.title')}>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Fact label={t('detail.amount')}>
                <MoneyText amount={collection.amount} className="font-semibold" />
              </Fact>
              <Fact label={t('detail.collectedOn')}>
                <Bdi className="tabular">
                  <time dateTime={collection.collectedOn}>
                    {formatDate(collection.collectedOn, loc)}
                  </time>
                </Bdi>
              </Fact>
              <Fact label={t('detail.purpose')}>
                <bdi>{collection.purpose}</bdi>
              </Fact>
              <Fact label={t('detail.branch')}>
                <span className="flex flex-wrap items-center gap-2">
                  <BranchCode code={collection.branchCode} />
                  <Bdi>{collection.branchName}</Bdi>
                </span>
              </Fact>
              <Fact label={t('detail.week')}>
                <Bdi className="tabular">
                  <time dateTime={collection.weekStart}>
                    {t('week.range', {
                      start: formatDate(collection.weekStart, loc),
                      end: formatDate(addDays(collection.weekStart, 6), loc),
                    })}
                  </time>
                </Bdi>
              </Fact>
              <Fact label={t('detail.report')}>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={collection.reportStatus} />
                  <Link
                    href={reportHref(collection.reportId)}
                    className="rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('week.openReport')}
                  </Link>
                </span>
              </Fact>
              <Fact label={t('detail.loggedBy')}>
                {collection.createdByName != null ? (
                  <Bdi>{collection.createdByName}</Bdi>
                ) : (
                  <span className="text-text-muted">{t('detail.system')}</span>
                )}
              </Fact>
              <Fact label={t('detail.loggedAt')}>
                <Bdi className="tabular">
                  <time dateTime={collection.createdAt}>
                    {formatDateTime(new Date(collection.createdAt), loc)}
                  </time>
                </Bdi>
              </Fact>
              <div className="sm:col-span-2">
                <Fact label={t('detail.note')}>
                  {collection.note ? (
                    <bdi className="whitespace-pre-line">{collection.note}</bdi>
                  ) : (
                    <span className="text-text-muted italic">{t('detail.noNote')}</span>
                  )}
                </Fact>
              </div>
            </dl>
          </Card>

          {canVoid ? (
            <Card id="void" title={t('detail.voidTitle')}>
              <div className="flex flex-col items-start gap-4">
                <p className="text-sm text-text-muted">{t('detail.voidHint')}</p>
                <VoidCollectionDialog collectionId={collection.id} amount={collection.amount} />
              </div>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          {canAmend ? (
            <Card id="amend" title={t('form.editTitle')}>
              <CollectionForm
                mode="edit"
                today={today}
                minDate={addDays(today, -LOCK_DAYS)}
                collection={{
                  id: collection.id,
                  amount: collection.amount,
                  collectedOn: collection.collectedOn,
                  purpose: collection.purpose,
                  note: collection.note,
                  weekStart: collection.weekStart,
                  editability: collection.editability,
                }}
              />
            </Card>
          ) : (
            <p className="flex items-start gap-2.5 rounded-lg border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3 text-sm text-tone-info-fg">
              <svg
                viewBox="0 0 20 20"
                className="mt-0.5 size-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
                <path d="M7 9V6.75a3 3 0 016 0V9" />
              </svg>
              <span>{t('detail.readOnlyNotice')}</span>
            </p>
          )}

          {timeline ? <AuditTimeline entries={timeline} /> : null}
        </div>
      </div>
    </div>
  );
}
