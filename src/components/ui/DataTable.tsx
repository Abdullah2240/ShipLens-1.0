import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export type Column<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'start' | 'end' | 'numeric';
  className?: string;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  caption: string;
  captionHidden?: boolean;
  empty?: ReactNode;
  // A <tr> rendered inside <tfoot>, for totals.
  footer?: ReactNode;
};

function cellClass(align: Column<unknown>['align']) {
  return align === 'end' || align === 'numeric' ? 'text-end' : 'text-start';
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  captionHidden,
  empty,
  footer,
}: DataTableProps<T>) {
  if (rows.length === 0) return <>{empty ?? <EmptyState />}</>;

  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-card border border-border bg-surface-raised shadow-card"
    >
      <table className="w-full border-collapse text-sm">
        <caption className={captionHidden ? 'sr-only' : 'px-4 py-3 text-start font-semibold'}>
          {caption}
        </caption>
        <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-text-muted">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`px-4 py-2.5 font-semibold ${cellClass(c.align)}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="hover:bg-surface-sunken/60">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 ${cellClass(c.align)} ${c.align === 'numeric' ? 'tabular' : ''} ${c.className ?? ''}`}
                >
                  {c.align === 'numeric' ? <span dir="ltr">{c.render(row)}</span> : c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot className="border-t border-border-strong/40 bg-surface-sunken font-semibold">
            {footer}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
