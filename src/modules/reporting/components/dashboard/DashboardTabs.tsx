'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

type TabId = 'overview' | 'unrouted';

/** Which section a locale-less dashboard path belongs to. */
export function activeDashboardTab(pathname: string): TabId | null {
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/kpi')) return 'overview';
  if (pathname === '/dashboard/unrouted' || pathname.startsWith('/dashboard/unrouted/')) {
    return 'unrouted';
  }
  return null;
}

const TABS: { id: TabId; href: string }[] = [
  { id: 'overview', href: '/dashboard' },
  { id: 'unrouted', href: '/dashboard/unrouted' },
];

export function DashboardTabs() {
  const t = useTranslations('dashboard.tabs');
  const active = activeDashboardTab(usePathname() ?? '');

  return (
    <nav aria-label={t('label')} className="print:hidden">
      <ul className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                className={`relative inline-flex h-10 items-center rounded-t-md px-3 text-sm font-medium transition-colors after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full ${
                  current
                    ? 'text-text after:bg-primary'
                    : 'text-text-muted after:bg-transparent hover:text-text'
                }`}
              >
                {t(tab.id)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
