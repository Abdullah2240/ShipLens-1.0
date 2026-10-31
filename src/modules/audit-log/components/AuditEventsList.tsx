import { useTranslations } from 'next-intl';
import { Bdi, DateText, EmptyState, IdText, Ltr } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { AuditListItem } from '../types';
import { AuditChangeTable } from './AuditChangeTable';
import { auditEntityHref, isTraceLink } from './audit-entity-link';

export interface AuditEventsListProps {
  items: AuditListItem[];
  /** Link to the next (older) page, or null on the last page. */
  nextHref: string | null;
}

const MESSAGE_KEY = /^[a-z][a-z0-9_]*$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Inline-start accent per record family. Full class strings so Tailwind can see them.
const ENTITY_ACCENT: Record<string, string> = {
  report: 'border-s-primary/70',
  collection: 'border-s-accent/70',
  export: 'border-s-tone-info-fg/60',
  share: 'border-s-tone-info-fg/60',
  branch: 'border-s-tone-warning-fg/60',
  application: 'border-s-tone-pending-fg/60',
  member: 'border-s-tone-pending-fg/60',
  team: 'border-s-tone-pending-fg/60',
  content: 'border-s-tone-success-fg/60',
  event: 'border-s-tone-success-fg/60',
};
const DEFAULT_ACCENT = 'border-s-border-strong/50';

// Shared column template: one line from md up, wrapped onto two lines on phones.
const GRID =
  'md:grid md:grid-cols-[9.5rem_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)_5.5rem_1rem] md:items-center md:gap-x-4';

function shortId(id: string): string {
  return UUID.test(id) ? id.slice(0, 8) : id;
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none rtl:-scale-x-100"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function ArrowOut() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-3.5 rtl:-scale-x-100"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function EventRow({ item }: { item: AuditListItem }) {
  const t = useTranslations('audit');
  const label = (prefix: string, key: string) =>
    MESSAGE_KEY.test(key) && t.has(`${prefix}.${key}`) ? t(`${prefix}.${key}`) : null;

  const actionLabel = label('actions', item.action.replaceAll('.', '_'));
  const roleLabel = label('roles', item.actorRole) ?? item.actorRole;
  const entityLabel = label('entities', item.entityType) ?? item.entityType;
  const isSystem = !item.actorName && (item.actorId === null || item.actorRole === 'system');
  const accent = Object.hasOwn(ENTITY_ACCENT, item.entityType)
    ? ENTITY_ACCENT[item.entityType]
    : DEFAULT_ACCENT;
  const trace = isTraceLink(item);

  return (
    <li
      data-event-id={item.id}
      data-tone={item.entityType}
      className={`border-s-[3px] ${accent} bg-surface-raised transition-colors hover:bg-surface-sunken/40`}
    >
      <details className="group">
        <summary
          className={`flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden ${GRID}`}
        >
          <span className="order-2 text-xs text-text-muted md:order-none md:text-sm">
            <DateText value={item.occurredAt} withTime />
          </span>

          <span className="order-3 flex min-w-0 items-center gap-1.5 text-xs md:order-none md:text-sm">
            <span className="truncate font-medium text-text">
              {item.actorName ? <Bdi>{item.actorName}</Bdi> : isSystem ? t('viewer.system') : null}
            </span>
            {isSystem ? null : (
              <span
                data-role-badge
                className="shrink-0 rounded-full bg-tone-neutral-bg px-2 py-px text-[11px] font-semibold text-tone-neutral-fg"
              >
                {roleLabel}
              </span>
            )}
          </span>

          <span className="order-1 flex w-full min-w-0 flex-wrap items-baseline gap-x-2 md:order-none md:w-auto">
            <span data-action-label className="font-semibold text-text">
              {actionLabel ?? <Ltr className="font-mono text-[0.92em]">{item.action}</Ltr>}
            </span>
            {actionLabel ? (
              <span data-action-code className="text-xs text-text-muted">
                <IdText id={item.action} mono />
              </span>
            ) : null}
          </span>

          <span className="order-4 flex min-w-0 items-center gap-1.5 text-xs text-text-muted md:order-none md:text-sm">
            <span className="text-text">{entityLabel}</span>
            <Ltr className="truncate font-mono text-[0.92em]">
              <span title={item.entityId}>{shortId(item.entityId)}</span>
            </Ltr>
          </span>

          <span className="order-5 text-xs text-text-muted md:order-none md:text-sm">
            {item.branchCode ? (
              <span data-branch-code>
                <Ltr className="font-mono text-[0.92em] font-medium text-text">
                  {item.branchCode}
                </Ltr>
              </span>
            ) : (
              <span aria-hidden="true">·</span>
            )}
          </span>

          <span className="order-6 ms-auto md:order-none md:ms-0">
            <Chevron />
          </span>
        </summary>

        <div className="flex flex-col gap-3 border-t border-border/70 bg-surface-sunken/30 px-4 py-4 md:ps-[calc(9.5rem+2rem)]">
          <AuditChangeTable before={item.before} after={item.after} />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-text-muted">
            {item.requestId ? (
              <span data-request-id className="inline-flex items-center gap-1.5">
                <span>{t('viewer.requestId')}</span>
                <IdText id={item.requestId} mono className="text-text" />
              </span>
            ) : (
              <span />
            )}
            <Link
              href={auditEntityHref(item)}
              data-entity-link
              className="inline-flex items-center gap-1.5 rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {trace ? t('viewer.openTrace') : t('viewer.filterRecord')}
              <ArrowOut />
            </Link>
          </div>
        </div>
      </details>
    </li>
  );
}

/** "Showing finance records only" callout for the Finance Reviewer's restricted view. */
export function AuditRestrictedNotice() {
  const t = useTranslations('audit.viewer');
  return (
    <p
      role="note"
      className="flex items-start gap-2.5 rounded-card border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3 text-sm text-tone-info-fg"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0"
      >
        <path d="M10 2.5l6.5 2.5v4.5c0 4-2.8 6.9-6.5 8-3.7-1.1-6.5-4-6.5-8V5L10 2.5z" />
        <path d="M7.5 10l1.8 1.8 3.2-3.6" />
      </svg>
      <span>{t('restricted')}</span>
    </p>
  );
}

/** Newest-first audit events; each row opens to its before and after values. */
export function AuditEventsList({ items, nextHref }: AuditEventsListProps) {
  const t = useTranslations('audit.viewer');

  if (items.length === 0) {
    return <EmptyState title={t('empty.title')} body={t('empty.body')} />;
  }

  return (
    <section aria-label={t('listLabel')} className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card">
        <div
          aria-hidden="true"
          className={`hidden border-b border-border bg-surface-sunken/60 px-4 py-2 text-xs font-semibold text-text-muted md:grid ${GRID} border-s-[3px] border-s-transparent`}
        >
          <span>{t('columns.time')}</span>
          <span>{t('columns.actor')}</span>
          <span>{t('columns.action')}</span>
          <span>{t('columns.entity')}</span>
          <span>{t('columns.branch')}</span>
          <span />
        </div>
        <ol className="divide-y divide-border/70">
          {items.map((item) => (
            <EventRow key={item.id} item={item} />
          ))}
        </ol>
      </div>
      {nextHref ? (
        <div className="flex justify-center">
          <Link
            href={nextHref}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border-strong/50 bg-surface-raised px-4 text-sm font-semibold text-text shadow-xs transition-colors hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t('loadOlder')}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-3.5"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </Link>
        </div>
      ) : null}
    </section>
  );
}
