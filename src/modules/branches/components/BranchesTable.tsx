import { useLocale, useTranslations } from 'next-intl';
import { Bdi, DataTable, EmptyState, Ltr, StatusBadge, type Column } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { BranchListItem } from '@/modules/branches/types';
import { formatDate, formatId, formatInt } from '@/platform/i18n/format';

export const BRANCHES_PATH = '/admin/branches';
export const branchHref = (id: string) => `${BRANCHES_PATH}/${id}`;

/** Branch code, kept LTR and in Latin digits inside Urdu text. */
export function BranchCode({ code }: { code: string }) {
  return (
    <Ltr className="inline-block rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-xs font-medium text-text-muted tabular">
      {formatId(code)}
    </Ltr>
  );
}

/**
 * An ISO instant as a PKT calendar date, isolated with automatic direction; falls back to the
 * raw text if it cannot be read.
 */
export function BranchDate({ value, locale }: { value: string; locale: Locale }) {
  let text = value;
  try {
    text = formatDate(new Date(value), locale);
  } catch {
    // keep the raw value
  }
  return (
    <Bdi className="whitespace-nowrap tabular">
      <time dateTime={value}>{text}</time>
    </Bdi>
  );
}

export interface BranchesTableProps {
  branches: BranchListItem[];
}

export function BranchesTable({ branches }: BranchesTableProps) {
  const t = useTranslations('branches');
  const locale = useLocale() as Locale;

  const columns: Column<BranchListItem>[] = [
    {
      key: 'code',
      header: t('columns.code'),
      render: (row) => <BranchCode code={row.code} />,
      className: 'whitespace-nowrap',
    },
    {
      key: 'name',
      header: t('columns.name'),
      render: (row) => (
        <Link
          href={branchHref(row.id)}
          className="font-semibold text-text underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Bdi>{row.name}</Bdi>
        </Link>
      ),
      className: 'min-w-44',
    },
    {
      key: 'city',
      header: t('columns.city'),
      render: (row) =>
        row.city ? (
          <Bdi className="whitespace-nowrap text-text">{row.city}</Bdi>
        ) : (
          <span className="text-text-muted">
            <span aria-hidden="true">—</span>
            <span className="sr-only">{t('detail.notSet')}</span>
          </span>
        ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'leads',
      header: t('columns.leads'),
      align: 'numeric',
      render: (row) => formatInt(row.leadCount, locale),
    },
    {
      key: 'created',
      header: t('columns.created'),
      render: (row) => (
        <span className="text-text-muted">
          <BranchDate value={row.createdAt} locale={locale} />
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={branches}
      getRowKey={(row) => row.id}
      caption={t('register.caption')}
      captionHidden
      empty={<EmptyState title={t('register.empty')} body={t('register.emptyBody')} />}
    />
  );
}
