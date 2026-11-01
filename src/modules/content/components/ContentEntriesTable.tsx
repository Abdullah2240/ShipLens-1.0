import { useLocale, useTranslations } from 'next-intl';
import { Bdi, DataTable, Ltr, StatusBadge, type Column } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { CONTENT_KEYS } from '@/modules/public-site/keys';
import { formatDateTime } from '@/platform/i18n/format';
import type { ContentEntryView, ContentKey, ContentLocale } from '@/modules/content/types';

export const LANGUAGE_KEY: Record<ContentLocale, 'columns.english' | 'columns.urdu'> = {
  en: 'columns.english',
  ur: 'columns.urdu',
};

export const entryHref = (key: ContentKey, locale: ContentLocale) => `/content/${key}/${locale}`;

export function placeholderEntry(key: ContentKey, locale: ContentLocale): ContentEntryView {
  return {
    key,
    locale,
    exists: false,
    title: null,
    body: null,
    status: 'draft',
    hasUnpublishedChanges: false,
    translationMissing: locale === 'ur',
    publishedAt: null,
    updatedAt: null,
  };
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3.5l7 12.5H3L10 3.5zM10 8.5v3.5M10 14.25v.25" />
    </svg>
  );
}

/** Status of one entry: not created / draft / published, plus change and translation markers. */
export function EntryStateBadges({ entry }: { entry: ContentEntryView }) {
  const t = useTranslations('content.state');

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {entry.exists ? (
        <StatusBadge status={entry.status} label={t(entry.status)} />
      ) : (
        <span
          data-state="not-created"
          className="inline-flex items-center rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-xs font-semibold text-text-muted"
        >
          {t('notCreated')}
        </span>
      )}
      {entry.hasUnpublishedChanges ? (
        <span
          data-state="unpublished-changes"
          className="inline-flex items-center gap-1.5 rounded-full bg-tone-info-bg px-2.5 py-0.5 text-xs font-semibold text-tone-info-fg"
        >
          <span aria-hidden="true" className="size-1.5 rounded-full border border-current" />
          {t('unpublishedChanges')}
        </span>
      ) : null}
      {entry.translationMissing ? (
        <span
          data-state="missing-translation"
          className="inline-flex items-center gap-1 rounded-full bg-tone-warning-bg px-2.5 py-0.5 text-xs font-semibold text-tone-warning-fg"
        >
          <WarningIcon />
          {t('missingTranslation')}
        </span>
      ) : null}
    </span>
  );
}

type Row = { key: ContentKey; en: ContentEntryView; ur: ContentEntryView };

function latest(row: Row): string | null {
  const stamps = [row.en.updatedAt, row.ur.updatedAt].filter((v): v is string => Boolean(v));
  if (stamps.length === 0) return null;
  return stamps.reduce((a, b) => (new Date(a) >= new Date(b) ? a : b));
}

export function ContentEntriesTable({ entries }: { entries: ContentEntryView[] }) {
  const t = useTranslations('content');
  const locale = useLocale() as Locale;

  const find = (key: ContentKey, lang: ContentLocale) =>
    entries.find((e) => e.key === key && e.locale === lang) ?? placeholderEntry(key, lang);

  const rows: Row[] = CONTENT_KEYS.filter((key) => entries.some((e) => e.key === key)).map(
    (key) => ({ key, en: find(key, 'en'), ur: find(key, 'ur') }),
  );

  const cell = (lang: ContentLocale) =>
    function EntryCell(row: Row) {
      return (
        <div className="flex flex-col items-start gap-2">
          <EntryStateBadges entry={row[lang]} />
          {/* The link's ::after covers the whole cell, so the cell is one click target. */}
          <Link
            href={entryHref(row.key, lang)}
            aria-label={t('actions.open', {
              page: t(`keys.${row.key}`),
              language: t(LANGUAGE_KEY[lang]),
            })}
            className="text-sm font-semibold text-primary underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('actions.edit')}
          </Link>
        </div>
      );
    };

  const columns: Column<Row>[] = [
    {
      key: 'page',
      header: t('columns.page'),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-text">{t(`keys.${row.key}`)}</span>
          <Ltr className="text-xs text-text-muted">/{row.key}</Ltr>
        </span>
      ),
    },
    {
      key: 'en',
      header: t('columns.english'),
      render: cell('en'),
      className: 'relative hover:bg-surface-sunken',
    },
    {
      key: 'ur',
      header: t('columns.urdu'),
      render: cell('ur'),
      className: 'relative hover:bg-surface-sunken',
    },
    {
      key: 'updated',
      header: t('columns.updated'),
      render: (row) => {
        const stamp = latest(row);
        return stamp ? (
          <Bdi className="whitespace-nowrap text-text-muted">
            <time dateTime={stamp}>{formatDateTime(new Date(stamp), locale)}</time>
          </Bdi>
        ) : (
          <span className="text-text-muted">—</span>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.key}
      caption={t('list.caption')}
      captionHidden
    />
  );
}
