import { useTranslations } from 'next-intl';
import { Bdi, DataTable, EmptyState, Ltr, StatusBadge, type Column } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { MEMBER_ROLES, type MemberListItem } from '@/modules/members/types';
import { formatId } from '@/platform/i18n/format';

export const memberHref = (id: string) => `/people/members/${id}`;

/** True when the stored organisational role has a translated label. */
export function isKnownRole(role: string): role is (typeof MEMBER_ROLES)[number] {
  return (MEMBER_ROLES as readonly string[]).includes(role);
}

export function MemberCode({ code }: { code: string }) {
  return (
    <Ltr className="inline-block rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-xs font-medium text-text-muted tabular">
      {formatId(code)}
    </Ltr>
  );
}

export interface MembersTableProps {
  members: MemberListItem[];
  showBranch?: boolean;
}

export function MembersTable({ members, showBranch = false }: MembersTableProps) {
  const t = useTranslations('members');
  const role = (value: string) => (isKnownRole(value) ? t(`roles.${value}`) : value);

  const columns: Column<MemberListItem>[] = [
    {
      key: 'code',
      header: t('columns.code'),
      render: (row) => <MemberCode code={row.memberCode} />,
      className: 'whitespace-nowrap',
    },
    {
      key: 'name',
      header: t('columns.name'),
      render: (row) => (
        <Link
          href={memberHref(row.id)}
          className="font-semibold text-text underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Bdi>{row.fullName}</Bdi>
        </Link>
      ),
      className: 'min-w-40',
    },
    {
      key: 'team',
      header: t('columns.team'),
      render: (row) =>
        row.teamName ? (
          <Bdi className="text-text">{row.teamName}</Bdi>
        ) : (
          <span className="text-text-muted italic">{t('detail.unassigned')}</span>
        ),
    },
    {
      key: 'role',
      header: t('columns.role'),
      render: (row) => <span className="whitespace-nowrap text-text">{role(row.memberRole)}</span>,
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'contact',
      header: t('columns.contact'),
      render: (row) => (
        <span className="flex flex-col items-start gap-0.5 text-xs text-text-muted">
          {row.email ? <Ltr className="max-w-56 truncate">{row.email}</Ltr> : null}
          {row.phone ? <Ltr className="whitespace-nowrap tabular">{row.phone}</Ltr> : null}
          {!row.email && !row.phone ? <span aria-hidden="true">—</span> : null}
        </span>
      ),
    },
  ];

  if (showBranch) {
    columns.push({
      key: 'branch',
      header: t('columns.branch'),
      render: (row) => <Bdi className="whitespace-nowrap text-text">{row.branchName}</Bdi>,
    });
  }

  return (
    <DataTable
      columns={columns}
      rows={members}
      getRowKey={(row) => row.id}
      caption={t('list.caption')}
      captionHidden
      empty={<EmptyState title={t('list.emptyTitle')} body={t('list.emptyBody')} />}
    />
  );
}
