import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { DashboardModel, ExportKind } from './dashboard-view-model';

const EXPORTS: { kind: ExportKind; key: string }[] = [
  { kind: 'summary', key: 'exportSummary' },
  { kind: 'reports', key: 'exportReports' },
  { kind: 'collections', key: 'exportCollections' },
  { kind: 'unrouted', key: 'exportUnrouted' },
];

/** Export menu (native disclosure, no script) and the print link, both with the filters. */
export function DashboardActions({
  exportHref,
  printHref,
}: Pick<DashboardModel, 'exportHref' | 'printHref'>) {
  const t = useTranslations('dashboard.actions');
  const locale = useLocale();

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <details className="group relative">
        <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-surface-raised px-4 text-sm font-semibold text-text shadow-[0_1px_0_var(--color-border)] transition-colors hover:border-border-strong/60 [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4 text-text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13.25h10" />
          </svg>
          {t('export')}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </summary>
        <div className="absolute start-0 z-20 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface-raised p-1.5 shadow-card sm:start-auto sm:end-0">
          <p className="px-3 pt-2 pb-1.5 text-xs text-text-muted">{t('exportHint')}</p>
          <ul className="flex flex-col">
            {EXPORTS.map(({ kind, key }) => (
              <li key={kind}>
                <a
                  href={exportHref(kind, locale)}
                  download
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm text-text transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken"
                >
                  {t(key)}
                  <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[0.6875rem] text-text-muted">
                    {t('format')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </details>
      <Link
        href={printHref}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast transition-colors hover:bg-primary-hover"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z" />
        </svg>
        {t('print')}
      </Link>
    </div>
  );
}
