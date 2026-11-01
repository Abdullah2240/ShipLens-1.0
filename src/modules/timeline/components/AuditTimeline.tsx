import { useId, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bdi, EmptyState, Ltr } from '@/components/ui';
import { fillSlots, slot } from '@/components/ui/Bidi';
import type { Locale } from '@/i18n/routing';
import { formatDate, formatDateTime, formatInt, formatMoney } from '@/platform/i18n/format';
import { actionMessageKey } from '../actions';
import type { TimelineChange, TimelineEntry } from '../types';

export interface AuditTimelineProps {
  entries: TimelineEntry[];
  emptyHint?: string;
  headingLevel?: 2 | 3;
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

// Full class strings so Tailwind can see them.
const DOT_CLASSES: Record<Tone, string> = {
  neutral: 'bg-border-strong',
  info: 'bg-tone-info-fg',
  success: 'bg-tone-success-fg',
  warning: 'bg-tone-warning-fg',
  danger: 'bg-tone-danger-fg',
};

const VERB_TONES: Record<string, Tone> = {
  submit: 'info',
  resubmit: 'info',
  approve: 'success',
  accept: 'success',
  publish: 'success',
  mark_routed: 'success',
  return: 'warning',
  amend_exempt: 'warning',
  void_exempt: 'warning',
  unpublish: 'warning',
  unmark_routed: 'warning',
  void: 'danger',
  decline: 'danger',
};

const MONEY_FIELDS = new Set(['amount', 'total_amount']);
const DATE_FIELDS = new Set(['collected_on', 'week_start']);
const INSTANT_FIELDS = new Set(['routed_at', 'voided_at', 'starts_at', 'ends_at']);
const COUNT_FIELDS = new Set(['collection_count', 'version', 'row_count']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_KEY = /^[a-z][a-z0-9_]*$/i;

function toneOf(action: string): Tone {
  const verb = action.slice(action.indexOf('.') + 1);
  return Object.hasOwn(VERB_TONES, verb) ? (VERB_TONES[verb] ?? 'neutral') : 'neutral';
}

function attempt(format: () => string, fallback: string): string {
  try {
    return format();
  } catch {
    return fallback;
  }
}

/** An identifier isolated in LTR direction; UUIDs show their first 8 characters. */
function IdText({ value }: { value: string }) {
  return (
    <bdi dir="ltr" title={value} className="font-mono text-[0.92em] tracking-tight">
      {UUID.test(value) ? value.slice(0, 8) : value}
    </bdi>
  );
}

function ChangeArrow() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-3.5 shrink-0 text-text-muted rtl:-scale-x-100"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-3 transition-transform group-open:rotate-180 motion-reduce:transition-none"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function useValueFormatter(locale: Locale) {
  const t = useTranslations('audit');
  const tStatus = useTranslations('common.status');

  return function formatValue(field: string, value: unknown): ReactNode {
    if (value === null || value === undefined) {
      return (
        <span className="text-text-muted">
          <span aria-hidden="true">—</span>
          <span className="sr-only">{t('timeline.none')}</span>
        </span>
      );
    }
    if (typeof value === 'boolean') return value ? t('timeline.yes') : t('timeline.no');
    if (typeof value === 'object') return <bdi>{JSON.stringify(value)}</bdi>;

    const text = String(value);
    if (MONEY_FIELDS.has(field)) {
      return (
        <Ltr className="tabular whitespace-nowrap">
          {attempt(() => formatMoney(text, locale), text)}
        </Ltr>
      );
    }
    if (DATE_FIELDS.has(field)) return <Bdi>{attempt(() => formatDate(text, locale), text)}</Bdi>;
    if (INSTANT_FIELDS.has(field)) {
      return <Bdi>{attempt(() => formatDateTime(new Date(text), locale), text)}</Bdi>;
    }
    if (COUNT_FIELDS.has(field)) return attempt(() => formatInt(text, locale), text);
    if (field === 'status' && MESSAGE_KEY.test(text) && tStatus.has(text)) return tStatus(text);
    if (field === 'role' && MESSAGE_KEY.test(text) && t.has(`roles.${text}`)) {
      return t(`roles.${text}`);
    }
    if (field === 'id' || field.endsWith('_id')) return <IdText value={text} />;
    return <bdi>{text}</bdi>;
  };
}

function ChangeList({ changes, locale }: { changes: TimelineChange[]; locale: Locale }) {
  const t = useTranslations('audit');
  const formatValue = useValueFormatter(locale);
  const fieldLabel = (field: string) =>
    MESSAGE_KEY.test(field) && t.has(`fields.${field}`) ? t(`fields.${field}`) : field;

  return (
    <dl aria-label={t('timeline.changed')} className="divide-y divide-border/70">
      {changes.map((change) => (
        <div
          key={change.field}
          data-change={change.field}
          className="grid gap-x-4 gap-y-0.5 py-1.5 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)]"
        >
          <dt className="text-text-muted">{fieldLabel(change.field)}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 break-words">
            <span className="sr-only">{t('timeline.from')}</span>
            <span className="text-text-muted">{formatValue(change.field, change.before)}</span>
            <ChangeArrow />
            <span className="sr-only">{t('timeline.to')}</span>
            <span className="font-medium text-text">{formatValue(change.field, change.after)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RequestId({ value }: { value: string }) {
  const t = useTranslations('audit');
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{t('timeline.requestId')}</span>
      <IdText value={value} />
    </span>
  );
}

function TimelineItem({
  entry,
  last,
  locale,
}: {
  entry: TimelineEntry;
  last: boolean;
  locale: Locale;
}) {
  const t = useTranslations('audit');
  const actionKey = actionMessageKey(entry.action);
  const actionLabel =
    MESSAGE_KEY.test(actionKey) && t.has(`actions.${actionKey}`)
      ? t(`actions.${actionKey}`)
      : entry.action;
  const roleLabel =
    MESSAGE_KEY.test(entry.actorRole) && t.has(`roles.${entry.actorRole}`)
      ? t(`roles.${entry.actorRole}`)
      : entry.actorRole;
  const entityLabel =
    MESSAGE_KEY.test(entry.entityType) && t.has(`entities.${entry.entityType}`)
      ? t(`entities.${entry.entityType}`)
      : entry.entityType;
  const occurred = new Date(entry.occurredAt);
  const when = attempt(() => formatDateTime(occurred, locale), entry.occurredAt);

  let actor: ReactNode;
  if (entry.actorName) {
    actor = (
      <span>
        {fillSlots(t('timeline.by', { name: slot() }), [<Bdi key="name">{entry.actorName}</Bdi>])}{' '}
        {t('timeline.as', { role: roleLabel })}
      </span>
    );
  } else if (entry.actorRole === 'system') {
    actor = <span>{t('timeline.system')}</span>;
  } else {
    actor = <span>{t('timeline.as', { role: roleLabel })}</span>;
  }

  return (
    <li data-entry-id={entry.id} className="relative flex gap-3 pb-6 last:pb-0">
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute start-[4.5px] top-[22px] bottom-0 w-px bg-border"
        />
      )}
      <span
        aria-hidden="true"
        className={`mt-1.5 size-2.5 shrink-0 rounded-full ${DOT_CLASSES[toneOf(entry.action)]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <p className="text-sm font-medium leading-5 text-text">{actionLabel}</p>
          <Bdi className="text-xs tabular-nums text-text-muted">
            <time dateTime={entry.occurredAt}>{when}</time>
          </Bdi>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          {actor}
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span>{entityLabel}</span>
            <IdText value={entry.entityId} />
          </span>
        </div>

        {entry.changes.length > 0 ? (
          <details className="group mt-2">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-medium text-primary select-none hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">
                {t('timeline.showChanges', { count: formatInt(entry.changes.length, locale) })}
              </span>
              <span className="hidden group-open:inline">{t('timeline.hideChanges')}</span>
              <Chevron />
            </summary>
            <div className="mt-2 rounded-lg border border-border bg-surface-sunken/60 px-3 py-2.5 text-xs">
              <ChangeList changes={entry.changes} locale={locale} />
              {entry.requestId ? (
                <p className="mt-2 border-t border-border/70 pt-2 text-[11px] text-text-muted">
                  <RequestId value={entry.requestId} />
                </p>
              ) : null}
            </div>
          </details>
        ) : (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
            <span className="italic">{t('timeline.noFieldChanges')}</span>
            {entry.requestId ? (
              <>
                <span aria-hidden="true">·</span>
                <RequestId value={entry.requestId} />
              </>
            ) : null}
          </p>
        )}
      </div>
    </li>
  );
}

/** Ordered, bilingual audit history for one record. Server-compatible: no client state. */
export function AuditTimeline({ entries, emptyHint, headingLevel = 2 }: AuditTimelineProps) {
  const t = useTranslations('audit');
  const raw = useLocale();
  const locale: Locale = raw === 'ur' ? 'ur' : 'en';
  const headingId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <Heading id={headingId} className="text-sm font-semibold text-text">
        {t('timeline.title')}
      </Heading>
      {entries.length === 0 ? (
        <EmptyState title={t('timeline.empty')} body={emptyHint ?? t('timeline.emptyHint')} />
      ) : (
        <ol aria-labelledby={headingId} className="flex flex-col">
          {entries.map((entry, i) => (
            <TimelineItem
              key={entry.id}
              entry={entry}
              last={i === entries.length - 1}
              locale={locale}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
