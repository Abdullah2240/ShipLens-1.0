import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export type ContentTab = 'pages' | 'events';

const TABS: readonly { id: ContentTab; href: string }[] = [
  { id: 'pages', href: '/content' },
  { id: 'events', href: '/content/events' },
];

export function ContentTabs({ active }: { active: ContentTab }) {
  const t = useTranslations('content.tabs');

  return (
    <nav aria-label={t('label')} className="border-b border-border">
      <ul className="-mb-px flex gap-6">
        {TABS.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex h-11 items-center border-b-2 text-sm transition-colors focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  current
                    ? 'border-primary font-semibold text-text'
                    : 'border-transparent text-text-muted hover:border-border-strong hover:text-text'
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
