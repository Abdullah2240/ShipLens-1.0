import { useLocale, useTranslations } from 'next-intl';
import { DataTable, EmptyState, StatusBadge, type Column } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { ApplicationListItem } from '@/modules/applications/review-types';
import { formatDateTime } from '@/platform/i18n/format';

export const applicationHref = (id: string) => `/people/applications/${id}`;

/** An ISO instant as a `<time>` in Pakistan time; unreadable values are shown as given. */
export function Instant({ value, locale }: { value: string; locale: Locale }) {
  let text = value;
  try {
    text = formatDateTime(new Date(value), locale);
  } catch {
    // keep the raw value
  }
  return (
    <time dateTime={value} className="tabular">
      {text}
    </time>
  );
}

export interface ApplicationsTableProps {
  applications: ApplicationListItem[];
  showBranch?: boolean;
}

export function ApplicationsTable({ applications, showBranch = false }: ApplicationsTableProps) {
  const t = useTranslations('applications.admin');
  const locale = useLocale() as Locale;

  const columns: Column<ApplicationListItem>[] = [
    {
      key: 'applicant',
      header: t('columns.applicant'),
      className: 'min-w-40',
      render: (row) => (
        <Link
          href={applicationHref(row.id)}
          className="font-semibold text-text underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {row.fullName}
        </Link>
      ),
    },
    {
      key: 'contact',
      header: t('columns.contact'),
      render: (row) => (
        <span className="flex flex-col items-start gap-0.5 text-xs text-text-muted">
          <span dir="ltr" className="max-w-56 truncate">
            {row.email}
          </span>
          {row.phone ? (
            <span dir="ltr" className="whitespace-nowrap tabular">
              {row.phone}
            </span>
          ) : null}
        </span>
      ),
    },
  ];

  if (showBranch) {
    columns.push({
      key: 'branch',
      header: t('columns.branch'),
      render: (row) => <span className="whitespace-nowrap text-text">{row.branchName}</span>,
    });
  }

  columns.push(
    {
      key: 'received',
      header: t('columns.received'),
      className: 'whitespace-nowrap text-text-muted',
      render: (row) => <Instant value={row.createdAt} locale={locale} />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
  );

  return (
    <DataTable
      columns={columns}
      rows={applications}
      getRowKey={(row) => row.id}
      caption={t('list.caption')}
      captionHidden
      empty={<EmptyState title={t('list.empty.title')} body={t('list.empty.body')} />}
    />
  );
}
