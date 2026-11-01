import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { MEMBER_ROLES, MEMBER_STATUS_VALUES, type TeamItem } from '@/modules/members/types';
import { formatInt } from '@/platform/i18n/format';

export const MEMBERS_PATH = '/people/members';
const DEFAULT_PAGE_SIZE = 25;

export type MemberFilterValues = {
  q?: string;
  teamId?: string;
  role?: string;
  status?: string;
  pageSize?: number;
};

/** List URL for a set of filters; page 1 and the default page size stay out of the URL. */
export function membersHref(values: MemberFilterValues, page = 1): string {
  const params = new URLSearchParams();
  for (const key of ['q', 'teamId', 'role', 'status'] as const) {
    const value = values[key];
    if (value) params.set(key, value);
  }
  if (values.pageSize && values.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set('pageSize', String(values.pageSize));
  }
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search ? `${MEMBERS_PATH}?${search}` : MEMBERS_PATH;
}

type TeamOption = Pick<TeamItem, 'id' | 'name' | 'branchName'>;

export interface MembersFiltersProps {
  values: MemberFilterValues;
  teams: TeamOption[];
  total: number;
}

const labelClass = 'text-xs font-semibold text-text-muted';
const fieldClass =
  'block h-10 w-full rounded-lg border border-border-strong/50 bg-surface-raised text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function TeamOptions({ teams }: { teams: TeamOption[] }) {
  const branches = [...new Set(teams.map((team) => team.branchName))].sort((a, b) =>
    a.localeCompare(b),
  );
  if (branches.length <= 1) {
    return teams.map((team) => (
      <option key={team.id} value={team.id}>
        {team.name}
      </option>
    ));
  }
  return branches.map((branch) => (
    <optgroup key={branch} label={branch}>
      {teams
        .filter((team) => team.branchName === branch)
        .map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
    </optgroup>
  ));
}

/** Search and filters as a native GET form, so results are shareable URLs. */
export function MembersFilters({ values, teams, total }: MembersFiltersProps) {
  const t = useTranslations('members');
  const status = useTranslations('common.status');
  const locale = useLocale() as Locale;
  const filtered = Boolean(values.q || values.teamId || values.role || values.status);

  return (
    <form
      method="get"
      role="search"
      aria-label={t('list.searchLabel')}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface-raised p-4 shadow-card sm:p-5"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
          <label htmlFor="members-q" className={labelClass}>
            {t('list.searchLabel')}
          </label>
          <div className="relative">
            <svg
              viewBox="0 0 20 20"
              className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.25 13.25L17 17" />
            </svg>
            <input
              id="members-q"
              type="search"
              name="q"
              dir="auto"
              defaultValue={values.q ?? ''}
              maxLength={100}
              placeholder={t('list.searchPlaceholder')}
              className={`${fieldClass} ps-9 pe-3 placeholder:text-text-muted/80`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="members-team" className={labelClass}>
            {t('list.filterTeam')}
          </label>
          <select
            id="members-team"
            name="teamId"
            defaultValue={values.teamId ?? ''}
            className={`${fieldClass} px-3`}
          >
            <option value="">{t('list.allTeams')}</option>
            <TeamOptions teams={teams} />
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="members-role" className={labelClass}>
            {t('list.filterRole')}
          </label>
          <select
            id="members-role"
            name="role"
            defaultValue={values.role ?? ''}
            className={`${fieldClass} px-3`}
          >
            <option value="">{t('list.allRoles')}</option>
            {MEMBER_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="members-status" className={labelClass}>
            {t('list.filterStatus')}
          </label>
          <select
            id="members-status"
            name="status"
            defaultValue={values.status ?? ''}
            className={`${fieldClass} px-3`}
          >
            <option value="">{t('list.allStatuses')}</option>
            {MEMBER_STATUS_VALUES.map((value) => (
              <option key={value} value={value}>
                {status(value)}
              </option>
            ))}
          </select>
        </div>

        {values.pageSize && values.pageSize !== DEFAULT_PAGE_SIZE ? (
          <input type="hidden" name="pageSize" value={values.pageSize} />
        ) : null}

        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:col-span-2 lg:col-span-1"
        >
          {t('list.apply')}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
        <p role="status" className="font-medium text-text-muted tabular">
          {t('list.resultCount', { count: total, total: formatInt(total, locale) })}
        </p>
        {filtered ? (
          <Link
            href={MEMBERS_PATH}
            className="inline-flex items-center gap-1.5 rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
            </svg>
            {t('list.clear')}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
