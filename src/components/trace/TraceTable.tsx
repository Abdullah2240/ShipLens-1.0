import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DataTable, type DataTableProps } from '@/components/ui/DataTable';
import type { Locale } from '@/i18n/routing';
import { formatInt } from '@/platform/i18n/format';

export type TraceMeasure = 'amount' | 'count';

export type TraceTableProps<T> = Omit<DataTableProps<T>, 'footer'> & {
  measure: TraceMeasure;
  /** Display-ready total of every record behind this level (not only the rows shown). */
  total: ReactNode;
  recordCount: number;
  /** true: the total equals the figure clicked in the parent level; null: no parent. */
  matchesParent: boolean | null;
  parentLabel?: string;
  truncated?: { shown: number };
  /** Column that carries the total; defaults to the last numeric column. */
  totalColumnKey?: string;
};

function MatchPill({ matches, parent }: { matches: boolean; parent: string }) {
  const t = useTranslations('trace.table');
  const tone = matches ? 'success' : 'danger';
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-current/15 ring-inset ${
        matches
          ? 'bg-tone-success-bg text-tone-success-fg'
          : 'bg-tone-danger-bg text-tone-danger-fg'
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {matches ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="M8 4v5M8 11.75v.01" />}
      </svg>
      {matches ? t('matches', { parent }) : t('mismatch', { parent })}
    </span>
  );
}

/**
 * A DataTable whose footer proves the level: the record count, the total, and whether
 * the total equals the number that was clicked one level up.
 */
export function TraceTable<T>({
  measure,
  total,
  recordCount,
  matchesParent,
  parentLabel,
  truncated,
  totalColumnKey,
  ...table
}: TraceTableProps<T>) {
  const t = useTranslations('trace');
  const locale = useLocale() as Locale;
  const { columns } = table;

  let totalIndex = totalColumnKey ? columns.findIndex((c) => c.key === totalColumnKey) : -1;
  if (totalIndex < 0) totalIndex = columns.findLastIndex((c) => c.align === 'numeric');
  if (totalIndex < 0) totalIndex = columns.length - 1;
  const trailing = columns.length - totalIndex - 1;

  const label = (
    <th
      scope="row"
      colSpan={Math.max(totalIndex === 0 ? trailing : totalIndex, 1)}
      className="px-4 py-3 text-start align-top"
    >
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span>{t('table.totalOf', { count: recordCount })}</span>
        {matchesParent === null ? null : (
          <MatchPill matches={matchesParent} parent={parentLabel ?? t('table.parentFallback')} />
        )}
      </span>
      {truncated ? (
        <span className="mt-1 block text-xs font-normal text-text-muted">
          {t('table.truncated', {
            shown: formatInt(truncated.shown, locale),
            count: formatInt(recordCount, locale),
          })}
        </span>
      ) : null}
    </th>
  );

  const totalCell = (
    <td data-measure={measure} className="px-4 py-3 text-end align-top whitespace-nowrap">
      <span className="sr-only">{t(`measure.${measure}`)} </span>
      <span className="text-base font-semibold tabular-nums tracking-tight text-text">
        <bdi dir="ltr">{total}</bdi>
      </span>
    </td>
  );

  const footer = (
    <tr>
      {totalIndex === 0 ? (
        <>
          {totalCell}
          {label}
        </>
      ) : (
        <>
          {label}
          {totalCell}
          {Array.from({ length: trailing }, (_, i) => (
            <td key={i} />
          ))}
        </>
      )}
    </tr>
  );

  return <DataTable {...table} footer={footer} />;
}
