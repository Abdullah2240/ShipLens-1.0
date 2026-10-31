import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatDate, formatDateTime } from '@/platform/i18n/format';

// Print-optimised A4 sheet for head office reports (EXP-03). On screen it is a sheet of
// paper on the page surface; in print it is the page itself: black on white whatever the
// theme, no app chrome, rows that never split across pages, headings kept with their
// tables. Server-compatible.

/**
 * Print rules for the print pages only. Unlayered, so they win over the theme tokens and
 * utilities in every theme. The app shell's main padding is dropped because @page sets
 * the margins.
 */
export const PRINT_CSS = `
@page {
  size: A4;
  margin: 14mm;
  @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #555555; }
}
@media print {
  :root, :root[data-theme] {
    color-scheme: light;
    --color-surface: #ffffff;
    --color-surface-raised: #ffffff;
    --color-surface-sunken: #f3f3f3;
    --color-border: #cfcfcf;
    --color-border-strong: #4d4d4d;
    --color-text: #000000;
    --color-text-muted: #444444;
    --color-primary: #000000;
    --color-accent: #000000;
    --color-tone-success-bg: #ffffff;
    --color-tone-success-fg: #000000;
    --color-tone-danger-bg: #ffffff;
    --color-tone-danger-fg: #000000;
    --color-tone-neutral-bg: #ffffff;
    --color-tone-neutral-fg: #000000;
  }
  html { font-size: 10pt; background: #ffffff; }
  body { background: #ffffff; color: #000000; }
  #main { padding: 0; max-width: none; }
  [data-print-sheet] {
    max-width: none; padding: 0; border: 0; border-radius: 0; box-shadow: none; gap: 1.5rem;
    background: #ffffff; color: #000000;
  }
  [data-print-meta] { grid-template-columns: repeat(4, minmax(0, 1fr)); column-gap: 1.5rem; }
  a { color: inherit; text-decoration: none; }
  [data-print-row] { break-inside: avoid; }
  [data-print-heading] { break-after: avoid; }
  [data-print-section] { break-inside: auto; }
}
`;

/** A date or PKT date-time with automatic direction, so Urdu dates keep their word order. */
export function PrintDate({ value, withTime }: { value: string; withTime?: boolean }) {
  const locale = useLocale() as Locale;
  const instant = withTime || value.includes('T');
  const text = instant
    ? withTime
      ? formatDateTime(new Date(value), locale)
      : formatDate(new Date(value), locale)
    : formatDate(value, locale);
  return (
    <bdi className="tabular whitespace-nowrap">
      <time dateTime={value}>{text}</time>
    </bdi>
  );
}

export interface PrintMetaItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
}

/** The letterhead's facts: filters, as-of time, who it was generated for. */
export function PrintMeta({ label, items }: { label: string; items: PrintMetaItem[] }) {
  return (
    <dl
      aria-label={label}
      data-print-meta
      className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[0.6875rem] font-semibold tracking-[0.08em] text-text-muted uppercase rtl:tracking-normal rtl:normal-case">
            {item.label}
          </dt>
          <dd className="text-sm text-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled part of the report; the heading stays on the page of what follows it. */
export function PrintSection({
  title,
  note,
  children,
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-print-section className="flex flex-col gap-3">
      <div
        data-print-heading
        className="flex flex-col gap-0.5 border-b border-border-strong pb-1.5"
      >
        <h2 className="text-base font-semibold text-text">{title}</h2>
        {note ? <p className="text-xs text-text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export interface PrintColumn {
  key: string;
  header: ReactNode;
  numeric?: boolean;
}

/**
 * A plain report table: hairline rows, numbers at the inline end in tabular figures, an
 * optional total row with a heavier rule. Rows never split across pages.
 */
export function PrintTable({
  caption,
  columns,
  rows,
  footer,
  empty,
}: {
  caption: string;
  columns: PrintColumn[];
  rows: { key: string; cells: ReactNode[] }[];
  footer?: ReactNode[];
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) {
    return <p className="py-2 text-sm text-text-muted">{empty}</p>;
  }
  const align = (column: PrintColumn) =>
    column.numeric ? 'text-end tabular whitespace-nowrap' : 'text-start';
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="relative overflow-x-auto print:overflow-visible"
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border-strong">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`px-2 pt-1 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-text-muted uppercase first:ps-0 last:pe-0 rtl:tracking-normal rtl:normal-case ${align(c)}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-print-row className="border-b border-border">
              {row.cells.map((cell, i) => {
                const column = columns[i]!;
                const Cell = i === 0 ? 'th' : 'td';
                return (
                  <Cell
                    key={column.key}
                    scope={i === 0 ? 'row' : undefined}
                    className={`px-2 py-1.5 align-top font-normal text-text first:ps-0 last:pe-0 ${align(column)}`}
                  >
                    {cell}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot>
            <tr data-print-row className="border-t-2 border-text">
              {footer.map((cell, i) => {
                const column = columns[i]!;
                const Cell = i === 0 ? 'th' : 'td';
                return (
                  <Cell
                    key={column.key}
                    scope={i === 0 ? 'row' : undefined}
                    className={`px-2 pt-2 pb-1 font-semibold text-text first:ps-0 last:pe-0 ${align(column)}`}
                  >
                    {cell}
                  </Cell>
                );
              })}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Screen-only bar above the sheet: back link, a hint about the PDF destination, the button. */
export function PrintToolbar({ backHref, children }: { backHref: string; children: ReactNode }) {
  const t = useTranslations('exports.print');
  return (
    <div
      role="group"
      aria-label={t('toolbar')}
      className="mx-auto flex w-full max-w-[210mm] flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:hidden"
    >
      <Link
        href={backHref}
        className="inline-flex h-10 items-center gap-1.5 self-start rounded-lg text-sm font-medium text-primary hover:underline"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4 rtl:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
        {t('back')}
      </Link>
      <div className="flex flex-col gap-2 sm:items-end">
        {children}
        <p className="max-w-xs text-xs text-text-muted sm:text-end">{t('hint')}</p>
      </div>
    </div>
  );
}

/**
 * The printable document: letterhead (app name, document kind, title, meta facts), the
 * report body and a closing note. `meta` is usually a PrintMeta.
 */
export function PrintSheet({
  title,
  meta,
  children,
}: {
  title: ReactNode;
  meta: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('exports.print');
  const common = useTranslations('common');

  return (
    <>
      <style>{PRINT_CSS}</style>
      <article
        data-print-sheet
        className="mx-auto flex w-full max-w-[210mm] flex-col gap-8 rounded-card border border-border bg-surface-raised px-5 py-7 text-text shadow-card sm:px-[14mm] sm:py-[12mm] print:bg-white print:text-black print:shadow-none"
      >
        <header className="flex flex-col gap-5">
          <div className="flex items-baseline justify-between gap-4 border-b-2 border-text pb-3">
            <p className="text-sm font-bold tracking-tight text-primary">{common('appName')}</p>
            <p className="text-xs font-medium tracking-[0.08em] text-text-muted uppercase rtl:tracking-normal rtl:normal-case">
              {t('documentKind')}
            </p>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-text sm:text-[1.75rem] rtl:tracking-normal">
            {title}
          </h1>
          {meta}
        </header>
        <div className="flex flex-col gap-8 print:gap-6">{children}</div>
        <footer className="border-t border-border pt-3 text-xs leading-relaxed text-text-muted">
          {t('pageNote')}
        </footer>
      </article>
    </>
  );
}
