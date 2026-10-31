import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { APPLICATION_STATUSES } from '@/platform/config/constants';

export const APPLICATIONS_PATH = '/people/applications';
const DEFAULT_PAGE_SIZE = 25;

export const APPLICATION_TABS = [...APPLICATION_STATUSES, 'all'] as const;
export type ApplicationTab = (typeof APPLICATION_TABS)[number];

const TAB_LABEL = {
  pending: 'tabPending',
  accepted: 'tabAccepted',
  declined: 'tabDeclined',
  all: 'tabAll',
} as const satisfies Record<ApplicationTab, string>;

/** The view named by a `status` query value. Pending when absent or unknown. */
export function applicationTabFrom(raw: unknown): ApplicationTab {
  const value = Array.isArray(raw) ? (raw[0] as unknown) : raw;
  return (APPLICATION_TABS as readonly unknown[]).includes(value)
    ? (value as ApplicationTab)
    : 'pending';
}

/** List URL for a view. Pending, page 1 and the default page size stay out of the URL. */
export function applicationsHref(tab: ApplicationTab, page = 1, pageSize?: number): string {
  const params = new URLSearchParams();
  if (tab !== 'pending') params.set('status', tab);
  if (pageSize && pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize));
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search ? `${APPLICATIONS_PATH}?${search}` : APPLICATIONS_PATH;
}

export function ApplicationStatusTabs({ active }: { active: ApplicationTab }) {
  const t = useTranslations('applications.admin.list');

  return (
    <nav aria-label={t('tabsLabel')} className="overflow-x-auto border-b border-border">
      <ul className="-mb-px flex gap-6">
        {APPLICATION_TABS.map((tab) => {
          const current = tab === active;
          return (
            <li key={tab} className="shrink-0">
              <Link
                href={applicationsHref(tab)}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex h-11 items-center border-b-2 text-sm transition-colors focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  current
                    ? 'border-primary font-semibold text-text'
                    : 'border-transparent text-text-muted hover:border-border-strong hover:text-text'
                }`}
              >
                {t(TAB_LABEL[tab])}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
